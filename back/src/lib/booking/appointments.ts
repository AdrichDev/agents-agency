/**
 * Helpers de reservas REUSABLES (aa-managed-db-conexion-compartida F1) — extraen
 * la logica de booking que antes vivia INLINE en `routes/booking.ts`, para que
 * el endpoint HTTP y el adapter `managed_db` (`agent-backend/managed-db.ts`)
 * compartan exactamente el mismo camino y no divergan.
 *
 * Todo opera sobre los MODELOS Prisma reales del schema `aa`
 * (`Service`/`servicio_agente`, `TimeSlot`/`franja_horaria`, `Appointment`/`cita`,
 * `AgentSchedule`, `BlockedRange`, `Lead`). El aislamiento por agente se preserva:
 * las reservas cuelgan de un `serviceId` cuyo `service.agentId` acota al agente;
 * la disponibilidad y la cancelacion parten del servicio/cita.
 */

import { randomInt } from "node:crypto";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateSlots } from "@/lib/booking/slots";
import { syncAppointmentToGcal, unsyncAppointmentFromGcal } from "@/lib/booking/sync";

/**
 * Subconjunto de LECTURA del cliente Prisma que necesita `computeAvailableSlots`.
 * Estructural a proposito: acepta tanto el cliente global como el `tx` de una
 * transaccion (que no expone `$transaction` y por tanto no es un `PrismaClient`),
 * sin arrastrar el tipo generado completo.
 */
type PrismaReadClient = {
  service: { findUnique: (typeof prisma)["service"]["findUnique"] };
  blockedRange: { findMany: (typeof prisma)["blockedRange"]["findMany"] };
  timeSlot: { findMany: (typeof prisma)["timeSlot"]["findMany"] };
  resource: { findMany: (typeof prisma)["resource"]["findMany"] };
};

// ── Errores de dominio ──────────────────────────────────────────────────────
// El endpoint HTTP los mapea a HttpError (status); el adapter managed_db los deja
// propagar como error CLARO (no un 500 opaco).

export class ServiceNotFoundError extends Error {
  /**
   * `available` viaja al modelo dentro del mensaje: sin la lista de nombres validos, ante un
   * servicio inventado el agente abandonaba la reserva en vez de reintentar con el correcto.
   */
  constructor(
    public readonly serviceRef: string,
    public readonly available: string[] = []
  ) {
    super(
      available.length
        ? `Servicio no encontrado: "${serviceRef}". Servicios disponibles: ${available
            .map((n) => `"${n}"`)
            .join(", ")}. Vuelve a llamar con uno de estos nombres exactos.`
        : "Servicio no encontrado"
    );
    this.name = "ServiceNotFoundError";
  }
}

export class ScheduleNotConfiguredError extends Error {
  constructor() {
    super("Agente sin horario configurado");
    this.name = "ScheduleNotConfiguredError";
  }
}

export class SlotUnavailableError extends Error {
  constructor(public readonly startTime: string) {
    super("El slot ya no esta disponible");
    this.name = "SlotUnavailableError";
  }
}

export class AppointmentNotFoundError extends Error {
  constructor(public readonly appointmentId: string) {
    super("Cita no encontrada");
    this.name = "AppointmentNotFoundError";
  }
}

export class AppointmentAlreadyCancelledError extends Error {
  constructor() {
    super("Cita ya cancelada");
    this.name = "AppointmentAlreadyCancelledError";
  }
}

/**
 * Grupo por encima de `Service.maxPartySize`. Se separa de "no hay hueco" a proposito: un
 * grupo de 14 en un restaurante no es un fallo de disponibilidad, es un caso que se gestiona
 * por otro canal. Si se devolviese como "no hay disponibilidad" el agente ofreceria otras
 * horas eternamente para un grupo que nunca cabra.
 */
export class GroupTooLargeError extends Error {
  constructor(
    public readonly partySize: number,
    public readonly maxPartySize: number
  ) {
    super(
      `Este servicio acepta reservas online de hasta ${maxPartySize} ` +
        `${maxPartySize === 1 ? "persona" : "personas"}, y se han pedido ${partySize}. ` +
        "Los grupos mas grandes se gestionan por el canal de grupos y eventos del negocio: " +
        "indicaselo al cliente con los datos de contacto de tus instrucciones y NO intentes " +
        "otras horas."
    );
    this.name = "GroupTooLargeError";
  }
}

/**
 * Reserva no localizable con los datos aportados.
 *
 * Un unico error para tres situaciones distintas —codigo inexistente, codigo correcto con
 * contacto que no coincide, y codigo de otro agente— y con el MISMO mensaje. Distinguirlas
 * convertiria la tool en un oraculo para averiguar si un codigo existe y a quien pertenece.
 */
export class BookingNotFoundError extends Error {
  constructor() {
    super(
      "No encuentro ninguna reserva con ese codigo y esos datos de contacto. " +
        "Comprueba con el cliente el codigo y el email o telefono con el que reservo."
    );
    this.name = "BookingNotFoundError";
  }
}

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface AvailableSlot {
  startTime: string;
  endTime: string;
  /**
   * Recursos elegibles y libres en ese instante, para que `createAppointment` asigne sin
   * repetir el calculo. Ausente cuando el agente no tiene inventario declarado (unidad
   * implicita). No se expone al visitante: `routes/booking.ts` proyecta solo start/end.
   */
  freeResourceIds?: string[];
}

export interface CreateAppointmentInput {
  serviceId: string;
  slotStart: Date;
  slotEnd: Date;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  leadId?: string | null;
  /** Numero de personas. 1 por defecto: un agente legado se comporta igual que antes. */
  partySize?: number;
  customerName?: string | null;
}

export interface CreatedAppointment {
  appointmentId: string;
  slotId: string;
  startTime: Date;
  endTime: Date;
  service: { id: string; name: string; agentId: string };
  partySize: number;
  confirmationCode: string;
  resource: { id: string; name: string; zone: string | null };
}

/** Reserva vista desde el cliente final: lo que la tool `consultar_mis_reservas` devuelve. */
export interface BookingSummary {
  id: string;
  codigo: string | null;
  servicio: string;
  startTime: string;
  endTime: string;
  comensales: number;
  zona: string | null;
  estado: string;
}

// ── Disponibilidad ──────────────────────────────────────────────────────────

/**
 * Slots libres de un servicio para un grupo de `partySize` personas.
 *
 * Un slot se ofrece cuando existe AL MENOS UN recurso elegible sin ocupacion solapada, no
 * cuando "el servicio esta libre a esa hora". Es lo que separa un restaurante de doce mesas de
 * uno de una sola: con el modelo anterior (unique por servicio e instante) las doce mesas
 * aceptaban una reserva a las 21:00 en total.
 *
 * Elegibilidad = el recurso presta el servicio (`ServiceResource`, vacio = todos los del
 * agente) Y su rango de capacidad contiene al grupo. Ocupacion = intervalo semiabierto
 * `[inicio, fin + buffer)`, con el buffer aplicado a AMBOS lados: una reserva que termina a
 * las 15:00 con 15 min de limpieza no deja la cabina libre a las 15:00.
 *
 * Un agente SIN recursos declarados conserva el comportamiento previo a la migracion: una
 * sola unidad implicita por servicio, descontando por coincidencia exacta de inicio.
 *
 * Lanza `ServiceNotFoundError`/`ScheduleNotConfiguredError` para no producir un 500 opaco, y
 * `GroupTooLargeError` cuando el grupo excede `Service.maxPartySize`.
 */
export async function computeAvailableSlots(
  serviceId: string,
  rango: { desde: Date; hasta: Date },
  // Cliente Prisma sobre el que leer. Por defecto el global, asi que TODAS las
  // llamadas existentes siguen igual. `createAppointment` le pasa su `tx` para
  // que la comprobacion de disponibilidad y la escritura de la franja caigan en
  // la MISMA transaccion Serializable: si se leyera fuera, entre el "esta libre"
  // y el INSERT cabria otra reserva.
  client: PrismaReadClient = prisma,
  partySize = 1
): Promise<AvailableSlot[]> {
  const service = await client.service.findUnique({
    where: { id: serviceId },
    include: {
      agent: { include: { schedule: true } },
      resources: { include: { resource: true } },
    },
  });
  if (!service) throw new ServiceNotFoundError(serviceId);

  const schedule = service.agent.schedule;
  if (!schedule) throw new ScheduleNotConfiguredError();

  const party = Number.isFinite(partySize) && partySize > 0 ? Math.floor(partySize) : 1;
  if (party > service.maxPartySize) throw new GroupTooLargeError(party, service.maxPartySize);

  // El horario del SERVICIO manda sobre el del agente cuando existe: los turnos de comida y
  // cena de un restaurante no son las horas de apertura del negocio, y el domingo puede tener
  // comida sin cena. Misma gramatica que `AgentSchedule.schedule` (mismo parser, un solo
  // sitio donde puede vivir el bug de las claves de dia).
  const ownSchedule = service.schedule as Record<string, string> | null;
  const scheduleJson =
    ownSchedule && Object.keys(ownSchedule).length > 0
      ? ownSchedule
      : (schedule.schedule as Record<string, string>) || {};

  const blocked = await client.blockedRange.findMany({
    where: { scheduleId: schedule.id },
  });

  const theoretical = generateSlots(
    rango.desde,
    rango.hasta,
    service.duration,
    scheduleJson,
    schedule.timezone,
    blocked,
    service.slotStepMin
  );
  if (theoretical.length === 0) return [];

  // ── Inventario elegible ──
  let eligible = service.resources.map((l) => l.resource).filter((r) => r.enabled);
  if (eligible.length === 0) {
    // Sin vinculos explicitos, todo el inventario del agente presta el servicio. Mantiene la
    // migracion sin ruido: no hace falta vincular nada para que un negocio de un solo
    // recurso funcione.
    eligible = await client.resource.findMany({
      where: { agentId: service.agentId, enabled: true },
    });
  }

  if (eligible.length === 0) {
    // Camino legado: unidad implicita. Se indexa por instante (ms), no por cadena:
    // `generateSlots` emite el ISO de luxon con offset local ("...T09:00:00.000+02:00") y
    // `Date.toISOString()` da UTC ("...T07:00:00.000Z"). Comparadas como texto no casaban
    // nunca, asi que las franjas ya reservadas NO se descontaban.
    const existingSlots = await client.timeSlot.findMany({
      where: { serviceId, available: false },
      select: { startTime: true },
    });
    const booked = new Set(existingSlots.map((s: { startTime: Date }) => s.startTime.getTime()));
    return theoretical.filter((s) => !booked.has(new Date(s.startTime).getTime()));
  }

  const fitting = eligible.filter((r) => r.capacityMin <= party && party <= r.capacityMax);
  if (fitting.length === 0) return [];

  // Ventana holgada a proposito: cualquier franja que pueda solapar el rango pedido, sin
  // afinar por duracion ni buffer. Un dia de margen es barato y evita descartar por error una
  // ocupacion que empieza la vispera.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const occupied = await client.timeSlot.findMany({
    where: {
      resourceId: { in: fitting.map((r) => r.id) },
      available: false,
      startTime: { lt: new Date(rango.hasta.getTime() + DAY_MS) },
      endTime: { gt: new Date(rango.desde.getTime() - DAY_MS) },
    },
    select: {
      resourceId: true,
      startTime: true,
      endTime: true,
      service: { select: { bufferMin: true } },
    },
  });

  type Busy = { start: number; end: number };
  const busyByResource = new Map<string, Busy[]>();
  for (const o of occupied as Array<{
    resourceId: string;
    startTime: Date;
    endTime: Date;
    service: { bufferMin: number } | null;
  }>) {
    const list = busyByResource.get(o.resourceId) ?? [];
    // El buffer de la reserva EXISTENTE prolonga su ocupacion; el de la nueva se suma abajo.
    // Asi la separacion se respeta en los dos sentidos.
    list.push({
      start: o.startTime.getTime(),
      end: o.endTime.getTime() + (o.service?.bufferMin ?? 0) * 60_000,
    });
    busyByResource.set(o.resourceId, list);
  }

  const holdMs = (service.duration + service.bufferMin) * 60_000;

  const out: AvailableSlot[] = [];
  for (const slot of theoretical) {
    const start = new Date(slot.startTime).getTime();
    const end = start + holdMs;
    const free = fitting.filter((r) => {
      const busy = busyByResource.get(r.id);
      // Intervalo semiabierto: una reserva que acaba a las 15:00 NO bloquea las 15:00.
      return !busy?.some((b) => b.start < end && b.end > start);
    });
    if (free.length > 0) {
      out.push({ ...slot, freeResourceIds: free.map((r) => r.id) });
    }
  }
  return out;
}

// ── Codigo de confirmacion ──────────────────────────────────────────────────

/**
 * Alfabeto sin caracteres confundibles al dictarlos por telefono o leerlos en un chat:
 * fuera 0/O, 1/I/L y 5/S. El codigo se dice en voz alta mas veces que se copia.
 */
const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY2346789";

function randomCode(prefix: string): string {
  let body = "";
  for (let i = 0; i < 4; i++) {
    body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return `${prefix}-${body}`;
}

/** Prefijo de tres letras derivado del nombre del negocio, para que el codigo sea reconocible. */
function codePrefix(agentName: string): string {
  const letters = agentName.toUpperCase().replace(/[^A-Z]/g, "");
  return letters.length >= 3 ? letters.slice(0, 3) : (letters + "RES").slice(0, 3);
}

// ── Creacion de reserva ─────────────────────────────────────────────────────

/**
 * Replica la transaccion de `routes/booking.ts` POST /reserve: crea la franja
 * (`franja_horaria`, `disponible=false`) y la cita (`cita`) en una transaccion
 * Serializable, y sincroniza el calendario externo post-transaccion (best-effort).
 *
 * El unique `(recurso_id, inicio)` de `franja_horaria` bloquea dobles reservas concurrentes
 * SOBRE EL MISMO RECURSO: un choque emerge como `P2002` y se traduce a
 * `SlotUnavailableError`. Contra solapamientos que no comparten instante de inicio protege el
 * nivel Serializable, no el indice.
 *
 * La asignacion es best fit: de los recursos libres y elegibles se toma el de menor capacidad
 * que admite al grupo. Sentar a dos personas en la mesa de ocho porque estaba primera en la
 * lista deja al restaurante sin poder aceptar al grupo de ocho que llame despues.
 */
export async function createAppointment(input: CreateAppointmentInput): Promise<CreatedAppointment> {
  const { serviceId, slotStart, slotEnd, email, phone, notes, leadId, customerName } = input;
  const party =
    Number.isFinite(input.partySize) && (input.partySize ?? 0) > 0
      ? Math.floor(input.partySize as number)
      : 1;

  let result: {
    slot: { id: string; startTime: Date; endTime: Date };
    appointment: {
      id: string;
      partySize: number;
      confirmationCode: string | null;
      service: { id: string; name: string; agentId: string };
    };
    resource: { id: string; name: string; zone: string | null };
  };
  try {
    result = await prisma.$transaction(
      async (tx) => {
        // GUARDA DE INTEGRIDAD: la franja pedida tiene que ser un hueco REAL y libre
        // del horario del agente. Sin esto, `crear_reserva` escribia literalmente la
        // hora que el LLM devolviese — se observaron citas a las 00:00 en un agente
        // con horario L-V 09:00-18:00 — y `POST /reserve` aceptaba lo mismo desde
        // fuera. Se compara contra `computeAvailableSlots`, la MISMA fuente que
        // alimenta `GET /slots` y la tool `consultar_disponibilidad`, para que no
        // pueda reservarse nada que la UI no ofreceria.
        //
        // Va DENTRO de la transaccion Serializable y leyendo por `tx`: el check y el
        // INSERT quedan serializados frente a reservas concurrentes.
        const libres = await computeAvailableSlots(
          serviceId,
          { desde: slotStart, hasta: slotEnd },
          tx,
          party
        );
        // Coincidencia EXACTA en ambos extremos, no "cae dentro del horario": si se
        // aceptara cualquier intervalo contenido, el modelo podria inventar 09:07-09:37
        // y la rejilla dejaria de casar con la que se ofrece en `GET /slots`.
        //
        // Se comparan INSTANTES, no cadenas: `computeAvailableSlots` emite el ISO de luxon
        // con offset local ("...T09:00:00.000+02:00") y aqui se parte de un `Date`, cuyo
        // `toISOString()` es UTC ("...T07:00:00.000Z"). Es el mismo momento y la comparacion
        // textual fallaba SIEMPRE: toda reserva se rechazaba como "slot ya ocupado".
        const startMs = slotStart.getTime();
        const endMs = slotEnd.getTime();
        const match = libres.find(
          (s) => new Date(s.startTime).getTime() === startMs && new Date(s.endTime).getTime() === endMs
        );
        if (!match) throw new SlotUnavailableError(slotStart.toISOString());

        const svc = await tx.service.findUniqueOrThrow({
          where: { id: serviceId },
          select: { agentId: true, name: true, agent: { select: { name: true } } },
        });

        const resource = match.freeResourceIds?.length
          ? await pickBestFit(tx, match.freeResourceIds, party)
          : await ensureImplicitResource(tx, serviceId, svc.agentId, svc.name);

        const slot = await tx.timeSlot.create({
          data: {
            serviceId,
            resourceId: resource.id,
            startTime: slotStart,
            endTime: slotEnd,
            available: false,
          },
        });

        // El codigo es unico global, asi que un choque es posible aunque improbable
        // (27^4 ≈ 531k por prefijo). Se reintenta en vez de romper la reserva del cliente.
        const prefix = codePrefix(svc.agent.name);
        let appointment;
        for (let attempt = 0; ; attempt++) {
          try {
            appointment = await tx.appointment.create({
              data: {
                slotId: slot.id,
                serviceId,
                leadId: leadId ?? undefined,
                email: email ?? undefined,
                phone: phone ?? undefined,
                notes: notes ?? undefined,
                startTime: slotStart,
                endTime: slotEnd,
                partySize: party,
                customerName: customerName ?? undefined,
                confirmationCode: randomCode(prefix),
              },
              include: { service: true },
            });
            break;
          } catch (err) {
            const isCodeCollision =
              (err as { code?: string }).code === "P2002" &&
              String((err as { meta?: { target?: unknown } }).meta?.target ?? "").includes(
                "codigo_confirmacion"
              );
            if (!isCodeCollision || attempt >= 4) throw err;
          }
        }

        return { slot, appointment, resource };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err) {
    // Colision del unique (servicio_id, inicio): el slot ya esta reservado.
    if ((err as { code?: string }).code === "P2002") {
      throw new SlotUnavailableError(slotStart.toISOString());
    }
    throw err;
  }

  const service = result.appointment.service;

  // Sincronizar calendario externo (post-transaccion, best-effort — nunca rompe).
  const gcalIntegration = await prisma.integration.findFirst({
    where: { agentId: service.agentId, provider: "google" },
  });
  if (gcalIntegration) {
    syncAppointmentToGcal(gcalIntegration, result.appointment.id, result.slot, service).catch((err) =>
      logger.error({ err }, "[booking] GCal sync failed, will retry:")
    );
  }

  return {
    appointmentId: result.appointment.id,
    slotId: result.slot.id,
    startTime: result.slot.startTime,
    endTime: result.slot.endTime,
    service: { id: service.id, name: service.name, agentId: service.agentId },
    partySize: result.appointment.partySize ?? party,
    confirmationCode: result.appointment.confirmationCode ?? "",
    resource: result.resource,
  };
}

// ── Asignacion de recurso ───────────────────────────────────────────────────

type PrismaWriteClient = {
  resource: {
    findMany: (typeof prisma)["resource"]["findMany"];
    findFirst: (typeof prisma)["resource"]["findFirst"];
    create: (typeof prisma)["resource"]["create"];
  };
  serviceResource: { createMany: (typeof prisma)["serviceResource"]["createMany"] };
};

/**
 * Best fit: de los candidatos libres, el de menor capacidad maxima que admite al grupo.
 * Empates por capacidad minima y luego por nombre, para que la asignacion sea determinista y
 * los tests no dependan del orden de la BD.
 */
async function pickBestFit(
  client: Pick<PrismaWriteClient, "resource">,
  candidateIds: string[],
  party: number
): Promise<{ id: string; name: string; zone: string | null }> {
  const candidates = await client.resource.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, name: true, zone: true, capacityMin: true, capacityMax: true },
    orderBy: [{ capacityMax: "asc" }, { capacityMin: "asc" }, { name: "asc" }],
  });
  const best = candidates.find((r) => r.capacityMin <= party && party <= r.capacityMax);
  if (!best) throw new SlotUnavailableError(new Date().toISOString());
  return { id: best.id, name: best.name, zone: best.zone };
}

/**
 * Recurso implicito para un agente que no declara inventario.
 *
 * `franja_horaria.recurso_id` es NOT NULL, asi que una reserva necesita un recurso real
 * aunque el negocio nunca haya configurado mesas ni cabinas. Se crea uno por servicio (no por
 * agente) y se vincula: mismo criterio que el backfill de la migracion, y con el vinculo la
 * capacidad de un servicio no depende de los recursos de otro.
 */
async function ensureImplicitResource(
  client: PrismaWriteClient,
  serviceId: string,
  agentId: string,
  serviceName: string
): Promise<{ id: string; name: string; zone: string | null }> {
  const existing = await client.resource.findFirst({
    where: { agentId, name: serviceName },
    select: { id: true, name: true, zone: true },
  });
  const resource =
    existing ??
    (await client.resource.create({
      data: { agentId, name: serviceName, kind: "room", capacityMin: 1, capacityMax: 1 },
      select: { id: true, name: true, zone: true },
    }));

  // `createMany` con skipDuplicates: idempotente sin necesidad de leer antes.
  await client.serviceResource.createMany({
    data: [{ serviceId, resourceId: resource.id }],
    skipDuplicates: true,
  });

  return resource;
}

// ── Cancelacion ─────────────────────────────────────────────────────────────

/**
 * Cancela una cita: BORRA la franja y marca la cita `cancelled` en una transaccion, y
 * desincroniza el calendario externo (best-effort). Lanza
 * `AppointmentNotFoundError`/`AppointmentAlreadyCancelledError` con mensaje claro.
 *
 * Se borra la franja en lugar de marcarla `disponible=true` porque el unique
 * `(recurso_id, inicio)` no distingue disponibles de ocupadas: con la fila viva, el hueco
 * liberado no se podia volver a reservar nunca — la reserva siguiente choca contra el indice.
 * `cita.franja_id` es nullable con `ON DELETE SET NULL`, asi que la cita sobrevive como
 * registro cancelado sin retener inventario.
 */
export async function cancelAppointment(
  appointmentId: string
): Promise<{ ok: boolean; estado: string }> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { slot: true, service: { include: { agent: true } } },
  });
  if (!appointment) throw new AppointmentNotFoundError(appointmentId);
  if (appointment.status === "cancelled") throw new AppointmentAlreadyCancelledError();

  await prisma.$transaction([
    ...(appointment.slotId
      ? [prisma.timeSlot.delete({ where: { id: appointment.slotId } })]
      : []),
    prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "cancelled" },
    }),
  ]);

  if (appointment.gcalEventId) {
    const gcalIntegration = await prisma.integration.findFirst({
      where: { agentId: appointment.service.agentId, provider: "google" },
    });
    if (gcalIntegration) {
      unsyncAppointmentFromGcal(gcalIntegration, appointment.gcalEventId).catch((err) =>
        logger.error({ err }, "[booking] GCal delete failed:")
      );
    }
  }

  return { ok: true, estado: "cancelled" };
}

// ── Autoservicio del cliente final (bot) ────────────────────────────────────

/** Normaliza un telefono a digitos para comparar: el cliente lo dicta como quiere. */
function normalisePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

/** Longitud del numero nacional en Espana. Ver `samePhone`. */
const DIGITOS_NUMERO_NACIONAL = 9;

/**
 * Mismo telefono dictado de dos formas.
 *
 * Quitar los separadores no basta: "+34 600 11 22 33" deja 11 digitos y "600112233" deja 9, y
 * son el MISMO numero. Cuando ambos llegan al numero nacional completo se comparan sus ultimos
 * 9 digitos, con lo que el prefijo de pais deja de importar. Por debajo de esa longitud se
 * exige igualdad exacta: comparar por sufijo cadenas cortas igualaria numeros distintos.
 *
 * Contrapartida aceptada: dos numeros de paises distintos que compartan los 9 ultimos digitos
 * se tomarian por el mismo. Es despreciable, y el conjunto donde se compara ya esta acotado a
 * un unico codigo de reserva o a las reservas futuras de un solo negocio.
 */
function samePhone(a: string, b: string): boolean {
  const x = normalisePhone(a);
  const y = normalisePhone(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < DIGITOS_NUMERO_NACIONAL || y.length < DIGITOS_NUMERO_NACIONAL) return false;
  return x.slice(-DIGITOS_NUMERO_NACIONAL) === y.slice(-DIGITOS_NUMERO_NACIONAL);
}

/**
 * Comprueba el contacto CONTRA LA FILA, en memoria: email exacto (case-insensitive) o telefono
 * igual comparando solo digitos.
 *
 * La comparacion no puede hacerse en el `where` de la consulta. El telefono se guarda tal cual
 * lo dicta el cliente al reservar ("+34 600 11 22 33") y al cancelar lo dicta otra vez, a
 * menudo de otra forma ("600112233"): un `phone: <texto>` exacto en SQL no devuelve la fila, y
 * una normalizacion aplicada DESPUES de la consulta no puede recuperar lo que la consulta ya
 * descarto. Postgres no puede quitar separadores sin una funcion, asi que se acota por codigo
 * o por agente-y-futuro —conjuntos pequenos— y se compara aqui.
 */
function matchesContact(
  row: { email: string | null; phone: string | null },
  contacto: { email?: string | null; telefono?: string | null }
): boolean {
  const email = contacto.email?.trim();
  const telefono = contacto.telefono?.trim();
  const emailOk = !!email && !!row.email && row.email.toLowerCase() === email.toLowerCase();
  const phoneOk = !!telefono && !!row.phone && samePhone(row.phone, telefono);
  return emailOk || phoneOk;
}

/** Al menos un dato de contacto: sin ello, un codigo suelto cancelaria la reserva de otro. */
function hasContact(contacto: { email?: string | null; telefono?: string | null }): boolean {
  return !!contacto.email?.trim() || !!normalisePhone(contacto.telefono?.trim() ?? "");
}

/**
 * Reservas futuras y no canceladas de un contacto en ESTE agente.
 *
 * El filtro por `service.agentId` no es opcional: un mismo email puede haber reservado en
 * varios negocios de la plataforma, y el agente de uno no debe poder enumerar las reservas
 * hechas en otro.
 */
export async function listAppointmentsByContact(
  agentId: string,
  contacto: { email?: string | null; telefono?: string | null },
  now: Date = new Date()
): Promise<BookingSummary[]> {
  if (!hasContact(contacto)) throw new BookingNotFoundError();

  // La consulta acota por agente y por futuro; el contacto se comprueba en memoria (ver
  // `matchesContact`). El conjunto es pequeno —reservas futuras de UN negocio— y el filtro de
  // contacto no es opcional: sin el, cualquier email listaria todas las reservas del agente.
  const rows = await prisma.appointment.findMany({
    where: {
      service: { agentId },
      status: { not: "cancelled" },
      startTime: { gte: now },
    },
    include: {
      service: { select: { name: true } },
      slot: { select: { resource: { select: { zone: true } } } },
    },
    orderBy: { startTime: "asc" },
  });

  const filtered = rows.filter((a) => matchesContact(a, contacto));

  return filtered.map((a) => ({
    id: a.id,
    codigo: a.confirmationCode,
    servicio: a.service.name,
    startTime: a.startTime.toISOString(),
    endTime: a.endTime.toISOString(),
    comensales: a.partySize,
    zona: a.slot?.resource?.zone ?? null,
    estado: a.status,
  }));
}

/**
 * Cancela por codigo de confirmacion + contacto, acotado al agente.
 *
 * Tres condiciones deben cumplirse: el codigo existe, el contacto coincide con el de ESA
 * reserva, y la reserva cuelga de un servicio de ESTE agente. Cualquier fallo devuelve
 * `BookingNotFoundError` con el mismo mensaje — la diferencia no es observable desde fuera.
 */
export async function cancelAppointmentByCode(
  agentId: string,
  codigo: string,
  contacto: { email?: string | null; telefono?: string | null }
): Promise<{ ok: boolean; estado: string; startTime: string; servicio: string }> {
  const code = codigo?.trim().toUpperCase();
  if (!code) throw new BookingNotFoundError();
  if (!hasContact(contacto)) throw new BookingNotFoundError();

  // Se busca SOLO por codigo y agente: el contacto se comprueba despues, en memoria, porque el
  // telefono guardado y el dictado casi nunca tienen el mismo formato (ver `matchesContact`).
  // El codigo es unico global, asi que esto lee una fila.
  const found = await prisma.appointment.findFirst({
    where: {
      confirmationCode: code,
      service: { agentId },
    },
    include: { service: { select: { name: true } } },
  });
  if (!found) throw new BookingNotFoundError();
  if (!matchesContact(found, contacto)) throw new BookingNotFoundError();

  if (found.status === "cancelled") throw new AppointmentAlreadyCancelledError();

  const startTime = found.startTime.toISOString();
  await cancelAppointment(found.id);
  return { ok: true, estado: "cancelled", startTime, servicio: found.service.name };
}
