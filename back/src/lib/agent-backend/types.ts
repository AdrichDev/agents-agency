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
  /**
   * Turno del servicio en una línea ("L-S 20:00-22:45"). Es lo que permite al modelo elegir
   * el servicio correcto a partir de la hora que pide el usuario: sin esto, ante "mesa para
   * las 21:00" preguntaba por la comida y concluía que no había disponibilidad.
   * Ausente cuando el backend no expone horarios (`external_api`).
   */
  horario?: string;
  /** Máximo de personas admitidas online. Ausente si el servicio es de plaza única. */
  maxComensales?: number;
}

/** Franja disponible/reservable. Fechas en ISO 8601. */
export interface Slot {
  startTime: string;
  endTime: string;
  /**
   * Cuántas reservas caben a la vez en ese instante (mesas, cabinas, salas libres). Se emite
   * SÓLO cuando es mayor que 1: el caso corriente es un recurso por hora y repetir `1` en cada
   * franja sería gasto de tokens sin información.
   *
   * Sin este número el modelo no puede sentar a dos personas a la misma hora aunque haya sitio:
   * `computeAvailableSlots` colapsa a una entrada por instante, así que una hora servida por dos
   * cabinas y una servida por una se veían idénticas. Es la cardinalidad, no el inventario: los
   * ids de recurso siguen sin salir de aquí.
   */
  plazasSimultaneas?: number;
}

/** Datos de contacto que acompanan a una reserva. */
export interface ContactoReserva {
  nombre?: string;
  email?: string;
  telefono?: string;
  notas?: string;
  /**
   * Numero de personas. Opcional para no romper los backends de plaza unica (barberia,
   * estetica), donde una reserva siempre vale por una persona.
   */
  comensales?: number;
}

/** Reserva creada en el backend del agente. */
export interface Reserva {
  id: string;
  servicioId: string;
  servicioNombre: string;
  startTime: string;
  endTime: string;
  estado: string;
  /** Numero de personas. 1 en los backends que no lo modelan. */
  comensales?: number;
  /**
   * Codigo corto que el cliente repite para cancelar. El modelo tiene instruccion de leerlo
   * en voz alta: un codigo que el cliente nunca oye no sirve para cancelar nada.
   */
  codigo?: string;
  /** Unidad asignada (mesa, barbero, cabina), cuando el backend la modela. */
  recurso?: { nombre: string; zona?: string };
}

/** Contacto con el que el cliente final se identifica ante el bot. */
export interface ContactoIdentificacion {
  email?: string;
  telefono?: string;
}

/** Reserva vista por el cliente final (`consultar_mis_reservas`). */
export interface ReservaCliente {
  codigo: string | null;
  servicio: string;
  startTime: string;
  endTime: string;
  comensales: number;
  zona?: string;
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
  consultarDisponibilidad(
    servicio: string,
    rango: RangoFechas,
    /** Tamano del grupo. 1 por defecto: los backends de plaza unica no cambian. */
    comensales?: number
  ): Promise<Slot[]>;
  crearReserva(servicio: string, slot: Slot, contacto: ContactoReserva): Promise<Reserva>;
  /** Cancelacion del lado del negocio: por id, ya autenticado. */
  cancelarReserva(reservaId: string): Promise<CancelacionReserva>;
  /**
   * Autoservicio del cliente final. Se separan de `cancelarReserva` porque la autorizacion es
   * distinta: el cliente no tiene sesion, se identifica con codigo + contacto.
   *
   * Un backend que no lo soporte debe lanzar en vez de devolver vacio: "no tienes reservas"
   * seria una respuesta falsa y el cliente colgaria creyendo que no reservo.
   */
  consultarMisReservas(contacto: ContactoIdentificacion): Promise<ReservaCliente[]>;
  cancelarReservaPorCodigo(
    codigo: string,
    contacto: ContactoIdentificacion
  ): Promise<CancelacionReserva>;
  /**
   * `conversationId` identifica la conversación en curso, y es la clave de fusión: el
   * modelo llama varias veces según va sacando el nombre, el email y el teléfono, y las
   * tres llamadas tienen que aterrizar en el mismo lead. Sin él (llamada por API) se
   * crea uno nuevo, como antes.
   */
  guardarLead(
    contacto: ContactoLead,
    intencion: string,
    conversationId?: string | null
  ): Promise<LeadGuardado>;
  consultarPedido(orderId: string): Promise<EstadoPedido>;
  notificar(evento: EventoNotificacion, payload: Record<string, unknown>): Promise<void>;
}
