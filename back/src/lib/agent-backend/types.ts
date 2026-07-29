/**
 * Contrato de backend de datos por agente — aa-agent-backend-foundation F2
 * (design.md §B.3, T2.1).
 *
 * `AgentBackendAdapter` es la abstraccion que las tools del agente (F3)
 * invocaran: cada capability habilitada en `AgentDataBackend.capabilities`
 * expone una o mas operaciones de este contrato. Implementaciones:
 *  - `managed_db` (F2, `managed-db.ts`): cliente pg contra la BD aprovisionada.
 *  - `external_api` (aa-agent-external-crm-and-lead-qualification F1,
 *    `external-api.ts`): HTTP + Bearer opcional contra `apiBaseUrl`.
 */

/** Capabilities habilitables en `AgentDataBackend.capabilities`. */
export type BackendCapability = "reservas" | "leads" | "pedidos";

/** Rango de fechas inclusivo para consultar disponibilidad. */
export interface RangoFechas {
  desde: Date;
  hasta: Date;
}

/**
 * Servicio que el negocio permite reservar.
 *
 * Existe porque el modelo no tiene forma de adivinar el nombre exacto: medido contra un
 * agente real, ante "quiero pedir cita" o bien llamaba a la herramienta con `servicio:
 * "cita"` (inexistente) o negaba directamente que el negocio gestionase citas.
 */
export interface ServicioReservable {
  nombre: string;
  duracionMin: number;
  descripcion?: string;
}

/** Franja disponible/reservable. Fechas en ISO 8601. */
export interface Slot {
  startTime: string;
  endTime: string;
}

/** Datos de contacto que acompanan a una reserva. */
export interface ContactoReserva {
  nombre?: string;
  email?: string;
  telefono?: string;
  notas?: string;
}

/** Reserva creada en el backend del agente. */
export interface Reserva {
  id: string;
  servicioId: string;
  servicioNombre: string;
  startTime: string;
  endTime: string;
  estado: string;
}

/** Resultado de cancelar una reserva. */
export interface CancelacionReserva {
  ok: boolean;
  estado: string;
}

/** Datos de contacto de un lead capturado en conversacion. */
export interface ContactoLead {
  nombre: string;
  email?: string;
  telefono?: string;
  consentimiento?: boolean;
}

/** Lead persistido en el backend del agente. */
export interface LeadGuardado {
  id: string;
  creadoEn: string;
}

/** Estado de un pedido consultado por codigo. */
export interface EstadoPedido {
  encontrado: boolean;
  codigo: string;
  estado?: string;
  detalle?: unknown;
}

/** Eventos de aviso al dueno del negocio (dispatcher real en F6). */
export type EventoNotificacion = "nueva_reserva" | "nuevo_lead" | "handoff";

/**
 * Contrato de capacidades del backend de datos (design.md §B.3).
 *
 * Invariantes para TODA implementacion:
 *  - Cada metodo valida su capability antes de operar (`reservas`, `leads`,
 *    `pedidos`); si no esta habilitada, rechaza.
 *  - El input del LLM SOLO viaja como dato (parametros bind / body); NUNCA se
 *    interpola en SQL ni en URLs.
 *  - `notificar` es best-effort: no debe lanzar nunca (patron
 *    `notifications.ts:13-14` — un fallo de aviso no rompe el chat).
 */
export interface AgentBackendAdapter {
  listarServicios(): Promise<ServicioReservable[]>;
  consultarDisponibilidad(servicio: string, rango: RangoFechas): Promise<Slot[]>;
  crearReserva(servicio: string, slot: Slot, contacto: ContactoReserva): Promise<Reserva>;
  cancelarReserva(reservaId: string): Promise<CancelacionReserva>;
  guardarLead(contacto: ContactoLead, intencion: string): Promise<LeadGuardado>;
  consultarPedido(orderId: string): Promise<EstadoPedido>;
  notificar(evento: EventoNotificacion, payload: Record<string, unknown>): Promise<void>;
}
