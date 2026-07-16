/**
 * Adapter `managed_db` del contrato `AgentBackendAdapter` — F2 (T2.2/T2.3).
 *
 * - Resuelve el `AgentDataBackend` del agente, descifra `dbUrlEncrypted` con
 *   `decryptToken` (mismo cifrado que los tokens OAuth) y abre un pool `pg`
 *   contra la BD aprovisionada (rol de minimo privilegio, ver provisioning.ts).
 * - Disponibilidad: DELEGA en el motor de reservas existente
 *   (`booking/slots.ts:generateSlots`) — no reimplementa slots. La semantica
 *   replica `routes/booking.ts` GET /slots (teoricos - bloqueos - ocupados).
 * - Escrituras (reserva/lead): SOLO via plantillas parametrizadas de
 *   `sql-templates.ts` sobre el esquema estandar. Nada de SQL libre: el
 *   adapter solo puede ejecutar claves tipadas del mapa congelado y el input
 *   del LLM viaja exclusivamente como valores bind escalares.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/integrations/oauth";
import { generateSlots } from "@/lib/booking/slots";
import { SQL_TEMPLATES, type SqlTemplateKey } from "./sql-templates";
import { dispatchNotification } from "./notify-dispatcher";
import type {
  AgentBackendAdapter,
  BackendCapability,
  CancelacionReserva,
  ContactoLead,
  ContactoReserva,
  EstadoPedido,
  EventoNotificacion,
  LeadGuardado,
  RangoFechas,
  Reserva,
  Slot,
} from "./types";

// ── Ejecutor SQL (inyectable para tests) ────────────────────────────────────

export interface QueryResultLike {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

export type QueryFn = (text: string, values?: unknown[]) => Promise<QueryResultLike>;

export interface SqlExecutor {
  query: QueryFn;
  /** Ejecuta `fn` dentro de una transaccion (BEGIN/COMMIT, ROLLBACK on error). */
  transaction<T>(fn: (query: QueryFn) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

/** Ejecutor real: pool pg contra la connection string (ya descifrada). */
export function createPgExecutor(dbUrl: string): SqlExecutor {
  const pool = new Pool({
    connectionString: dbUrl,
    max: Number(process.env.AGENT_BACKEND_POOL_MAX ?? 3),
    idleTimeoutMillis: Number(process.env.AGENT_BACKEND_POOL_IDLE_MS ?? 10_000),
  });
  return {
    query: async (text, values) => pool.query(text, values as unknown[]),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(
          async (text, values) => client.query(text, values as unknown[])
        );
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}

// ── Errores tipados ─────────────────────────────────────────────────────────

export class CapabilityNotEnabledError extends Error {
  constructor(capability: BackendCapability) {
    super(`El backend del agente no tiene habilitada la capacidad "${capability}"`);
    this.name = "CapabilityNotEnabledError";
  }
}

export class SlotNoDisponibleError extends Error {
  constructor(startTime: string) {
    super(`El slot ${startTime} ya no esta disponible`);
    this.name = "SlotNoDisponibleError";
  }
}

// ── Guardas de parametros ───────────────────────────────────────────────────

/**
 * El input del LLM solo puede viajar como escalar bind. Un objeto/array/func
 * aqui es sintoma de uso incorrecto y se rechaza (defensa en profundidad).
 */
function assertScalarParams(values: unknown[]): void {
  for (const v of values) {
    const ok =
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      v instanceof Date;
    if (!ok) {
      throw new Error("Parametro SQL no escalar rechazado (posible input malformado del LLM)");
    }
  }
}

function parseFecha(value: string, label: string): Date {
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new Error(`Fecha invalida en ${label}: ${value}`);
  return d;
}

// ── Adapter ─────────────────────────────────────────────────────────────────

interface ServicioRow {
  id: string;
  nombre: string;
  duracion: number;
}

export class ManagedDbAdapter implements AgentBackendAdapter {
  constructor(
    private readonly agentId: string,
    private readonly capabilities: BackendCapability[],
    private readonly executor: SqlExecutor
  ) {}

  /** Unico camino de ejecucion SQL: clave tipada del mapa congelado + binds escalares. */
  private run(key: SqlTemplateKey, values: unknown[], query?: QueryFn): Promise<QueryResultLike> {
    const text = SQL_TEMPLATES[key];
    assertScalarParams(values);
    return (query ?? this.executor.query)(text, values);
  }

  private requireCapability(capability: BackendCapability): void {
    if (!this.capabilities.includes(capability)) {
      throw new CapabilityNotEnabledError(capability);
    }
  }

  private async findServicio(servicio: string, query?: QueryFn): Promise<ServicioRow> {
    const res = await this.run("reservas_servicio", [this.agentId, servicio], query);
    const row = res.rows[0] as unknown as ServicioRow | undefined;
    if (!row) throw new Error(`Servicio no encontrado: ${servicio}`);
    return row;
  }

  async consultarDisponibilidad(servicio: string, rango: RangoFechas): Promise<Slot[]> {
    this.requireCapability("reservas");

    const svc = await this.findServicio(servicio);

    const horarioRes = await this.run("reservas_horario", [this.agentId]);
    const horario = horarioRes.rows[0] as
      | { id: string; zona_horaria: string; horario: Record<string, string> }
      | undefined;
    if (!horario) throw new Error("Agente sin horario configurado en su backend");

    const bloqueosRes = await this.run("reservas_bloqueos", [
      this.agentId,
      rango.desde,
      rango.hasta,
    ]);
    const blocked = bloqueosRes.rows.map((r) => ({
      startDate: new Date(r.fecha_inicio as string | Date),
      endDate: new Date(r.fecha_fin as string | Date),
    }));

    // Delegacion en el motor de reservas existente (T2.3): slots teoricos.
    const theoretical = generateSlots(
      rango.desde,
      rango.hasta,
      svc.duracion,
      horario.horario ?? {},
      horario.zona_horaria,
      blocked
    );

    // Filtrar franjas ya reservadas (mismo criterio que routes/booking.ts,
    // comparando por instante epoch para no depender del formato ISO).
    const ocupadasRes = await this.run("reservas_ocupadas", [
      this.agentId,
      svc.id,
      rango.desde,
      rango.hasta,
    ]);
    const booked = new Set(
      ocupadasRes.rows.map((r) => new Date(r.inicio as string | Date).getTime())
    );

    return theoretical.filter((s) => !booked.has(new Date(s.startTime).getTime()));
  }

  async crearReserva(servicio: string, slot: Slot, contacto: ContactoReserva): Promise<Reserva> {
    this.requireCapability("reservas");

    const inicio = parseFecha(slot.startTime, "slot.startTime");
    const fin = parseFecha(slot.endTime, "slot.endTime");
    if (fin <= inicio) throw new Error("Rango horario invalido: fin <= inicio");

    // Nombre del contacto: la tabla estandar `cita` no tiene columna nombre
    // (paridad con el motor interno) — viaja en notas, siempre como bind.
    const notas = [
      contacto.nombre ? `Cliente: ${contacto.nombre}` : null,
      contacto.notas ?? null,
    ]
      .filter(Boolean)
      .join(" — ") || null;

    return this.executor.transaction(async (q) => {
      const svc = await this.findServicio(servicio, q);

      const franjaId = randomUUID();
      const franja = await this.run(
        "reservas_insertar_franja",
        // $5 = agente_id: la FK compuesta (servicio_id, agente_id) impide asociar
        // la franja a un servicio de otro agente; el WITH CHECK de RLS lo valida ademas.
        [franjaId, svc.id, inicio, fin, this.agentId],
        q
      );
      // ON CONFLICT DO NOTHING: sin fila devuelta = slot ya reservado.
      if (franja.rows.length === 0) throw new SlotNoDisponibleError(slot.startTime);

      const citaId = randomUUID();
      const cita = await this.run(
        "reservas_insertar_cita",
        // $7 = agente_id: la FK compuesta (franja_id, agente_id) + WITH CHECK de RLS.
        [citaId, franjaId, svc.id, contacto.email ?? null, contacto.telefono ?? null, notas, this.agentId],
        q
      );
      const citaRow = cita.rows[0] as { id: string; estado: string };

      return {
        id: citaRow.id,
        servicioId: svc.id,
        servicioNombre: svc.nombre,
        startTime: inicio.toISOString(),
        endTime: fin.toISOString(),
        estado: citaRow.estado,
      };
    });
  }

  async cancelarReserva(reservaId: string): Promise<CancelacionReserva> {
    this.requireCapability("reservas");

    return this.executor.transaction(async (q) => {
      const res = await this.run("reservas_cancelar_cita", [reservaId, this.agentId], q);
      const row = res.rows[0] as { franja_id: string } | undefined;
      if (!row) throw new Error(`Reserva no encontrada o ya cancelada: ${reservaId}`);
      await this.run("reservas_liberar_franja", [row.franja_id], q);
      return { ok: true, estado: "cancelled" };
    });
  }

  async guardarLead(contacto: ContactoLead, intencion: string): Promise<LeadGuardado> {
    this.requireCapability("leads");
    if (!contacto.nombre?.trim()) throw new Error("El lead requiere nombre");

    const res = await this.run("leads_insertar", [
      randomUUID(),
      this.agentId,
      contacto.nombre.trim(),
      contacto.email ?? null,
      contacto.telefono ?? null,
      contacto.consentimiento ?? false,
      intencion || null,
    ]);
    const row = res.rows[0] as { id: string; creado_en: string | Date };
    return { id: row.id, creadoEn: new Date(row.creado_en).toISOString() };
  }

  async consultarPedido(orderId: string): Promise<EstadoPedido> {
    this.requireCapability("pedidos");

    const res = await this.run("pedidos_consultar", [this.agentId, orderId]);
    const row = res.rows[0] as
      | { codigo: string; estado: string; detalle: unknown }
      | undefined;
    if (!row) return { encontrado: false, codigo: orderId };
    return { encontrado: true, codigo: row.codigo, estado: row.estado, detalle: row.detalle };
  }

  /**
   * Aviso al dueno del negocio. F6: delega en el dispatcher real
   * (`notify-dispatcher.ts` → Telegram, eventos nueva_reserva/nuevo_lead/
   * handoff). Invariante: NUNCA lanza (el dispatcher ya es best-effort; el
   * try/catch es defensa en profundidad — un fallo de aviso no rompe el chat
   * ni la reserva).
   */
  async notificar(evento: EventoNotificacion, payload: Record<string, unknown>): Promise<void> {
    try {
      await dispatchNotification(this.agentId, evento, payload);
    } catch {
      // best-effort: nunca propagar
    }
  }
}

// ── Resolucion por agente ───────────────────────────────────────────────────

const executorCache = new Map<string, { url: string; executor: SqlExecutor }>();

/** Cierra y vacia el cache de pools (tests / shutdown). */
export async function clearAgentBackendExecutors(): Promise<void> {
  const entries = [...executorCache.values()];
  executorCache.clear();
  await Promise.all(entries.map((e) => e.executor.end().catch(() => {})));
}

/**
 * Resuelve el adapter del agente a partir de su `AgentDataBackend`.
 * - Sin fila, `mode="none_yet"` o `mode="external_api"` (backlog v1) → null.
 * - `managed_db`: descifra `dbUrlEncrypted` (patron OAuth `enc:v1:`) y abre
 *   (o reutiliza) el pool pg del agente.
 */
export async function resolveAgentBackendAdapter(
  agentId: string,
  opts?: { createExecutor?: (dbUrl: string) => SqlExecutor }
): Promise<AgentBackendAdapter | null> {
  const backend = await prisma.agentDataBackend.findUnique({ where: { agentId } });
  if (!backend || backend.mode !== "managed_db") return null;
  if (!backend.dbUrlEncrypted) {
    throw new Error(`AgentDataBackend de ${agentId} en modo managed_db sin dbUrlEncrypted`);
  }

  const dbUrl = decryptToken(backend.dbUrlEncrypted);
  const factory = opts?.createExecutor ?? createPgExecutor;

  let cached = executorCache.get(agentId);
  if (!cached || cached.url !== dbUrl) {
    if (cached) void cached.executor.end().catch(() => {});
    cached = { url: dbUrl, executor: factory(dbUrl) };
    executorCache.set(agentId, cached);
  }

  const capabilities = (Array.isArray(backend.capabilities) ? backend.capabilities : []).filter(
    (c): c is BackendCapability => c === "reservas" || c === "leads" || c === "pedidos"
  );

  return new ManagedDbAdapter(agentId, capabilities, cached.executor);
}
