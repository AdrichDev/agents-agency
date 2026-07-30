/**
 * Autoservicio del cliente final: consultar y CANCELAR su propia reserva
 * (aa-reservas-multirecurso-y-mocks-sectoriales, bloque E: T5.2).
 *
 * Lo que se fija aqui es una puerta de seguridad, no una comodidad: para cancelar hacen falta
 * el codigo Y un dato de contacto que coincida con el de esa reserva. Con el codigo solo,
 * cualquiera que lo viese por encima del hombro anularia la mesa de otra persona. Y los tres
 * fallos posibles —codigo inexistente, contacto que no coincide, codigo de otro negocio—
 * devuelven el MISMO error: distinguirlos convertiria la tool en un oraculo para averiguar si
 * un codigo existe y a quien pertenece.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    timeSlot: { delete: vi.fn() },
    integration: { findFirst: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => Promise.all(arg as Promise<unknown>[])),
  },
}));

vi.mock("@/lib/booking/slots", () => ({ generateSlots: vi.fn() }));
vi.mock("@/lib/booking/sync", () => ({
  syncAppointmentToGcal: vi.fn(),
  unsyncAppointmentFromGcal: vi.fn(),
}));

import { prisma } from "@/lib/db";
import {
  listAppointmentsByContact,
  cancelAppointmentByCode,
  BookingNotFoundError,
  AppointmentAlreadyCancelledError,
} from "@/lib/booking/appointments";

const mFindMany = prisma.appointment.findMany as ReturnType<typeof vi.fn>;
const mFindFirst = prisma.appointment.findFirst as ReturnType<typeof vi.fn>;
const mFindUnique = prisma.appointment.findUnique as ReturnType<typeof vi.fn>;
const mSlotDelete = prisma.timeSlot.delete as ReturnType<typeof vi.fn>;
const mIntegrationFindFirst = prisma.integration.findFirst as ReturnType<typeof vi.fn>;

const AHORA = new Date("2026-08-04T10:00:00.000Z");
const MANANA = new Date("2026-08-05T20:30:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mIntegrationFindFirst.mockResolvedValue(null);
});

function reserva(over: Record<string, unknown> = {}) {
  return {
    id: "cita-1",
    confirmationCode: "CAS-KVPA",
    email: "ana@example.com",
    phone: "+34 600 11 22 33",
    partySize: 2,
    status: "scheduled",
    startTime: MANANA,
    endTime: new Date("2026-08-05T22:30:00.000Z"),
    slotId: "fr-1",
    gcalEventId: null,
    service: { name: "Cena", agentId: "agent-1" },
    slot: { resource: { zone: "Comedor" } },
    ...over,
  };
}

// ── Listado ─────────────────────────────────────────────────────────────────

describe("listAppointmentsByContact", () => {
  it("acota por agente, por futuro y excluye canceladas", async () => {
    // El acotado por agente no es opcional: un mismo email puede haber reservado en varios
    // negocios de la plataforma y el agente de uno no debe enumerar las reservas de otro.
    mFindMany.mockResolvedValue([reserva()]);

    const rows = await listAppointmentsByContact("agent-1", { email: "ana@example.com" }, AHORA);

    expect(mFindMany.mock.calls[0][0].where).toEqual({
      service: { agentId: "agent-1" },
      status: { not: "cancelled" },
      startTime: { gte: AHORA },
    });
    expect(rows).toEqual([
      {
        id: "cita-1",
        codigo: "CAS-KVPA",
        servicio: "Cena",
        startTime: MANANA.toISOString(),
        endTime: "2026-08-05T22:30:00.000Z",
        comensales: 2,
        zona: "Comedor",
        estado: "scheduled",
      },
    ]);
  });

  it("encuentra la reserva aunque el telefono se dicte con otro formato", async () => {
    // Se reservo con "+34 600 11 22 33" y ahora el cliente escribe "600112233". Es el mismo
    // telefono. Comparar cadenas devolvia cero reservas y el agente respondia al cliente que
    // no tenia ninguna: se compara por digitos.
    mFindMany.mockResolvedValue([reserva()]);
    const rows = await listAppointmentsByContact("agent-1", { telefono: "600112233" }, AHORA);
    expect(rows).toHaveLength(1);
  });

  it("no devuelve las reservas de OTRO contacto del mismo negocio", async () => {
    // La consulta trae las reservas futuras del agente; el filtro de contacto es lo unico que
    // separa las de este cliente de las del resto. Sin el, dar un email cualquiera listaria
    // toda la agenda del negocio.
    mFindMany.mockResolvedValue([
      reserva(),
      reserva({ id: "cita-2", email: "otro@example.com", phone: "699 99 99 99" }),
    ]);
    const rows = await listAppointmentsByContact("agent-1", { email: "ana@example.com" }, AHORA);
    expect(rows.map((r) => r.id)).toEqual(["cita-1"]);
  });

  it("el email compara sin distinguir mayusculas", async () => {
    mFindMany.mockResolvedValue([reserva()]);
    const rows = await listAppointmentsByContact("agent-1", { email: "ANA@Example.com" }, AHORA);
    expect(rows).toHaveLength(1);
  });

  it("sin email ni telefono lanza BookingNotFoundError y no consulta nada", async () => {
    await expect(listAppointmentsByContact("agent-1", {}, AHORA)).rejects.toBeInstanceOf(
      BookingNotFoundError
    );
    expect(mFindMany).not.toHaveBeenCalled();
  });

  it("un telefono sin ningun digito cuenta como no aportar contacto", async () => {
    // El modelo manda a veces basura ("no lo sé"). Si se aceptase, `normalisePhone` la
    // reduciria a "" y podria igualar a un telefono guardado igual de vacio.
    await expect(
      listAppointmentsByContact("agent-1", { telefono: "no lo se" }, AHORA)
    ).rejects.toBeInstanceOf(BookingNotFoundError);
  });

  it("devuelve lista vacia si el contacto no tiene reservas, sin error", async () => {
    // "No tienes ninguna reserva" es una respuesta valida, no un fallo.
    mFindMany.mockResolvedValue([]);
    expect(await listAppointmentsByContact("agent-1", { email: "ana@example.com" }, AHORA)).toEqual(
      []
    );
  });

  it("una reserva que perdio su franja se lista con zona nula, no rompe", async () => {
    mFindMany.mockResolvedValue([reserva({ slot: null })]);
    const rows = await listAppointmentsByContact("agent-1", { email: "ana@example.com" }, AHORA);
    expect(rows[0].zona).toBeNull();
  });
});

// ── Cancelacion por codigo ──────────────────────────────────────────────────

describe("cancelAppointmentByCode", () => {
  it("cancela con codigo + contacto correctos y devuelve hora y servicio", async () => {
    mFindFirst.mockResolvedValue(reserva());
    mFindUnique.mockResolvedValue(reserva());

    const res = await cancelAppointmentByCode("agent-1", "CAS-KVPA", {
      email: "ana@example.com",
    });

    expect(res).toEqual({
      ok: true,
      estado: "cancelled",
      startTime: MANANA.toISOString(),
      servicio: "Cena",
    });
    // Cancelar libera el inventario: la franja se BORRA, no se marca disponible.
    expect(mSlotDelete).toHaveBeenCalledWith({ where: { id: "fr-1" } });
  });

  it("busca solo por codigo y agente; el contacto se comprueba aparte", async () => {
    // Meter el contacto en el `where` es lo que rompia la cancelacion por telefono: el
    // formato guardado y el dictado no coinciden y la consulta no devolvia la fila.
    mFindFirst.mockResolvedValue(reserva());
    mFindUnique.mockResolvedValue(reserva());

    await cancelAppointmentByCode("agent-1", "CAS-KVPA", { telefono: "600112233" });

    expect(mFindFirst.mock.calls[0][0].where).toEqual({
      confirmationCode: "CAS-KVPA",
      service: { agentId: "agent-1" },
    });
  });

  it("acepta el codigo en minusculas y con espacios", async () => {
    // El cliente lo copia del chat como puede.
    mFindFirst.mockResolvedValue(reserva());
    mFindUnique.mockResolvedValue(reserva());

    await cancelAppointmentByCode("agent-1", "  cas-kvpa ", { email: "ana@example.com" });
    expect(mFindFirst.mock.calls[0][0].where.confirmationCode).toBe("CAS-KVPA");
  });

  it("codigo inexistente → BookingNotFoundError", async () => {
    mFindFirst.mockResolvedValue(null);
    await expect(
      cancelAppointmentByCode("agent-1", "XXX-XXXX", { email: "ana@example.com" })
    ).rejects.toBeInstanceOf(BookingNotFoundError);
    expect(mSlotDelete).not.toHaveBeenCalled();
  });

  it("codigo correcto con contacto que NO coincide → BookingNotFoundError y no cancela", async () => {
    // El caso que justifica toda la comprobacion: el codigo es correcto, quien lo usa no.
    mFindFirst.mockResolvedValue(reserva());
    await expect(
      cancelAppointmentByCode("agent-1", "CAS-KVPA", { email: "intruso@example.com" })
    ).rejects.toBeInstanceOf(BookingNotFoundError);
    expect(mSlotDelete).not.toHaveBeenCalled();
  });

  it("telefono que no coincide por digitos tampoco cancela", async () => {
    mFindFirst.mockResolvedValue(reserva());
    await expect(
      cancelAppointmentByCode("agent-1", "CAS-KVPA", { telefono: "600 11 22 34" })
    ).rejects.toBeInstanceOf(BookingNotFoundError);
  });

  it("el mensaje de error no revela si el codigo existe", async () => {
    // Mismo texto en los tres casos: si "no existe" y "no es tuyo" se distinguieran, la tool
    // serviria para averiguar codigos validos.
    mFindFirst.mockResolvedValue(null);
    const inexistente = await cancelAppointmentByCode("agent-1", "XXX-XXXX", {
      email: "ana@example.com",
    }).catch((e) => e.message);
    mFindFirst.mockResolvedValue(reserva());
    const ajeno = await cancelAppointmentByCode("agent-1", "CAS-KVPA", {
      email: "intruso@example.com",
    }).catch((e) => e.message);
    expect(inexistente).toBe(ajeno);
  });

  it("codigo de OTRO agente → BookingNotFoundError", async () => {
    // El aislamiento lo hace la consulta: `service: { agentId }`. Con el codigo de un
    // restaurante no se cancela en la barberia de al lado.
    mFindFirst.mockImplementation(async (args: any) =>
      args.where.service.agentId === "agent-1" ? reserva() : null
    );
    await expect(
      cancelAppointmentByCode("agent-2", "CAS-KVPA", { email: "ana@example.com" })
    ).rejects.toBeInstanceOf(BookingNotFoundError);
  });

  it("cancelar dos veces → AppointmentAlreadyCancelledError", async () => {
    // Error distinto a proposito: aqui el cliente SI ha demostrado que la reserva es suya, y
    // "ya estaba cancelada" es informacion util, no una fuga.
    mFindFirst.mockResolvedValue(reserva({ status: "cancelled" }));
    await expect(
      cancelAppointmentByCode("agent-1", "CAS-KVPA", { email: "ana@example.com" })
    ).rejects.toBeInstanceOf(AppointmentAlreadyCancelledError);
    expect(mSlotDelete).not.toHaveBeenCalled();
  });

  it("sin codigo → BookingNotFoundError sin consultar", async () => {
    await expect(
      cancelAppointmentByCode("agent-1", "   ", { email: "ana@example.com" })
    ).rejects.toBeInstanceOf(BookingNotFoundError);
    expect(mFindFirst).not.toHaveBeenCalled();
  });

  it("sin contacto → BookingNotFoundError sin consultar", async () => {
    await expect(cancelAppointmentByCode("agent-1", "CAS-KVPA", {})).rejects.toBeInstanceOf(
      BookingNotFoundError
    );
    expect(mFindFirst).not.toHaveBeenCalled();
  });
});
