/**
 * Tabla en memoria con la semantica REAL del schema de reservas.
 *
 * Los mocks planos de prisma sirven para fijar contratos de llamada ("se invoco delete"),
 * pero no contestan preguntas de estado: "¿el hueco quedo libre?", "¿pueden dos citas
 * ocupar la misma mesa a la vez?". Esas viven en las restricciones de la base de datos, y
 * un mock que devuelve lo que se le dice nunca las ejerce.
 *
 * Lo que este doble reproduce, y por que:
 *  - unique `(recurso_id, inicio)` en `franja_horaria`: NO distingue disponible de ocupada,
 *    asi que liberar un hueco exige BORRAR la fila, no marcarla.
 *  - unique en `cita.codigo_confirmacion`.
 *  - `ON DELETE SET NULL` de `cita.franja_id`: la cita sobrevive a su franja y por eso
 *    guarda su propio `inicio`/`fin` (migracion `20260730010000_cita_horas_propias`).
 *
 * Lo que NO reproduce, a proposito: el aislamiento Serializable. La concurrencia real se
 * cubre en `booking-multirecurso.test.ts`; aqui solo el resultado observable.
 */
import { vi } from "vitest";

export type SlotRow = {
  id: string;
  serviceId: string;
  resourceId: string;
  startTime: Date;
  endTime: Date;
  available: boolean;
};

export type CitaRow = {
  id: string;
  slotId: string | null;
  serviceId: string;
  leadId: string | null;
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
  createdAt: Date;
};

export type LeadRow = { id: string; customerName: string | null; email: string | null; phone: string | null };

export const db = {
  slots: [] as SlotRow[],
  citas: [] as CitaRow[],
  leads: [] as LeadRow[],
  tenants: [] as Array<Record<string, unknown>>,
  prospects: [] as Array<Record<string, unknown>>,
  seq: 0,
};

export function resetDb(): void {
  db.slots = [];
  db.citas = [];
  db.leads = [];
  db.tenants = [];
  db.prospects = [];
  db.seq = 0;
}

const nextId = (prefijo: string) => `${prefijo}-${++db.seq}`;

/** Error de Prisma tal y como lo lee el codigo bajo prueba: `code` + `meta.target`. */
export function p2002(target: string[]) {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target } });
}

/** Dos mesas con rangos distintos: para un grupo de 2 solo cabe la primera. */
export const RECURSOS = [
  { id: "m1", name: "Mesa 1", zone: "Comedor", capacityMin: 1, capacityMax: 2, enabled: true },
  { id: "m2", name: "Mesa 5", zone: "Comedor", capacityMin: 3, capacityMax: 6, enabled: true },
];

export const SERVICIO = {
  id: "svc-1",
  agentId: "agent-1",
  name: "Cena",
  duration: 30,
  slotStepMin: 30,
  bufferMin: 0,
  maxPartySize: 8,
  schedule: null as Record<string, string> | null,
  agent: {
    id: "agent-1",
    name: "Casa Mendieta",
    // `published`: el gate de ciclo de vida corta /slots y /reserve de un agente sin publicar.
    status: "published",
    // 2026-08-04 es martes. En Madrid (CEST) las 21:00 locales son las 19:00Z.
    schedule: { id: "sch-1", timezone: "Europe/Madrid", schedule: { tue: "13:00-23:00" } },
  },
};

/**
 * Ordena obedeciendo el `orderBy` RECIBIDO, no el que se considere correcto. Un mock que
 * reordena por su cuenta deja pasar un `capacityMax: "desc"` en el fuente — ya ocurrio en
 * `booking-multirecurso.test.ts`.
 */
export function ordenarComoLaBD<T extends Record<string, unknown>>(
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

const conServicio = (c: CitaRow) => ({
  ...c,
  slot: db.slots.find((s) => s.id === c.slotId) ?? null,
  lead: db.leads.find((l) => l.id === c.leadId) ?? null,
  service: { ...SERVICIO, agent: SERVICIO.agent },
});

export const facade: Record<string, any> = {
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
        let filas = RECURSOS.filter((r) =>
          where.enabled === undefined ? true : r.enabled === where.enabled
        );
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
            id: s.id,
            resourceId: s.resourceId,
            startTime: s.startTime,
            endTime: s.endTime,
            service: { bufferMin: SERVICIO.bufferMin },
          }))
    ),

    // El unique `(recurso_id, inicio)`: no distingue `available` true de false.
    create: vi.fn(async ({ data }: { data: Omit<SlotRow, "id"> }) => {
      const choca = db.slots.some(
        (s) => s.resourceId === data.resourceId && s.startTime.getTime() === data.startTime.getTime()
      );
      if (choca) throw p2002(["recurso_id", "inicio"]);
      const fila: SlotRow = { id: nextId("fr"), ...data };
      db.slots.push(fila);
      return fila;
    }),

    // Mover una franja tambien pasa por el unique: es la operacion de `reschedule`.
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const fila = db.slots.find((s) => s.id === where.id);
      if (!fila) throw Object.assign(new Error("Record to update not found"), { code: "P2025" });
      const nuevoInicio = (data.startTime as Date | undefined) ?? fila.startTime;
      const choca = db.slots.some(
        (s) =>
          s.id !== fila.id &&
          s.resourceId === ((data.resourceId as string | undefined) ?? fila.resourceId) &&
          s.startTime.getTime() === nuevoInicio.getTime()
      );
      if (choca) throw p2002(["recurso_id", "inicio"]);
      Object.assign(fila, data);
      return fila;
    }),

    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const i = db.slots.findIndex((s) => s.id === where.id);
      if (i === -1) throw Object.assign(new Error("Record to delete does not exist"), { code: "P2025" });
      const [fila] = db.slots.splice(i, 1);
      // ON DELETE SET NULL: la cita sobrevive sin inventario.
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
        leadId: (data.leadId as string) ?? null,
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
        createdAt: new Date(2026, 7, 1, db.citas.length),
      };
      db.citas.push(fila);
      return { ...fila, service: { id: SERVICIO.id, name: SERVICIO.name, agentId: SERVICIO.agentId } };
    }),

    findMany: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where?: { serviceId?: string };
        orderBy?: Record<string, unknown>;
      } = {}) => {
        let filas = db.citas.filter((c) => (where?.serviceId ? c.serviceId === where.serviceId : true));
        if (orderBy && "createdAt" in orderBy) {
          filas = [...filas].sort((a, b) =>
            orderBy.createdAt === "desc"
              ? b.createdAt.getTime() - a.createdAt.getTime()
              : a.createdAt.getTime() - b.createdAt.getTime()
          );
        } else if (orderBy && "slot" in orderBy) {
          // Las canceladas ya no tienen franja: van al final, como los NULL en Postgres ASC.
          const inicio = (c: CitaRow) => db.slots.find((s) => s.id === c.slotId)?.startTime.getTime();
          filas = [...filas].sort((a, b) => (inicio(a) ?? Infinity) - (inicio(b) ?? Infinity));
        }
        return filas.map(conServicio);
      }
    ),

    findFirst: vi.fn(
      async ({ where }: { where: { confirmationCode?: string; service?: { agentId: string } } }) => {
        const fila = db.citas.find(
          (c) =>
            (where.confirmationCode ? c.confirmationCode === where.confirmationCode : true) &&
            (where.service?.agentId ? SERVICIO.agentId === where.service.agentId : true)
        );
        return fila ? { ...fila, service: { name: SERVICIO.name, agentId: SERVICIO.agentId } } : null;
      }
    ),

    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const fila = db.citas.find((c) => c.id === where.id);
      return fila ? conServicio(fila) : null;
    }),

    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const fila = db.citas.find((c) => c.id === where.id);
      if (!fila) throw Object.assign(new Error("Record to update not found"), { code: "P2025" });
      Object.assign(fila, data);
      return fila;
    }),
  },

  lead: { findFirst: vi.fn(async () => null) },
  tenant: { findFirst: vi.fn(async () => db.tenants[0] ?? null) },
  prospectContact: { findFirst: vi.fn(async () => db.prospects[0] ?? null) },
  integration: { findFirst: vi.fn(async () => null) },
  agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },

  // Las dos formas: callback (`createAppointment`) y array (`cancelAppointment`, `reschedule`).
  $transaction: vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(facade)
      : Promise.all(arg as Promise<unknown>[])
  ),
};
