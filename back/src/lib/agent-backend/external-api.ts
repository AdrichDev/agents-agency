/**
 * Adapter `external_api` del contrato `AgentBackendAdapter` — F1
 * (aa-agent-external-crm-and-lead-qualification, design.md §B).
 *
 * HTTP + Bearer opcional contra el lane público del `creador_CRM`
 * (`/api/public/{leads,bookings,availability}`). El agente NO aprovisiona una
 * BD paralela: lee/escribe directamente en el CRM real del negocio.
 *
 * Invariantes (mismos que `managed-db.ts`):
 *  - Cada método valida su capability antes de operar (salvo
 *    `cancelarReserva`/`consultarPedido`, que el CRM público no expone y por
 *    tanto SIEMPRE responden honesto, independientemente de capabilities).
 *  - El input del LLM viaja SOLO como query/body — nunca interpolado en la URL.
 *  - `notificar` es best-effort: nunca lanza (delega en `notify-dispatcher.ts`).
 *  - Timeout duro por request (`AbortController`), sin reintento de escrituras
 *    no idempotentes salvo timeout confirmado.
 */

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
  ServicioReservable,
  Slot,
} from "./types";

const DEFAULT_TIMEOUT_MS = 8_000;

export interface ExternalApiConfig {
  /** Id del agente AA (para el dispatcher de avisos al dueño, notify-dispatcher.ts). */
  agentId: string;
  /** `AgentDataBackend.apiBaseUrl` — base del CRM externo (sin slash final). */
  apiBaseUrl: string;
  /** Bearer opcional — `decryptToken(AgentDataBackend.apiKeyEncrypted)`. */
  apiKey?: string;
  /** `AgentDataBackend.dbSchema.businessId` — cuid del negocio en el CRM. */
  businessId: string;
  /** `AgentDataBackend.dbSchema.locationId` — REQUERIDO si capability `reservas`. */
  locationId?: string;
  capabilities: BackendCapability[];
  /** Inyectable para test (mock, sin red real). */
  fetchImpl?: typeof fetch;
  /** Timeout duro por request en ms (default 8000). */
  timeoutMs?: number;
}

export class CapabilityNotEnabledError extends Error {
  constructor(capability: BackendCapability) {
    super(`El backend external_api del agente no tiene habilitada la capacidad "${capability}"`);
    this.name = "CapabilityNotEnabledError";
  }
}

/** El CRM público no expone este método — respuesta/rechazo honesto, sin red. */
export class ExternalApiNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalApiNotSupportedError";
  }
}

/** No-2xx del CRM externo, o fallo de red/timeout — el LLM lo comunica honestamente. */
export class ExternalApiRequestError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "ExternalApiRequestError";
  }
}

export class ExternalApiAdapter implements AgentBackendAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: ExternalApiConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Nota de config (design.md §B.1): reservas sin locationId es un backend mal
    // configurado — falla rápido y claro al construir, no a la primera llamada.
    if (cfg.capabilities.includes("reservas") && !cfg.locationId) {
      throw new Error(
        "AgentDataBackend external_api con capability 'reservas' requiere locationId (dbSchema.locationId)"
      );
    }
  }

  private requireCapability(capability: BackendCapability): void {
    if (!this.cfg.capabilities.includes(capability)) {
      throw new CapabilityNotEnabledError(capability);
    }
  }

  private buildHeaders(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (hasBody) headers["Content-Type"] = "application/json";
    // El lane público hoy no lo exige; se envía para forward-compat cuando el
    // CRM gatee el lane con API key (design.md §B.3).
    if (this.cfg.apiKey) headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;
    return headers;
  }

  /** Único camino HTTP: input siempre como query/body, NUNCA interpolado en la URL. */
  private async request(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, string>; body?: unknown } = {}
  ): Promise<{ status: number; json: any }> {
    const url = new URL(`${this.cfg.apiBaseUrl.replace(/\/$/, "")}${path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url.toString(), {
        method,
        headers: this.buildHeaders(opts.body !== undefined),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ExternalApiRequestError(`Timeout (${this.timeoutMs}ms) contra el CRM externo en ${path}`);
      }
      throw new ExternalApiRequestError(
        `Fallo de red contra el CRM externo en ${path}: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async guardarLead(contacto: ContactoLead, intencion: string): Promise<LeadGuardado> {
    this.requireCapability("leads");
    if (!contacto.nombre?.trim()) throw new Error("El lead requiere nombre");

    const { status, json } = await this.request("POST", "/api/public/leads", {
      body: {
        businessId: this.cfg.businessId,
        nombre: contacto.nombre,
        email: contacto.email || undefined,
        telefono: contacto.telefono || undefined,
        peticion: intencion || undefined,
      },
    });
    if (status !== 201) {
      throw new ExternalApiRequestError(
        `El CRM externo rechazó el lead (status ${status}): ${json?.error?.message ?? "error desconocido"}`,
        status
      );
    }
    return { id: json.id, creadoEn: new Date().toISOString() };
  }

  async consultarDisponibilidad(servicio: string, rango: RangoFechas): Promise<Slot[]> {
    this.requireCapability("reservas");
    const locationId = this.cfg.locationId!;

    const dias = enumerarDiasUtc(rango.desde, rango.hasta);
    const slots: Slot[] = [];
    for (const dia of dias) {
      const { status, json } = await this.request("GET", "/api/public/availability", {
        query: { businessId: this.cfg.businessId, date: dia, serviceId: servicio, locationId },
      });
      if (status !== 200) {
        throw new ExternalApiRequestError(
          `El CRM externo rechazó la consulta de disponibilidad (status ${status}) para ${dia}`,
          status
        );
      }
      const rows: { hora: string; disponible: boolean }[] = Array.isArray(json) ? json : [];
      const stepMin = inferStepMinutes(rows);
      for (const row of rows) {
        if (!row.disponible) continue;
        const startTime = `${dia}T${row.hora}:00.000Z`;
        const endTime = new Date(new Date(startTime).getTime() + stepMin * 60_000).toISOString();
        slots.push({ startTime, endTime });
      }
    }
    return slots;
  }

  async crearReserva(servicio: string, slot: Slot, contacto: ContactoReserva): Promise<Reserva> {
    this.requireCapability("reservas");
    const locationId = this.cfg.locationId!;
    if (!contacto.nombre?.trim()) throw new Error("La reserva requiere nombre de contacto");

    const { status, json } = await this.request("POST", "/api/public/bookings", {
      body: {
        businessId: this.cfg.businessId,
        locationId,
        serviceId: servicio,
        start: slot.startTime,
        notes: contacto.notas || undefined,
        customer: {
          nombre: contacto.nombre,
          email: contacto.email || undefined,
          telefono: contacto.telefono || undefined,
        },
      },
    });
    if (status === 409) {
      throw new ExternalApiRequestError(
        `El slot ${slot.startTime} ya no está disponible (conflicto en el CRM externo)`,
        409
      );
    }
    if (status !== 201) {
      throw new ExternalApiRequestError(
        `El CRM externo rechazó la reserva (status ${status}): ${json?.error?.message ?? "error desconocido"}`,
        status
      );
    }
    return {
      id: json.id,
      servicioId: servicio,
      servicioNombre: servicio,
      startTime: slot.startTime,
      endTime: slot.endTime,
      estado: "PENDING",
    };
  }

  /**
   * El lane público del CRM externo no expone catálogo de servicios (solo
   * `/public/{availability,bookings,leads}`), y ambos endpoints piden un `serviceId` cuid.
   * No se inventa un endpoint: se rechaza con un mensaje que el modelo puede repetir.
   */
  async listarServicios(): Promise<ServicioReservable[]> {
    this.requireCapability("reservas");
    throw new ExternalApiNotSupportedError(
      "El CRM externo no expone el catálogo de servicios: pide al usuario que indique el servicio " +
        "y usa el identificador que el negocio te haya configurado."
    );
  }

  /** El CRM público no expone cancelación — no soportado, honesto, sin tocar la red. */
  async cancelarReserva(_reservaId: string): Promise<CancelacionReserva> {
    throw new ExternalApiNotSupportedError(
      "cancelarReserva no está soportado por el CRM externo (el lane público no expone cancelación)."
    );
  }

  /** `pedidos` nunca es una capability habilitable en external_api (T1.5) — honesto sin red. */
  async consultarPedido(orderId: string): Promise<EstadoPedido> {
    return { encontrado: false, codigo: orderId };
  }

  /**
   * Aviso al dueño del negocio. Delega en `notify-dispatcher.ts` (AA-side,
   * Telegram) — NUNCA lanza (best-effort, patrón `managed-db.ts:notificar`).
   */
  async notificar(evento: EventoNotificacion, payload: Record<string, unknown>): Promise<void> {
    try {
      await dispatchNotification(this.cfg.agentId, evento, payload);
    } catch {
      // best-effort: nunca propagar
    }
  }
}

/** Enumera fechas YYYY-MM-DD (UTC, inclusive) entre `desde` y `hasta`. */
function enumerarDiasUtc(desde: Date, hasta: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate()));
  const end = new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), hasta.getUTCDate()));
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Infiere el paso (minutos) entre slots consecutivos del día para calcular
 * `endTime`: el CRM (`daySlotsWithAvailability`) solo devuelve `hora` de
 * inicio (HH:MM), sin duración explícita. Con <2 filas no hay paso deducible:
 * usa 30min como fallback conservador (documentado, no silencioso).
 */
function inferStepMinutes(rows: { hora: string }[]): number {
  if (rows.length < 2) return 30;
  const toMin = (h: string) => {
    const [hh, mm] = h.split(":").map(Number);
    return hh * 60 + mm;
  };
  const diff = toMin(rows[1].hora) - toMin(rows[0].hora);
  return diff > 0 ? diff : 30;
}
