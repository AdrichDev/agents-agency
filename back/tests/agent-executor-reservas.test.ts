/**
 * T4.1 (aa-reserva-contacto-real-del-visitante) — cableado de `crear_reserva` en el executor.
 *
 * Los tests de `reserva-contacto-real.test.ts` fijan las comparaciones y el resolver en
 * aislamiento. Aquí se comprueba lo que sólo se ve desde el executor:
 *  - el contacto se resuelve ANTES de exigirlo, así que una llamada sin teléfono se completa
 *    con el del lead en vez de fallar;
 *  - el aviso al dueño del negocio lleva el contacto RESUELTO y no el que compuso el modelo
 *    (AC8): si no, el correo diría un número y la fila guardaría otro.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn() },
    lead: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/agent-backend/managed-db", () => ({
  resolveAgentBackendAdapter: vi.fn(),
  enabledBackendCapabilities: vi.fn(),
}));
vi.mock("@/lib/booking/timezone", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booking/timezone")>();
  return { ...actual, getAgentTimezone: vi.fn().mockResolvedValue("Europe/Madrid") };
});

import { prisma } from "@/lib/db";
import { resolveAgentBackendAdapter } from "@/lib/agent-backend/managed-db";
import { executeTool } from "@/lib/agent/executor";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const TENANT = { tenant: { phone: "+34 910 00 00 02", email: "hola@barberia.es" } };

const RESERVA = {
  id: "cita-1",
  servicioId: "svc-1",
  servicioNombre: "Corte y barba",
  startTime: "2026-08-11T17:00:00.000+02:00",
  endTime: "2026-08-11T17:45:00.000+02:00",
  estado: "scheduled",
  comensales: 1,
  codigo: "BAR-TEST",
  recurso: { nombre: "Silla 1" },
};

function cablearAdapter() {
  const crearReserva = vi.fn().mockResolvedValue(RESERVA);
  const notificar = vi.fn().mockResolvedValue(undefined);
  asMock(resolveAgentBackendAdapter).mockResolvedValue({ crearReserva, notificar });
  return { crearReserva, notificar };
}

const ENTRADA = {
  servicio: "Corte y barba",
  startIso: "2026-08-11T17:00:00",
  endIso: "2026-08-11T17:45:00",
  nombre: "Iker Salaverria",
};

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.agent.findUnique).mockResolvedValue(TENANT);
  asMock(prisma.lead.findUnique).mockResolvedValue(null);
});

describe("crear_reserva — el contacto que se escribe es el del visitante", () => {
  it("rechaza el teléfono del propio negocio sin tocar el adapter", async () => {
    const { crearReserva } = cablearAdapter();
    await expect(
      executeTool("ag-1", "crear_reserva", { ...ENTRADA, telefono: "910000002" }, "conv-1")
    ).rejects.toThrow(/PROPIO NEGOCIO/);
    // La guarda es barata a propósito: nada llega a la BD.
    expect(crearReserva).not.toHaveBeenCalled();
  });

  it("completa el teléfono ausente con el que el visitante ya había escrito", async () => {
    asMock(prisma.lead.findUnique).mockResolvedValue({ email: null, phone: "622334455" });
    const { crearReserva } = cablearAdapter();

    await executeTool("ag-1", "crear_reserva", ENTRADA, "conv-1");

    // Sin este relleno la llamada moría en `assertContactChannel`, y es esa muerte la que
    // empuja al modelo a producir "algo" en el reintento.
    expect(crearReserva.mock.calls[0][2]).toMatchObject({ telefono: "622334455" });
  });

  it("no pisa el teléfono que sí mandó el modelo", async () => {
    asMock(prisma.lead.findUnique).mockResolvedValue({ email: null, phone: "622334455" });
    const { crearReserva } = cablearAdapter();

    await executeTool("ag-1", "crear_reserva", { ...ENTRADA, telefono: "600111222" }, "conv-1");

    expect(crearReserva.mock.calls[0][2]).toMatchObject({ telefono: "600111222" });
  });

  it("el aviso al dueño lleva el MISMO contacto que la fila (AC8)", async () => {
    asMock(prisma.lead.findUnique).mockResolvedValue({ email: null, phone: "622334455" });
    const { crearReserva, notificar } = cablearAdapter();

    await executeTool("ag-1", "crear_reserva", ENTRADA, "conv-1");

    const enLaFila = crearReserva.mock.calls[0][2].telefono;
    expect(notificar).toHaveBeenCalledWith("nueva_reserva", expect.objectContaining({ telefono: enLaFila }));
    expect(enLaFila).toBe("622334455");
  });

  it("sin lead y sin contacto sigue fallando con el mensaje de siempre", async () => {
    cablearAdapter();
    await expect(executeTool("ag-1", "crear_reserva", ENTRADA, "conv-1")).rejects.toThrow(
      /contacto|teléfono|email/i
    );
  });

  it("un agente sin tenant no rechaza nada", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue({ tenant: null });
    const { crearReserva } = cablearAdapter();

    await executeTool("ag-1", "crear_reserva", { ...ENTRADA, telefono: "910000002" }, "conv-1");

    expect(crearReserva).toHaveBeenCalled();
  });
});
