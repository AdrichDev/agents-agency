/**
 * Disponibilidad y asignacion con inventario real
 * (aa-reservas-multirecurso-y-mocks-sectoriales, bloque E: T5.1, T5.3).
 *
 * Fallo que motiva el cambio: el unique de `franja_horaria` era `(servicio_id, inicio)`, asi
 * que un restaurante de doce mesas aceptaba UNA sola reserva a las 21:00 — las doce mesas
 * competian por la misma fila. Y al contrario: sin capacidades, una pareja podia quedarse con
 * la mesa de ocho y dejar al grupo de ocho sin sitio.
 *
 * Tests herméticos: `@/lib/db` y `generateSlots` mockeados. `generateSlots` esta cubierto
 * aparte en `booking-slots.test.ts`; aqui interesa lo que se hace CON la rejilla, y los
 * argumentos con los que se pide.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const txMock = {
  timeSlot: { create: vi.fn(), findMany: vi.fn() },
  appointment: { create: vi.fn() },
  service: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  blockedRange: { findMany: vi.fn() },
  resource: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  serviceResource: { createMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findUnique: vi.fn() },
    blockedRange: { findMany: vi.fn() },
    timeSlot: { findMany: vi.fn() },
    resource: { findMany: vi.fn() },
    integration: { findFirst: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: typeof txMock) => Promise<unknown>)(txMock);
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  },
}));

vi.mock("@/lib/booking/slots", () => ({ generateSlots: vi.fn() }));
vi.mock("@/lib/booking/sync", () => ({
  syncAppointmentToGcal: vi.fn(),
  unsyncAppointmentFromGcal: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { generateSlots } from "@/lib/booking/slots";
import {
  computeAvailableSlots,
  createAppointment,
  GroupTooLargeError,
  SlotUnavailableError,
} from "@/lib/booking/appointments";

const mServiceFindUnique = prisma.service.findUnique as ReturnType<typeof vi.fn>;
const mBlockedFindMany = prisma.blockedRange.findMany as ReturnType<typeof vi.fn>;
const mSlotFindMany = prisma.timeSlot.findMany as ReturnType<typeof vi.fn>;
const mResourceFindMany = prisma.resource.findMany as ReturnType<typeof vi.fn>;
const mIntegrationFindFirst = prisma.integration.findFirst as ReturnType<typeof vi.fn>;
const mGenerateSlots = generateSlots as ReturnType<typeof vi.fn>;

// ── Fixtures ────────────────────────────────────────────────────────────────

type Mesa = {
  id: string;
  name: string;
  zone: string | null;
  capacityMin: number;
  capacityMax: number;
  enabled: boolean;
};

/** Comedor de cuatro mesas con rangos de capacidad distintos, como el mock de Casa Mendieta. */
const COMEDOR: Mesa[] = [
  { id: "m1", name: "Mesa 1", zone: "Comedor", capacityMin: 1, capacityMax: 2, enabled: true },
  { id: "m2", name: "Mesa 2", zone: "Comedor", capacityMin: 1, capacityMax: 2, enabled: true },
  { id: "m3", name: "Mesa 3", zone: "Comedor", capacityMin: 2, capacityMax: 4, enabled: true },
  { id: "m5", name: "Mesa 5", zone: "Comedor", capacityMin: 3, capacityMax: 6, enabled: true },
];

const RANGO = {
  desde: new Date("2026-08-04T00:00:00.000Z"),
  hasta: new Date("2026-08-04T23:59:59.000Z"),
};
/** 15:00-15:30 UTC. Los tests de solape se apoyan en estas horas. */
const SLOT = { startTime: "2026-08-04T15:00:00.000Z", endTime: "2026-08-04T15:30:00.000Z" };
const T = (hhmm: string) => new Date(`2026-08-04T${hhmm}:00.000Z`);

function servicio(over: Record<string, unknown> = {}) {
  return {
    id: "svc-1",
    agentId: "agent-1",
    duration: 30,
    slotStepMin: 30,
    bufferMin: 0,
    maxPartySize: 8,
    schedule: null,
    resources: [],
    agent: {
      schedule: { id: "sch-1", timezone: "Europe/Madrid", schedule: { tue: "13:00-23:00" } },
    },
    ...over,
  };
}

/**
 * Ordena OBEDECIENDO el `orderBy` que pasa el codigo, como haria Postgres. Es la diferencia
 * entre un test que muerde y uno decorativo: si el mock reordenase por su cuenta con el
 * criterio "correcto", invertir el `orderBy` real de `pickBestFit` seguiria pasando en verde.
 * Comprobado por mutacion: con `capacityMax: "desc"` en el codigo, el test del best fit falla.
 */
function ordenarComoLaBD(rows: Mesa[], orderBy: Array<Record<string, "asc" | "desc">>): Mesa[] {
  const criterios = (orderBy ?? []).map((o) => {
    const [campo, dir] = Object.entries(o)[0];
    return { campo: campo as keyof Mesa, signo: dir === "desc" ? -1 : 1 };
  });
  return [...rows].sort((a, b) => {
    for (const { campo, signo } of criterios) {
      const va = a[campo];
      const vb = b[campo];
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      if (cmp !== 0) return cmp * signo;
    }
    return 0;
  });
}

type Ocupacion = { resourceId: string; startTime: Date; endTime: Date; bufferMin?: number };

/**
 * Cablea las lecturas de un cliente (global o `tx`) con un inventario y una ocupacion.
 * `resource.findMany` sirve a dos llamadas distintas: el inventario del agente (por
 * `agentId`) y los candidatos del best fit (por `id.in`).
 */
function cablear(
  client: {
    service: { findUnique: ReturnType<typeof vi.fn> };
    blockedRange: { findMany: ReturnType<typeof vi.fn> };
    timeSlot: { findMany: ReturnType<typeof vi.fn> };
    resource: { findMany: ReturnType<typeof vi.fn> };
  },
  opts: {
    svc?: Record<string, unknown>;
    inventario?: Mesa[];
    ocupacion?: Ocupacion[];
    slots?: Array<{ startTime: string; endTime: string }>;
  } = {}
) {
  const inventario = opts.inventario ?? COMEDOR;
  const ocupacion = opts.ocupacion ?? [];

  client.service.findUnique.mockResolvedValue(servicio(opts.svc));
  client.blockedRange.findMany.mockResolvedValue([]);
  client.resource.findMany.mockImplementation(async (args: any) => {
    const ids = args?.where?.id?.in as string[] | undefined;
    if (ids) {
      return ordenarComoLaBD(
        inventario.filter((r) => ids.includes(r.id)),
        args.orderBy
      );
    }
    return inventario.filter((r) => r.enabled);
  });
  client.timeSlot.findMany.mockImplementation(async (args: any) => {
    if (!args?.where?.resourceId) return []; // camino legado (sin inventario)
    const ids = args.where.resourceId.in as string[];
    return ocupacion
      .filter((o) => ids.includes(o.resourceId))
      .map((o) => ({
        resourceId: o.resourceId,
        startTime: o.startTime,
        endTime: o.endTime,
        service: { bufferMin: o.bufferMin ?? 0 },
      }));
  });
  mGenerateSlots.mockReturnValue(opts.slots ?? [SLOT]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Elegibilidad por capacidad ──────────────────────────────────────────────

describe("computeAvailableSlots — elegibilidad por capacidad", () => {
  it("ofrece solo los recursos cuyo rango contiene al grupo", async () => {
    cablear(prisma as never);
    const [hueco] = await computeAvailableSlots("svc-1", RANGO, prisma as never, 4);
    // Un grupo de 4 no cabe en las mesas de 2 y la Mesa 5 exige minimo 3: entran m3 y m5.
    expect(hueco.freeResourceIds?.sort()).toEqual(["m3", "m5"]);
  });

  it("respeta la capacidad MINIMA: una pareja no ocupa la mesa de 3 a 6", async () => {
    // El minimo no es decoracion: sentar a dos en la de seis deja al grupo de seis fuera.
    cablear(prisma as never);
    const [hueco] = await computeAvailableSlots("svc-1", RANGO, prisma as never, 2);
    expect(hueco.freeResourceIds?.sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("devuelve cero huecos si ningun recurso admite al grupo, sin lanzar error", async () => {
    // 7 personas caben en el `maxPartySize` del servicio (8) pero en ninguna mesa. No es un
    // error de contrato, es que hoy no hay mesa: el agente debe ofrecer otro dia.
    cablear(prisma as never);
    expect(await computeAvailableSlots("svc-1", RANGO, prisma as never, 7)).toEqual([]);
  });

  it("lanza GroupTooLargeError por encima de maxPartySize, no 'sin disponibilidad'", async () => {
    // Un grupo de 14 no es un fallo de disponibilidad: es otro canal. Si se devolviese como
    // "no hay hueco" el agente ofreceria otras horas eternamente para un grupo que no cabra.
    cablear(prisma as never);
    const err = await computeAvailableSlots("svc-1", RANGO, prisma as never, 14).catch((e) => e);
    expect(err).toBeInstanceOf(GroupTooLargeError);
    expect(err.message).toContain("grupos y eventos");
    expect(err.message).toContain("NO intentes");
  });

  it("ignora los recursos deshabilitados", async () => {
    const inventario = COMEDOR.map((m) => (m.id === "m1" ? { ...m, enabled: false } : m));
    cablear(prisma as never, { inventario });
    const [hueco] = await computeAvailableSlots("svc-1", RANGO, prisma as never, 2);
    expect(hueco.freeResourceIds).not.toContain("m1");
  });

  it("con vinculos ServiceResource NO mira el resto del inventario del agente", async () => {
    // La cabina de laser es una sola: si el servicio declara sus recursos, ofrecer los demas
    // seria prometer huecos que no existen.
    cablear(prisma as never, {
      svc: {
        resources: [
          {
            resource: {
              id: "laser",
              name: "Cabina Laser",
              zone: "Planta 1",
              capacityMin: 1,
              capacityMax: 1,
              enabled: true,
            },
          },
        ],
      },
    });
    const [hueco] = await computeAvailableSlots("svc-1", RANGO, prisma as never, 1);
    expect(hueco.freeResourceIds).toEqual(["laser"]);
    // El fallback al inventario del agente solo se consulta si NO hay vinculos.
    const porAgente = mResourceFindMany.mock.calls.filter((c) => c[0]?.where?.agentId);
    expect(porAgente).toHaveLength(0);
  });
});

// ── Solapamiento y buffer ───────────────────────────────────────────────────

describe("computeAvailableSlots — solapamiento", () => {
  it("una reserva que TERMINA a la hora del hueco no lo bloquea (intervalo semiabierto)", async () => {
    // 14:30-15:00 no ocupa las 15:00. Con intervalos cerrados se perdia un turno entero por
    // mesa y dia, y la sala parecia llena estando vacia.
    cablear(prisma as never, {
      inventario: [COMEDOR[0]],
      ocupacion: [{ resourceId: "m1", startTime: T("14:30"), endTime: T("15:00") }],
    });
    const libres = await computeAvailableSlots("svc-1", RANGO, prisma as never, 2);
    expect(libres).toHaveLength(1);
    expect(libres[0].freeResourceIds).toEqual(["m1"]);
  });

  it("una reserva que EMPIEZA justo al acabar el hueco tampoco lo bloquea", async () => {
    cablear(prisma as never, {
      inventario: [COMEDOR[0]],
      ocupacion: [{ resourceId: "m1", startTime: T("15:30"), endTime: T("16:00") }],
    });
    expect(await computeAvailableSlots("svc-1", RANGO, prisma as never, 2)).toHaveLength(1);
  });

  it("descarta el recurso solapado pero conserva el hueco si queda otro libre", async () => {
    cablear(prisma as never, {
      ocupacion: [{ resourceId: "m1", startTime: T("14:45"), endTime: T("15:15") }],
    });
    const [hueco] = await computeAvailableSlots("svc-1", RANGO, prisma as never, 2);
    expect(hueco.freeResourceIds?.sort()).toEqual(["m2", "m3"]);
  });

  it("retira el hueco cuando TODOS los recursos elegibles estan ocupados", async () => {
    cablear(prisma as never, {
      ocupacion: [
        { resourceId: "m1", startTime: T("15:00"), endTime: T("15:30") },
        { resourceId: "m2", startTime: T("15:00"), endTime: T("15:30") },
        { resourceId: "m3", startTime: T("15:00"), endTime: T("15:30") },
      ],
    });
    expect(await computeAvailableSlots("svc-1", RANGO, prisma as never, 2)).toEqual([]);
  });

  it("el buffer de la reserva EXISTENTE prolonga su ocupacion", async () => {
    // Cabina con 15 min de desinfeccion: la que acaba a las 15:00 no deja la cabina libre a
    // las 15:00. Es la razon por la que las horas libres no van seguidas.
    cablear(prisma as never, {
      inventario: [COMEDOR[0]],
      ocupacion: [
        { resourceId: "m1", startTime: T("14:30"), endTime: T("15:00"), bufferMin: 15 },
      ],
    });
    expect(await computeAvailableSlots("svc-1", RANGO, prisma as never, 2)).toEqual([]);
  });

  it("el buffer del NUEVO servicio reserva tambien la cola del hueco", async () => {
    // Con 30 min de tratamiento y 15 de limpieza, el hueco de las 15:00 retiene hasta 15:45.
    cablear(prisma as never, {
      svc: { bufferMin: 15 },
      inventario: [COMEDOR[0]],
      ocupacion: [{ resourceId: "m1", startTime: T("15:30"), endTime: T("16:00") }],
    });
    expect(await computeAvailableSlots("svc-1", RANGO, prisma as never, 2)).toEqual([]);
  });

  it("el buffer del nuevo servicio no se pasa de largo: 15:45 sigue siendo libre", async () => {
    // Frontera del caso anterior: la ocupacion que empieza EXACTAMENTE cuando acaba el
    // buffer no bloquea. Sin este par, un buffer de 60 min pasaria igual de verde.
    cablear(prisma as never, {
      svc: { bufferMin: 15 },
      inventario: [COMEDOR[0]],
      ocupacion: [{ resourceId: "m1", startTime: T("15:45"), endTime: T("16:15") }],
    });
    expect(await computeAvailableSlots("svc-1", RANGO, prisma as never, 2)).toHaveLength(1);
  });
});

// ── Horario propio del servicio y rejilla ───────────────────────────────────

describe("computeAvailableSlots — horario del servicio", () => {
  it("el horario del SERVICIO manda sobre el del agente", async () => {
    // Los turnos de comida y cena no son las horas de apertura del negocio, y el domingo
    // puede tener comida sin cena.
    cablear(prisma as never, { svc: { schedule: { tue: "20:30-23:00" } } });
    await computeAvailableSlots("svc-1", RANGO, prisma as never, 2);
    expect(mGenerateSlots.mock.calls[0][3]).toEqual({ tue: "20:30-23:00" });
  });

  it("un horario de servicio VACIO cae al del agente", async () => {
    // `{}` es lo que deja el panel cuando el negocio no configura turnos por servicio.
    cablear(prisma as never, { svc: { schedule: {} } });
    await computeAvailableSlots("svc-1", RANGO, prisma as never, 2);
    expect(mGenerateSlots.mock.calls[0][3]).toEqual({ tue: "13:00-23:00" });
  });

  it("pasa slotStepMin a la rejilla, desacoplada de la duracion", async () => {
    // Turno de 105 min ofrecido cada 15: sin el paso propio, la rejilla iba atada a la
    // duracion y un restaurante solo podia sentar mesas cada hora y tres cuartos.
    cablear(prisma as never, { svc: { duration: 105, slotStepMin: 15 } });
    await computeAvailableSlots("svc-1", RANGO, prisma as never, 2);
    expect(mGenerateSlots.mock.calls[0][2]).toBe(105);
    expect(mGenerateSlots.mock.calls[0][6]).toBe(15);
  });

  it("no consulta ocupacion si la rejilla no produce ningun hueco", async () => {
    // Lunes cerrado: sin huecos teoricos no hay nada que cruzar con el inventario.
    cablear(prisma as never, { slots: [] });
    expect(await computeAvailableSlots("svc-1", RANGO, prisma as never, 2)).toEqual([]);
    expect(mSlotFindMany).not.toHaveBeenCalled();
  });
});

// ── Asignacion best fit ─────────────────────────────────────────────────────

describe("createAppointment — asignacion best fit", () => {
  const start = new Date(SLOT.startTime);
  const end = new Date(SLOT.endTime);

  function conInventario(opts: Parameters<typeof cablear>[1] = {}) {
    cablear(txMock as never, opts);
    txMock.service.findUniqueOrThrow.mockResolvedValue({
      agentId: "agent-1",
      name: "Cena",
      agent: { name: "Casa Mendieta" },
    });
    txMock.timeSlot.create.mockResolvedValue({ id: "fr-1", startTime: start, endTime: end });
    txMock.appointment.create.mockResolvedValue({
      id: "cita-1",
      partySize: 2,
      confirmationCode: "CAS-KVPA",
      service: { id: "svc-1", name: "Cena", agentId: "agent-1" },
    });
    mIntegrationFindFirst.mockResolvedValue(null);
  }

  it("elige la mesa mas pequena que admite al grupo", async () => {
    conInventario();
    const res = await createAppointment({
      serviceId: "svc-1",
      slotStart: start,
      slotEnd: end,
      partySize: 2,
    });
    // m1 y m2 admiten 2; m3 admite 2 pero es mas grande. Empate m1/m2 resuelto por nombre.
    expect(res.resource).toEqual({ id: "m1", name: "Mesa 1", zone: "Comedor" });
    expect(res.partySize).toBe(2);
  });

  it("sube a la mesa grande solo cuando las pequenas estan ocupadas", async () => {
    conInventario({
      ocupacion: [
        { resourceId: "m1", startTime: T("15:00"), endTime: T("15:30") },
        { resourceId: "m2", startTime: T("15:00"), endTime: T("15:30") },
      ],
    });
    const res = await createAppointment({
      serviceId: "svc-1",
      slotStart: start,
      slotEnd: end,
      partySize: 2,
    });
    expect(res.resource.id).toBe("m3");
  });

  it("no toca el camino de recurso implicito cuando hay inventario", async () => {
    conInventario();
    await createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end, partySize: 2 });
    expect(txMock.resource.create).not.toHaveBeenCalled();
    expect(txMock.serviceResource.createMany).not.toHaveBeenCalled();
  });

  it("escribe la franja contra el recurso asignado", async () => {
    conInventario();
    await createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end, partySize: 2 });
    expect(txMock.timeSlot.create).toHaveBeenCalledWith({
      data: {
        serviceId: "svc-1",
        resourceId: "m1",
        startTime: start,
        endTime: end,
        available: false,
      },
    });
  });

  it("rechaza el grupo por encima de maxPartySize antes de escribir nada", async () => {
    conInventario({ svc: { maxPartySize: 8 } });
    await expect(
      createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end, partySize: 12 })
    ).rejects.toBeInstanceOf(GroupTooLargeError);
    expect(txMock.timeSlot.create).not.toHaveBeenCalled();
  });

  it("partySize invalido o ausente cuenta como 1", async () => {
    // El LLM manda a veces 0 o nada. Contar 0 comensales dejaria la reserva fuera de todo
    // rango de capacidad y ninguna mesa seria elegible.
    conInventario();
    const res = await createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end });
    expect(txMock.appointment.create.mock.calls[0][0].data.partySize).toBe(1);
    expect(res.resource.id).toBe("m1");
  });
});

// ── Concurrencia (T5.3) ─────────────────────────────────────────────────────

describe("createAppointment — dos reservas simultaneas por el ultimo recurso", () => {
  const start = new Date(SLOT.startTime);
  const end = new Date(SLOT.endTime);

  it("solo una gana; la otra recibe SlotUnavailableError", async () => {
    // La exclusion real la da el unique `(recurso_id, inicio)` mas el nivel Serializable; aqui
    // se emula el indice para fijar QUE HACE nuestro codigo con el choque: traducirlo a un
    // error de dominio, no a un 500. El comportamiento contra la base real se comprobo
    // agotando el inventario de un mock en produccion (4 mesas ocupadas, la 5ª reserva
    // rechazada, y el grupo de 6 conservando hueco en la mesa grande).
    const tomadas = new Set<string>();
    cablear(txMock as never, { inventario: [COMEDOR[0]] });
    txMock.service.findUniqueOrThrow.mockResolvedValue({
      agentId: "agent-1",
      name: "Cena",
      agent: { name: "Casa Mendieta" },
    });
    txMock.timeSlot.create.mockImplementation(async (args: any) => {
      const key = `${args.data.resourceId}|${args.data.startTime.getTime()}`;
      if (tomadas.has(key)) throw { code: "P2002", meta: { target: ["recurso_id", "inicio"] } };
      tomadas.add(key);
      return { id: "fr-1", startTime: start, endTime: end };
    });
    txMock.appointment.create.mockResolvedValue({
      id: "cita-1",
      partySize: 2,
      confirmationCode: "CAS-KVPA",
      service: { id: "svc-1", name: "Cena", agentId: "agent-1" },
    });
    mIntegrationFindFirst.mockResolvedValue(null);

    const intento = () =>
      createAppointment({ serviceId: "svc-1", slotStart: start, slotEnd: end, partySize: 2 });
    const res = await Promise.allSettled([intento(), intento()]);

    const ok = res.filter((r) => r.status === "fulfilled");
    const ko = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0].reason).toBeInstanceOf(SlotUnavailableError);
    expect(txMock.timeSlot.create).toHaveBeenCalledTimes(2);
  });
});

// ── Liberar inventario al cancelar (T5.2, ultima fila) ──────────────────────

describe("la franja liberada vuelve a ofrecerse", () => {
  it("con una sola mesa, la hora reaparece en cuanto desaparece su fila de ocupacion", async () => {
    // Aqui esta la razon de que cancelar BORRE la franja en vez de marcarla disponible: la
    // ocupacion se deduce de las filas de `franja_horaria` que existen. Mientras la fila
    // siga ahi, la hora no se vuelve a ofrecer aunque la cita este cancelada.
    // La otra mitad del contrato —que cancelar llama a `timeSlot.delete`— se comprueba en
    // booking-appointments y booking-cancelacion-cliente.
    const unaMesa: Mesa[] = [
      { id: "m1", name: "Mesa 1", zone: "Comedor", capacityMin: 1, capacityMax: 2, enabled: true },
    ];
    const ocupacion: Ocupacion[] = [
      { resourceId: "m1", startTime: T("15:00"), endTime: T("15:30") },
    ];

    cablear(prisma as never, { inventario: unaMesa, ocupacion });
    expect(await computeAvailableSlots("svc-1", RANGO, prisma, 2)).toEqual([]);

    // `cancelAppointment` borra la fila; se emula quitandola del inventario ocupado.
    ocupacion.length = 0;
    const tras = await computeAvailableSlots("svc-1", RANGO, prisma, 2);
    expect(tras.map((s) => s.startTime)).toEqual([SLOT.startTime]);
    expect(tras[0].freeResourceIds).toEqual(["m1"]);
  });
});
