/**
 * Adapter `managed_db` del contrato `AgentBackendAdapter`.
 *
 * Reescritura (aa-managed-db-conexion-compartida F1): el adapter YA NO ejecuta
 * SQL raw contra un schema propio. Opera sobre los MODELOS Prisma reales del
 * schema `aa` de la plataforma y REUSA la logica de reservas real de AA
 * (`lib/booking/appointments.ts`), la misma que sirve el endpoint HTTP
 * `routes/booking.ts`. Asi, las reservas/leads de un agente caen en las tablas
 * de la plataforma (`cita`, `lead`, `franja_horaria`, `servicio_agente`) y
 * quedan consistentes con la agenda y los leads del panel.
 *
 * Aislamiento por agente (AC5): cada lectura/escritura se acota por `agentId`
 *  - el servicio se resuelve con `where: { agentId }` (una reserva solo puede
 *    colgar de un servicio del agente);
 *  - el lead se crea con `agentId`;
 *  - la cancelacion verifica que la cita pertenezca a un servicio del agente.
 *
 * El rol/BD per-agente de `provisioning.ts` (y las plantillas SQL de
 * `sql-templates.ts`) quedan muertos y ya no se importan desde aqui.
 */

import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/integrations/oauth";
import {
  computeAvailableSlots,
  createAppointment,
  cancelAppointment,
  cancelAppointmentByCode,
  listAppointmentsByContact,
  ServiceNotFoundError,
} from "@/lib/booking/appointments";
import { formatScheduleHuman } from "@/lib/booking/slots";
import { getAgentTimezone, toZonedIso } from "@/lib/booking/timezone";
import { dispatchNotification } from "./notify-dispatcher";
import { ExternalApiAdapter } from "./external-api";
import type {
  AgentBackendAdapter,
  BackendCapability,
  CancelacionReserva,
  ContactoIdentificacion,
  ContactoLead,
  ContactoReserva,
  EstadoPedido,
  EventoNotificacion,
  LeadGuardado,
  ReservaCliente,
  RangoFechas,
  Reserva,
  ServicioReservable,
  Slot,
} from "./types";

/**
 * Etiquetas con las que el modelo rellena el nombre cuando no lo tiene —o cuando lo tiene y
 * decide resumirlo—. Ninguna puede sobrescribir un nombre real: quien reciba el lead va a
 * llamar por telefono, y "Cliente" no le sirve de nada.
 *
 * Es una lista corta a proposito. Un nombre propio poco frecuente no puede caer aqui por error,
 * asi que solo entran las etiquetas observadas o triviales; se amplia con evidencia, no por
 * precaucion.
 */
const NOMBRES_GENERICOS = new Set([
  "visitante",
  "cliente",
  "usuario",
  "interesado",
  "anonimo",
  "anónimo",
  "sin nombre",
  "desconocido",
]);

export function esNombreGenerico(nombre: string): boolean {
  return NOMBRES_GENERICOS.has(nombre.trim().toLowerCase());
}

// ── Errores tipados ─────────────────────────────────────────────────────────

export class CapabilityNotEnabledError extends Error {
  constructor(capability: BackendCapability) {
    super(`El backend del agente no tiene habilitada la capacidad "${capability}"`);
    this.name = "CapabilityNotEnabledError";
  }
}

/** Reserva no encontrada para ESTE agente (aislamiento — no filtra otros agentes). */
export class ReservaNotFoundError extends Error {
  constructor(reservaId: string) {
    super(`Reserva no encontrada para este agente: ${reservaId}`);
    this.name = "ReservaNotFoundError";
  }
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export class ManagedDbAdapter implements AgentBackendAdapter {
  constructor(
    private readonly agentId: string,
    private readonly capabilities: BackendCapability[]
  ) {}

  private requireCapability(capability: BackendCapability): void {
    if (!this.capabilities.includes(capability)) throw new CapabilityNotEnabledError(capability);
  }

  /**
   * Resuelve el servicio del agente por id o por nombre (case-insensitive),
   * acotado por `agentId` y `enabled=true`. Lanza `ServiceNotFoundError` si no
   * existe (error claro, no un 500 opaco).
   */
  private async resolveServiceId(servicio: string): Promise<{ id: string; name: string }> {
    const svc = await prisma.service.findFirst({
      where: {
        agentId: this.agentId,
        enabled: true,
        OR: [{ id: servicio }, { name: { equals: servicio, mode: "insensitive" } }],
      },
      select: { id: true, name: true },
    });
    if (!svc) {
      // Con los nombres validos dentro, el modelo se autocorrige en el mismo turno en vez
      // de rendirse ("no me consta que gestionen citas", observado en produccion).
      const validos = await this.listarServicios();
      throw new ServiceNotFoundError(
        servicio,
        validos.map((s) => s.nombre)
      );
    }
    return svc;
  }

  async listarServicios(): Promise<ServicioReservable[]> {
    this.requireCapability("reservas");
    const rows = await prisma.service.findMany({
      where: { agentId: this.agentId, enabled: true },
      select: {
        name: true,
        duration: true,
        description: true,
        schedule: true,
        maxPartySize: true,
      },
      orderBy: { name: "asc" },
    });
    // Horario del agente como respaldo: mismo criterio que `computeAvailableSlots`, donde el
    // turno propio del servicio manda y, si no tiene, se cae al del negocio. Si aquí se
    // anunciara otro horario del que luego se aplica, el modelo ofreceria huecos inexistentes.
    const agenda = await prisma.agentSchedule.findUnique({
      where: { agentId: this.agentId },
      select: { schedule: true },
    });
    const horarioAgente = (agenda?.schedule ?? {}) as Record<string, string>;
    return rows.map((r) => {
      const propio = (r.schedule ?? null) as Record<string, string> | null;
      const efectivo = propio && Object.keys(propio).length > 0 ? propio : horarioAgente;
      const horario = formatScheduleHuman(efectivo);
      return {
        nombre: r.name,
        duracionMin: r.duration,
        descripcion: r.description ?? undefined,
        ...(horario ? { horario } : {}),
        ...(r.maxPartySize > 1 ? { maxComensales: r.maxPartySize } : {}),
      };
    });
  }

  async consultarDisponibilidad(
    servicio: string,
    rango: RangoFechas,
    comensales = 1
  ): Promise<Slot[]> {
    this.requireCapability("reservas");
    const svc = await this.resolveServiceId(servicio);
    // Delega en el helper compartido (mismo camino que routes/booking.ts GET /slots).
    // computeAvailableSlots lanza ScheduleNotConfiguredError con mensaje claro si
    // el agente no tiene horario (no un 500 feo), y GroupTooLargeError si el grupo
    // excede el maximo del servicio.
    const slots = await computeAvailableSlots(
      svc.id,
      { desde: rango.desde, hasta: rango.hasta },
      prisma,
      comensales
    );
    // Los ids de recurso son inventario interno: no viajan al prompt del modelo.
    return slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
  }

  async crearReserva(servicio: string, slot: Slot, contacto: ContactoReserva): Promise<Reserva> {
    this.requireCapability("reservas");
    const svc = await this.resolveServiceId(servicio);

    // El nombre viaja tambien en las notas por compatibilidad con las citas ya existentes,
    // que es donde el panel lo ha estado leyendo. `customerName` es ahora la fuente buena.
    const notas =
      [contacto.nombre ? `Cliente: ${contacto.nombre}` : null, contacto.notas ?? null]
        .filter(Boolean)
        .join(" — ") || null;

    const created = await createAppointment({
      serviceId: svc.id,
      slotStart: new Date(slot.startTime),
      slotEnd: new Date(slot.endTime),
      email: contacto.email ?? null,
      phone: contacto.telefono ?? null,
      notes: notas,
      partySize: contacto.comensales,
      customerName: contacto.nombre ?? null,
    });

    // La confirmacion vuelve en la MISMA zona en la que se ofrecio el hueco. `slot.startTime`
    // llega de `consultarDisponibilidad` con offset ("...T21:00:00.000+02:00") y `toISOString()`
    // lo devolvia en UTC ("...T19:00:00.000Z"): el modelo confirmaba al cliente una hora dos
    // horas anterior a la que acababa de acordar con el. Ver `toZonedIso`.
    const timezone = await getAgentTimezone(this.agentId);

    return {
      id: created.appointmentId,
      servicioId: created.service.id,
      servicioNombre: created.service.name,
      startTime: toZonedIso(created.startTime, timezone),
      endTime: toZonedIso(created.endTime, timezone),
      estado: "scheduled",
      comensales: created.partySize,
      codigo: created.confirmationCode,
      recurso: { nombre: created.resource.name, zona: created.resource.zone ?? undefined },
    };
  }

  async cancelarReserva(reservaId: string): Promise<CancelacionReserva> {
    this.requireCapability("reservas");

    // Aislamiento: solo se cancela si la cita cuelga de un servicio de ESTE agente.
    const owned = await prisma.appointment.findFirst({
      where: { id: reservaId, service: { agentId: this.agentId } },
      select: { id: true },
    });
    if (!owned) throw new ReservaNotFoundError(reservaId);

    return cancelAppointment(reservaId);
  }

  async consultarMisReservas(contacto: ContactoIdentificacion): Promise<ReservaCliente[]> {
    this.requireCapability("reservas");
    // El acotado por `agentId` vive en el helper: un mismo email puede haber reservado en
    // varios negocios de la plataforma y este agente solo debe ver los suyos.
    const rows = await listAppointmentsByContact(this.agentId, {
      email: contacto.email ?? null,
      telefono: contacto.telefono ?? null,
    });
    return rows.map((r) => ({
      codigo: r.codigo,
      servicio: r.servicio,
      startTime: r.startTime,
      endTime: r.endTime,
      comensales: r.comensales,
      zona: r.zona ?? undefined,
    }));
  }

  async cancelarReservaPorCodigo(
    codigo: string,
    contacto: ContactoIdentificacion
  ): Promise<CancelacionReserva> {
    this.requireCapability("reservas");
    const { ok, estado } = await cancelAppointmentByCode(this.agentId, codigo, {
      email: contacto.email ?? null,
      telefono: contacto.telefono ?? null,
    });
    return { ok, estado };
  }

  async guardarLead(
    contacto: ContactoLead,
    _intencion: string,
    conversationId?: string | null
  ): Promise<LeadGuardado> {
    this.requireCapability("leads");
    if (!contacto.nombre?.trim())
      throw new Error("guardarLead requiere el nombre del contacto");

    // NOTA: `intencion` NO tiene columna en el modelo `Lead` de la plataforma, asi
    // que NO se persiste aqui. El executor ya la usa aparte en `notificar` (evento
    // nuevo_lead), que es donde el dueno la necesita.
    const nombre = contacto.nombre.trim();
    const email = contacto.email?.trim() || null;
    const telefono = contacto.telefono?.trim() || null;
    // El consentimiento lo decide el servidor, no el modelo: si los datos llegan por una
    // conversacion, los ha tecleado la persona a la que se le acaba de explicar para que
    // son. El campo era opcional en el schema de la tool y el modelo no lo mandaba nunca.
    const consent = Boolean(conversationId);

    if (!conversationId) {
      const lead = await prisma.lead.create({
        data: { agentId: this.agentId, customerName: nombre, email, phone: telefono, consent },
        select: { id: true, createdAt: true },
      });
      return { id: lead.id, creadoEn: lead.createdAt.toISOString() };
    }

    // Un lead por conversacion. El modelo llama a `guardar_lead` cada vez que consigue un
    // dato nuevo, y cada llamada creaba una fila: tres filas incompletas de la misma
    // persona. Se fusiona, y lo que no llega NO se escribe — la segunda llamada no puede
    // borrar el email que trajo la primera.
    const lead = await prisma.lead.upsert({
      where: { conversationId },
      create: {
        agentId: this.agentId,
        conversationId,
        customerName: nombre,
        email,
        phone: telefono,
        consent,
      },
      update: {
        // Un nombre generico no puede pisar uno real. "Visitante" lo pone `calificar_lead`
        // cuando aun no hay nombre; el resto los inventa el modelo — medido en produccion
        // (conversacion cms825sae000j0td0id6mqj7j: el visitante dijo "Luis Arriaga" y la
        // llamada llego con "Cliente"). La prosa de la tool no obliga, asi que la guarda
        // vive aqui.
        ...(!esNombreGenerico(nombre) ? { customerName: nombre } : {}),
        ...(email ? { email } : {}),
        ...(telefono ? { phone: telefono } : {}),
        consent,
      },
      select: { id: true, createdAt: true },
    });

    return { id: lead.id, creadoEn: lead.createdAt.toISOString() };
  }

  async consultarPedido(orderId: string): Promise<EstadoPedido> {
    this.requireCapability("pedidos");
    // La plataforma `aa` no tiene tabla de pedidos: respuesta honesta (no inventa).
    return { encontrado: false, codigo: orderId };
  }

  /**
   * Aviso al dueno del negocio. Delega en el dispatcher real
   * (`notify-dispatcher.ts` → Telegram). Invariante: NUNCA lanza (best-effort;
   * un fallo de aviso no rompe el chat ni la reserva).
   */
  async notificar(evento: EventoNotificacion, payload: Record<string, unknown>): Promise<void> {
    try {
      await dispatchNotification(this.agentId, evento, payload);
    } catch {
      // best-effort: nunca propagar
    }
  }
}

// ── Resolucion por agente ─────────────────────────────────────────────────────

/**
 * Resuelve el adapter del agente a partir de su `AgentDataBackend`.
 * - Sin fila o `mode="none_yet"` → null.
 * - `managed_db`: usa la conexion normal de la app (Prisma) sobre el schema `aa`,
 *   aislado por `agentId` en cada operacion. Ya no exige `dbUrlEncrypted` ni rol
 *   per-agente (aa-managed-db-conexion-compartida F1).
 * - `external_api` (aa-agent-external-crm-and-lead-qualification F1): HTTP + Bearer
 *   opcional contra el CRM externo (`ExternalApiAdapter`). `pedidos` nunca se
 *   habilita (T1.5).
 */
export async function resolveAgentBackendAdapter(
  agentId: string
): Promise<AgentBackendAdapter | null> {
  const backend = await prisma.agentDataBackend.findUnique({ where: { agentId } });
  if (!backend || backend.mode === "none_yet") return null;

  if (backend.mode === "external_api") {
    const businessId = (backend.dbSchema as { businessId?: string } | null)?.businessId;
    if (!backend.apiBaseUrl || !businessId) {
      throw new Error(
        `AgentDataBackend de ${agentId} en modo external_api sin apiBaseUrl o businessId (dbSchema)`
      );
    }
    const locationId = (backend.dbSchema as { locationId?: string } | null)?.locationId;
    const apiKey = backend.apiKeyEncrypted ? decryptToken(backend.apiKeyEncrypted) : undefined;
    const capabilities = (Array.isArray(backend.capabilities) ? backend.capabilities : []).filter(
      // pedidos NUNCA en el CRM externo
      (c): c is BackendCapability => c === "reservas" || c === "leads"
    );
    return new ExternalApiAdapter({
      agentId,
      apiBaseUrl: backend.apiBaseUrl,
      businessId,
      locationId,
      apiKey,
      capabilities,
    });
  }

  // managed_db: conexion normal de la app (Prisma), aislado por agentId.
  const capabilities = (Array.isArray(backend.capabilities) ? backend.capabilities : []).filter(
    (c): c is BackendCapability => c === "reservas" || c === "leads" || c === "pedidos"
  );
  return new ManagedDbAdapter(agentId, capabilities);
}

/**
 * Backend de datos del agente (fila `AgentDataBackend`, F3
 * aa-agent-backend-foundation). JSON boundary → laxo: `capabilities` llega como
 * Json de Prisma y se normaliza en `enabledBackendCapabilities()`.
 *
 * Vive aqui (no en `agent/engine.ts`) para que `agent/executor.ts` pueda
 * importarla sin crear un ciclo `engine.ts` ⇄ `executor.ts`. `engine.ts` la
 * re-exporta para no romper sus consumidores existentes.
 */
export interface AgentBackendInfo {
  mode: string;
  capabilities: unknown;
}

/**
 * Gating F3/F1: `managed_db` Y `external_api` habilitan tools/capabilities de
 * backend, solo las declaradas. `none_yet` → []. `external_api` nunca expone
 * `pedidos` (T1.5: el lane publico del CRM no lo soporta).
 */
export function enabledBackendCapabilities(backend?: AgentBackendInfo | null): BackendCapability[] {
  if (!backend || (backend.mode !== "managed_db" && backend.mode !== "external_api")) return [];
  const raw = Array.isArray(backend.capabilities) ? backend.capabilities : [];
  const allowed: BackendCapability[] =
    backend.mode === "external_api" ? ["reservas", "leads"] : ["reservas", "leads", "pedidos"];
  return raw.filter((c): c is BackendCapability => allowed.includes(c as BackendCapability));
}
