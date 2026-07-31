/**
 * Cancelar libera el hueco de verdad: se puede volver a reservar
 * (aa-reservas-multirecurso-y-mocks-sectoriales, bloque E: ultimo caso de T5.2).
 *
 * El resto de casos de cancelacion (codigo inexistente, contacto que no coincide, codigo de
 * otro negocio, ya cancelada) viven en `booking-cancelacion-cliente.test.ts` sobre mocks
 * planos. Este no puede: la pregunta "¿el hueco vuelve a estar libre?" no se contesta
 * afirmando que se llamo a `timeSlot.delete`, porque el fallo que importa esta en la BD.
 * `franja_horaria` tiene un unique `(recurso_id, inicio)` que NO distingue disponibles de
 * ocupadas: si al cancelar se marcase `disponible = true` en vez de borrar la fila, la
 * siguiente reserva del mismo instante chocaria contra el indice y el hueco quedaria muerto
 * para siempre.
 *
 * Por eso aqui hay una tabla en memoria que respeta esa semantica —el unique, y el
 * `ON DELETE SET NULL` de `cita.franja_id`— y los caminos REALES de escritura y lectura
 * (`computeAvailableSlots` → `createAppointment` → `cancelAppointmentByCode`) corren contra
 * ella. Comprobado por mutacion: cambiando el borrado de la franja por un
 * `update({ available: true })` en `cancelAppointment`, el ultimo test falla con
 * `SlotUnavailableError`.
 *
 * `generateSlots` NO se mockea: la rejilla teorica es parte de lo que se afirma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Tabla en memoria ────────────────────────────────────────────────────────

type SlotRow = {
  id: string;
  serviceId: string;
  resourceId: string;
  startTime: Date;
  endTime: Date;
  available: boolean;
};

type CitaRow = {
  id: string;
  slotId: string | null;
  serviceId: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  startTime: Date;
  endTime: Date;
  partySize: number;
  customerName: string | null;
  confirmationCode: string | null;
  status: string;
  gcalEventId: string | null;
};

const db = {
  slots: [] as SlotRow[],
  citas: [] as CitaRow[],
  seq: 0,
};

const nextId = (prefijo: string) => `${prefijo}-${++db.seq}`;

/** Error de Prisma tal y como lo lee el codigo bajo prueba: `code` + `meta.target`. */
function p2002(target: string[]) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target },
  });
}

/** Dos mesas: para un grupo de 2 solo cabe la primera. Es lo que hace mordible el test. */
const RECURSOS = [
  { id: "m1", name: "Mesa 1", zone: "Comedor", capacityMin: 1, capacityMax: 2, enabled: true },
  { id: "m2", name: "Mesa 5", zone: "Comedor", capacityMin: 3, capacityMax: 6, enabled: true },
];

const SERVICIO = {
  id: "svc-1",
  agentId: "agent-1",
  name: "Cena",
  duration: 30,
  slotStepMin: 30,
  bufferMin: 0,
  maxPartySize: 8,
  schedule: null as Record<string, string> | null,
  agent: {
    name: "Casa Mendieta",
    // 2026-08-04 es martes. En Madrid (CEST) las 21:00 locales son las 19:00Z.
    schedule: { id: "sch-1", timezone: "Europe/Madrid", schedule: { tue: "13:00-23:00" } },
  },
};

/**
 * Ordena obedeciendo el `orderBy` RECIBIDO, no el que se considere correcto. Un mock que
 * reordena por su cuenta deja pasar un `capacityMax: "desc"` en el fuente — ya ocurrio en
 * `booking-multirecurso.test.ts`.
 */
function ordenarComoLaBD<T extends Record<string, unknown>>(
  filas: T[],
  orderBy: Array<Record<string, "asc" | "desc">> = []
): T[] {
  const criterios = orderBy.map((o) => {
    const [campo, dir] = Object.entries(o)[0];
    return { campo, signo: dir === "desc" ? -1 : 1 };
  });
  return [...filas].sort((a, b) => {
    for (const { campo, signo } of criterios) {
      const va = a[campo] as string | number;
      const vb = b[campo] as string | number;
      if (va < vb) return -1 * signo;
      if (va > vb) return 1 * signo;
    }
    return 0;
  });
}

const facade = {
  service: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id === SERVICIO.id
        ? { ...SERVICIO, resources: RECURSOS.map((r) => ({ resource: r })) }
        : null
    ),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id !== SERVICIO.id) throw new Error("service not found");
      return { agentId: SERVICIO.agentId, name: SERVICIO.name, agent: { name: SERVICIO.agent.name } };
    }),
  },

  blockedRange: { findMany: vi.fn(async () => []) },

  resource: {
    findMany: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: { id?: { in: string[] }; agentId?: string; enabled?: boolean };
        orderBy?: Array<Record<string, "asc" | "desc">>;
      }) => {
        let filas = RECURSOS.filter((r) => (where.enabled === undefined ? true : r.enabled === where.enabled));
        if (where.id?.in) filas = filas.filter((r) => where.id!.in.includes(r.id));
        return ordenarComoLaBD(filas, orderBy);
      }
    ),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async () => {
      throw new Error("no deberia crearse recurso implicito: el servicio tiene inventario");
    }),
  },

  serviceResource: { createMany: vi.fn(async () => ({ count: 0 })) },

  timeSlot: {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: {
          serviceId?: string;
          resourceId?: { in: string[] };
          available?: boolean;
          startTime?: { lt: Date };
          endTime?: { gt: Date };
        };
      }) =>
        db.slots
          .filter((s) => (where.serviceId ? s.serviceId === where.serviceId : true))
          .filter((s) => (where.resourceId?.in ? where.resourceId.in.includes(s.resourceId) : true))
          .filter((s) => (where.available === undefined ? true : s.available === where.available))
          .filter((s) => (where.startTime?.lt ? s.startTime < where.startTime.lt : true))
          .filter((s) => (where.endTime?.gt ? s.endTime > where.endTime.gt : true))
          .map((s) => ({
            resourceId: s.resourceId,
            startTime: s.startTime,
            endTime: s.endTime,
            service: { bufferMin: SERVICIO.bufferMin },
          }))
    ),

    // El unique `(recurso_id, inicio)` de `franja_horaria`, que es lo que este test existe
    // para ejercitar: no distingue `disponible = true` de `false`.
    create: vi.fn(async ({ data }: { data: Omit<SlotRow, "id"> }) => {
      const choca = db.slots.some(
        (s) => s.resourceId === data.resourceId && s.startTime.getTime() === data.startTime.getTime()
      );
      if (choca) throw p2002(["recurso_id", "inicio"]);
      const fila: SlotRow = { id: nextId("fr"), ...data };
      db.slots.push(fila);
      return fila;
    }),

    // Existe para que la mutacion "marcar disponible en vez de borrar" sea EJECUTABLE: si el
    // mock no ofreciera `update`, esa mutacion moriria por falta de metodo, no por el unique.
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const fila = db.slots.find((s) => s.id === where.id);
      if (!fila) throw Object.assign(new Error("Record to update not found"), { code: "P2025" });
      Object.assign(fila, data);
      return fila;
    }),

    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const i = db.slots.findIndex((s) => s.id === where.id);
      if (i === -1) throw Object.assign(new Error("Record to delete does not exist"), { code: "P2025" });
      const [fila] = db.slots.splice(i, 1);
      // `cita.franja_id` es nullable con ON DELETE SET NULL: la cita sobrevive sin inventario.
      for (const c of db.citas) if (c.slotId === fila.id) c.slotId = null;
      return fila;
    }),
  },

  appointment: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const codigo = (data.confirmationCode as string) ?? null;
      if (codigo && db.citas.some((c) => c.confirmationCode === codigo)) {
        throw p2002(["codigo_confirmacion"]);
      }
      const fila: CitaRow = {
        id: nextId("cita"),
        slotId: (data.slotId as string) ?? null,
        serviceId: data.serviceId as string,
        email: (data.email as string) ?? null,
        phone: (data.phone as string) ?? null,
        notes: (data.notes as string) ?? null,
        startTime: data.startTime as Date,
        endTime: data.endTime as Date,
        partySize: (data.partySize as number) ?? 1,
        customerName: (data.customerName as string) ?? null,
        confirmationCode: codigo,
        status: "scheduled",
        gcalEventId: null,
      };
      db.citas.push(fila);
      return { ...fila, service: { id: SERVICIO.id, name: SERVICIO.name, agentId: SERVICIO.agentId } };
    }),

    findFirst: vi.fn(async ({ where }: { where: { confirmationCode?: string; service?: { agentId: string } } }) => {
      const fila = db.citas.find(
        (c) =>
          (where.confirmationCode ? c.confirmationCode === where.confirmationCode : true) &&
          (where.service?.agentId ? SERVICIO.agentId === where.service.agentId : true)
      );
      return fila ? { ...fila, service: { name: SERVICIO.name, agentId: SERVICIO.agentId } } : null;
    }),

    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const fila = db.citas.find((c) => c.id === where.id);
      if (!fila) return null;
      return {
        ...fila,
        slot: db.slots.find((s) => s.id === fila.slotId) ?? null,
        service: { ...SERVICIO, agent: SERVICIO.agent },
      };
    }),

    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const fila = db.citas.find((c) => c.id === where.id);
      if (!fila) throw new Error("cita no encontrada");
      Object.assign(fila, data);
      return fila;
    }),
  },

  integration: { findFirst: vi.fn(async () => null) },
  agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },

  // Las dos formas: callback (`createAppointment`) y array (`cancelAppointment`).
  $transaction: vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(facade)
      : Promise.all(arg as Promise<unknown>[])
  ),
};

// `vi.mock` se iza por encima de `const facade`, asi que la fabrica NO puede leerlo aqui: se
// entrega un proxy que resuelve cada propiedad en el momento del acceso, ya inicializado.
vi.mock("@/lib/db", () => ({
  prisma: new Proxy(
    {},
    { get: (_t, k: string) => (facade as unknown as Record<string, unknown>)[k] }
  ),
}));
vi.mock("@/lib/booking/sync", () => ({
  syncAppointmentToGcal: vi.fn(),
  unsyncAppointmentFromGcal: vi.fn(),
}));

import {
  computeAvailableSlots,
  createAppointment,
  cancelAppointmentByCode,
  SlotUnavailableError,
} from "@/lib/booking/appointments";

const RANGO = {
  desde: new Date("2026-08-04T00:00:00.000Z"),
  hasta: new Date("2026-08-04T23:59:59.000Z"),
};
/** Las 21:00 en el reloj del negocio. */
const CENA_INICIO = new Date("2026-08-04T19:00:00.000Z");
const CENA_FIN = new Date("2026-08-04T19:30:00.000Z");
const CONTACTO = { email: "ana@example.com", phone: "+34 600 11 22 33" };

const ofrece = (huecos: Array<{ startTime: string }>, instante: Date) =>
  huecos.some((h) => new Date(h.startTime).getTime() === instante.getTime());

async function reservarCena(partySize = 2) {
  return createAppointment({
    serviceId: SERVICIO.id,
    slotStart: CENA_INICIO,
    slotEnd: CENA_FIN,
    email: CONTACTO.email,
    phone: CONTACTO.phone,
    partySize,
    customerName: "Ana",
  });
}

beforeEach(() => {
  db.slots = [];
  db.citas = [];
  db.seq = 0;
  vi.clearAllMocks();
});

describe("cancelar libera el hueco y se puede volver a reservar", () => {
  it("una mesa ocupada deja de ofrecerse y la segunda reserva se rechaza", async () => {
    const antes = await computeAvailableSlots(SERVICIO.id, RANGO, undefined, 2);
    expect(ofrece(antes, CENA_INICIO)).toBe(true);

    const reserva = await reservarCena();
    expect(reserva.resource.id).toBe("m1"); // best fit: la de 6 no se quema con dos personas

    const despues = await computeAvailableSlots(SERVICIO.id, RANGO, undefined, 2);
    expect(ofrece(despues, CENA_INICIO)).toBe(false);
    await expect(reservarCena()).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("tras cancelar, el instante vuelve a ofrecerse y se reserva otra vez", async () => {
    const primera = await reservarCena();
    expect(db.slots).toHaveLength(1);

    const cancelada = await cancelAppointmentByCode("agent-1", primera.confirmationCode, {
      email: CONTACTO.email,
    });
    expect(cancelada.estado).toBe("cancelled");

    // La franja se BORRA: con la fila viva (aunque fuese `disponible = true`) el unique
    // `(recurso_id, inicio)` impediria reservar ese instante nunca mas.
    expect(db.slots).toHaveLength(0);

    const libres = await computeAvailableSlots(SERVICIO.id, RANGO, undefined, 2);
    expect(ofrece(libres, CENA_INICIO)).toBe(true);

    const segunda = await reservarCena();
    expect(segunda.resource.id).toBe("m1");
    expect(segunda.appointmentId).not.toBe(primera.appointmentId);
    expect(db.slots).toHaveLength(1);
  });

  it("la cita cancelada conserva su fecha aunque ya no tenga franja", async () => {
    const primera = await reservarCena();
    await cancelAppointmentByCode("agent-1", primera.confirmationCode, { email: CONTACTO.email });

    const cita = db.citas.find((c) => c.id === primera.appointmentId)!;
    expect(cita.status).toBe("cancelled");
    expect(cita.slotId).toBeNull();
    expect(cita.startTime.toISOString()).toBe(CENA_INICIO.toISOString());
    expect(cita.endTime.toISOString()).toBe(CENA_FIN.toISOString());
  });

  it("cancelar una reserva no libera el hueco de otra mesa distinta", async () => {
    const dosPersonas = await reservarCena(2);
    const cuatroPersonas = await createAppointment({
      serviceId: SERVICIO.id,
      slotStart: CENA_INICIO,
      slotEnd: CENA_FIN,
      email: "otro@example.com",
      partySize: 4,
    });
    expect(cuatroPersonas.resource.id).toBe("m2");
    expect(db.slots).toHaveLength(2);

    await cancelAppointmentByCode("agent-1", dosPersonas.confirmationCode, { email: CONTACTO.email });

    // Solo se fue la franja de m1: el grupo de 4 sigue sentado.
    expect(db.slots.map((s) => s.resourceId)).toEqual(["m2"]);
    const paraCuatro = await computeAvailableSlots(SERVICIO.id, RANGO, undefined, 4);
    expect(ofrece(paraCuatro, CENA_INICIO)).toBe(false);
    const paraDos = await computeAvailableSlots(SERVICIO.id, RANGO, undefined, 2);
    expect(ofrece(paraDos, CENA_INICIO)).toBe(true);
  });
});
