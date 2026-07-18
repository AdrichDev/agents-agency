/**
 * Adapter `managed_db` sobre conexion COMPARTIDA (aa-managed-db-conexion-compartida
 * F1). El adapter ya NO ejecuta SQL raw: opera sobre los MODELOS Prisma reales del
 * schema `aa` y reusa los helpers de booking (`lib/booking/appointments.ts`), la
 * misma logica que sirve `routes/booking.ts`.
 *
 * Cubre: (1) resolucion de servicio por agente (id/nombre); (2) crearReserva
 * delega en `createAppointment` con el serviceId resuelto; (3)
 * consultarDisponibilidad delega en `computeAvailableSlots`; (4) cancelarReserva
 * verifica pertenencia al agente y delega en `cancelAppointment`; (5) guardarLead
 * usa `customerName`/`agentId` (NO `intencion`, que no tiene columna); (6)
 * consultarPedido honesto; (7) gates de capability; (8) `resolveAgentBackendAdapter`
 * por modo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findFirst: vi.fn() },
    lead: { create: vi.fn() },
    appointment: { findFirst: vi.fn() },
    agentDataBackend: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/booking/appointments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booking/appointments")>();
  return {
    ...actual,
    computeAvailableSlots: vi.fn(),
    createAppointment: vi.fn(),
    cancelAppointment: vi.fn(),
  };
});

vi.mock("@/lib/agent-backend/notify-dispatcher", () => ({
  dispatchNotification: vi.fn(),
}));

import { prisma } from "@/lib/db";
import {
  computeAvailableSlots,
  createAppointment,
  cancelAppointment,
  ServiceNotFoundError,
} from "@/lib/booking/appointments";
import { dispatchNotification } from "@/lib/agent-backend/notify-dispatcher";
import {
  ManagedDbAdapter,
  CapabilityNotEnabledError,
  ReservaNotFoundError,
  resolveAgentBackendAdapter,
} from "@/lib/agent-backend/managed-db";
import { ExternalApiAdapter } from "@/lib/agent-backend/external-api";
import type { AgentBackendAdapter } from "@/lib/agent-backend/types";

const mockServiceFindFirst = prisma.service.findFirst as ReturnType<typeof vi.fn>;
const mockLeadCreate = prisma.lead.create as ReturnType<typeof vi.fn>;
const mockApptFindFirst = prisma.appointment.findFirst as ReturnType<typeof vi.fn>;
const mockBackendFindUnique = prisma.agentDataBackend.findUnique as ReturnType<typeof vi.fn>;
const mockComputeSlots = computeAvailableSlots as ReturnType<typeof vi.fn>;
const mockCreateAppt = createAppointment as ReturnType<typeof vi.fn>;
const mockCancelAppt = cancelAppointment as ReturnType<typeof vi.fn>;
const mockDispatch = dispatchNotification as ReturnType<typeof vi.fn>;

const AGENT_ID = "agent-managed-1";
const SLOT = {
  startTime: "2026-07-20T09:00:00.000Z",
  endTime: "2026-07-20T09:30:00.000Z",
};

function makeAdapter(
  capabilities: Array<"reservas" | "leads" | "pedidos"> = ["reservas", "leads", "pedidos"]
): ManagedDbAdapter {
  return new ManagedDbAdapter(AGENT_ID, capabilities);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Contrato ──────────────────────────────────────────────────────────────
describe("ManagedDbAdapter — contrato AgentBackendAdapter", () => {
  it("implementa los 6 metodos del contrato", () => {
    const adapter: AgentBackendAdapter = makeAdapter();
    for (const m of [
      "consultarDisponibilidad",
      "crearReserva",
      "cancelarReserva",
      "guardarLead",
      "consultarPedido",
      "notificar",
    ] as const) {
      expect(typeof adapter[m]).toBe("function");
    }
  });
});

// ── consultarDisponibilidad ─────────────────────────────────────────────────
describe("consultarDisponibilidad — resuelve servicio + delega en computeAvailableSlots", () => {
  const RANGO = {
    desde: new Date("2026-07-20T00:00:00.000Z"),
    hasta: new Date("2026-07-20T23:59:59.000Z"),
  };

  it("resuelve el servicio por agente y llama computeAvailableSlots con su id", async () => {
    mockServiceFindFirst.mockResolvedValue({ id: "svc-1", name: "Corte" });
    mockComputeSlots.mockResolvedValue([SLOT]);

    const adapter = makeAdapter();
    const slots = await adapter.consultarDisponibilidad("Corte", RANGO);

    // La resolucion se acota por agentId (aislamiento) y enabled=true
    expect(mockServiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agentId: AGENT_ID, enabled: true }),
      })
    );
    expect(mockComputeSlots).toHaveBeenCalledWith("svc-1", RANGO);
    expect(slots).toEqual([SLOT]);
  });

  it("lanza ServiceNotFoundError (claro, no 500) si el servicio no existe", async () => {
    mockServiceFindFirst.mockResolvedValue(null);
    const adapter = makeAdapter();
    await expect(adapter.consultarDisponibilidad("Fantasma", RANGO)).rejects.toBeInstanceOf(
      ServiceNotFoundError
    );
    expect(mockComputeSlots).not.toHaveBeenCalled();
  });

  it("rechaza si la capability reservas no esta habilitada", async () => {
    const adapter = makeAdapter(["leads"]);
    await expect(adapter.consultarDisponibilidad("Corte", RANGO)).rejects.toBeInstanceOf(
      CapabilityNotEnabledError
    );
    expect(mockServiceFindFirst).not.toHaveBeenCalled();
  });
});

// ── crearReserva ────────────────────────────────────────────────────────────
describe("crearReserva — delega en createAppointment con el serviceId resuelto", () => {
  it("mapea el resultado del helper a Reserva y pasa el serviceId correcto", async () => {
    mockServiceFindFirst.mockResolvedValue({ id: "svc-1", name: "Corte" });
    mockCreateAppt.mockResolvedValue({
      appointmentId: "cita-1",
      slotId: "fr-1",
      startTime: new Date(SLOT.startTime),
      endTime: new Date(SLOT.endTime),
      service: { id: "svc-1", name: "Corte", agentId: AGENT_ID },
    });

    const adapter = makeAdapter();
    const reserva = await adapter.crearReserva("Corte", SLOT, {
      nombre: "Ana",
      email: "ana@example.com",
      telefono: "600111222",
    });

    // createAppointment recibe el serviceId resuelto + fechas Date + contacto
    expect(mockCreateAppt).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: "svc-1",
        slotStart: new Date(SLOT.startTime),
        slotEnd: new Date(SLOT.endTime),
        email: "ana@example.com",
        phone: "600111222",
      })
    );
    expect(reserva).toEqual({
      id: "cita-1",
      servicioId: "svc-1",
      servicioNombre: "Corte",
      startTime: new Date(SLOT.startTime).toISOString(),
      endTime: new Date(SLOT.endTime).toISOString(),
      estado: "scheduled",
    });
  });

  it("propaga ServiceNotFoundError si el servicio no existe (sin crear cita)", async () => {
    mockServiceFindFirst.mockResolvedValue(null);
    const adapter = makeAdapter();
    await expect(adapter.crearReserva("Fantasma", SLOT, {})).rejects.toBeInstanceOf(
      ServiceNotFoundError
    );
    expect(mockCreateAppt).not.toHaveBeenCalled();
  });
});

// ── cancelarReserva ─────────────────────────────────────────────────────────
describe("cancelarReserva — verifica pertenencia al agente y delega", () => {
  it("cancela solo si la cita cuelga de un servicio del agente", async () => {
    mockApptFindFirst.mockResolvedValue({ id: "cita-1" });
    mockCancelAppt.mockResolvedValue({ ok: true, estado: "cancelled" });

    const adapter = makeAdapter();
    const res = await adapter.cancelarReserva("cita-1");

    expect(mockApptFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "cita-1",
          service: { agentId: AGENT_ID },
        }),
      })
    );
    expect(mockCancelAppt).toHaveBeenCalledWith("cita-1");
    expect(res).toEqual({ ok: true, estado: "cancelled" });
  });

  it("rechaza (aislamiento) si la cita no pertenece al agente", async () => {
    mockApptFindFirst.mockResolvedValue(null);
    const adapter = makeAdapter();
    await expect(adapter.cancelarReserva("otra-cita")).rejects.toBeInstanceOf(ReservaNotFoundError);
    expect(mockCancelAppt).not.toHaveBeenCalled();
  });
});

// ── guardarLead ─────────────────────────────────────────────────────────────
describe("guardarLead — customerName/agentId; intencion NO se persiste", () => {
  it("crea el lead con las columnas reales y descarta la intencion", async () => {
    const creado = new Date("2026-07-20T10:00:00.000Z");
    mockLeadCreate.mockResolvedValue({ id: "lead-1", createdAt: creado });

    const adapter = makeAdapter();
    const lead = await adapter.guardarLead(
      { nombre: "Bruno", telefono: "600111222", consentimiento: true },
      "quiere reservar corte de pelo"
    );

    expect(lead).toEqual({ id: "lead-1", creadoEn: creado.toISOString() });

    const arg = mockLeadCreate.mock.calls[0][0];
    expect(arg.data).toEqual({
      agentId: AGENT_ID,
      customerName: "Bruno",
      email: null,
      phone: "600111222",
      consent: true,
    });
    // NO existe columna intencion: no debe aparecer en el data
    expect(Object.keys(arg.data)).not.toContain("intencion");
    expect(JSON.stringify(arg.data)).not.toContain("corte de pelo");
  });

  it("rechaza lead sin nombre", async () => {
    const adapter = makeAdapter();
    await expect(adapter.guardarLead({ nombre: "" }, "x")).rejects.toThrow(/requiere/);
    expect(mockLeadCreate).not.toHaveBeenCalled();
  });

  it("rechaza si la capability leads no esta habilitada", async () => {
    const adapter = makeAdapter(["reservas"]);
    await expect(adapter.guardarLead({ nombre: "Bruno" }, "x")).rejects.toBeInstanceOf(
      CapabilityNotEnabledError
    );
    expect(mockLeadCreate).not.toHaveBeenCalled();
  });
});

// ── consultarPedido ─────────────────────────────────────────────────────────
describe("consultarPedido — honesto (aa no tiene tabla de pedidos)", () => {
  it("devuelve encontrado=false con el codigo", async () => {
    const adapter = makeAdapter();
    const res = await adapter.consultarPedido("P-1");
    expect(res).toEqual({ encontrado: false, codigo: "P-1" });
  });

  it("rechaza si la capability pedidos no esta habilitada", async () => {
    const adapter = makeAdapter(["reservas", "leads"]);
    await expect(adapter.consultarPedido("P-1")).rejects.toBeInstanceOf(CapabilityNotEnabledError);
  });
});

// ── notificar ───────────────────────────────────────────────────────────────
describe("notificar — best-effort (nunca lanza)", () => {
  it("delega en el dispatcher", async () => {
    mockDispatch.mockResolvedValue(undefined);
    const adapter = makeAdapter();
    await expect(
      adapter.notificar("nueva_reserva", { reservaId: "c1" })
    ).resolves.toBeUndefined();
    expect(mockDispatch).toHaveBeenCalledWith(AGENT_ID, "nueva_reserva", { reservaId: "c1" });
  });

  it("no propaga si el dispatcher falla", async () => {
    mockDispatch.mockRejectedValue(new Error("telegram down"));
    const adapter = makeAdapter();
    await expect(
      adapter.notificar("nuevo_lead", { leadId: "l1" })
    ).resolves.toBeUndefined();
  });
});

// ── resolveAgentBackendAdapter ──────────────────────────────────────────────
describe("resolveAgentBackendAdapter — por modo, sin dbUrlEncrypted (AC1/AC3)", () => {
  it("devuelve null sin fila o con mode none_yet", async () => {
    mockBackendFindUnique.mockResolvedValueOnce(null);
    expect(await resolveAgentBackendAdapter("a1")).toBeNull();

    mockBackendFindUnique.mockResolvedValueOnce({ mode: "none_yet" });
    expect(await resolveAgentBackendAdapter("a2")).toBeNull();
  });

  it("managed_db construye ManagedDbAdapter sin exigir dbUrlEncrypted", async () => {
    mockBackendFindUnique.mockResolvedValueOnce({
      mode: "managed_db",
      dbUrlEncrypted: null,
      capabilities: ["reservas", "leads"],
    });
    const adapter = await resolveAgentBackendAdapter("a3");
    expect(adapter).toBeInstanceOf(ManagedDbAdapter);
  });

  it("managed_db respeta capabilities (pedidos NO habilitado)", async () => {
    mockBackendFindUnique.mockResolvedValueOnce({
      mode: "managed_db",
      capabilities: ["reservas", "leads"],
    });
    const adapter = await resolveAgentBackendAdapter("a4");
    await expect(adapter!.consultarPedido("P-1")).rejects.toBeInstanceOf(CapabilityNotEnabledError);
  });

  it("external_api valido devuelve ExternalApiAdapter", async () => {
    mockBackendFindUnique.mockResolvedValueOnce({
      mode: "external_api",
      apiBaseUrl: "https://crm.example.com",
      apiKeyEncrypted: null,
      dbSchema: { businessId: "biz-1", locationId: "loc-1" },
      capabilities: ["reservas", "leads"],
    });
    const adapter = await resolveAgentBackendAdapter("a5");
    expect(adapter).toBeInstanceOf(ExternalApiAdapter);
  });

  it("external_api sin businessId es error de configuracion (no null silencioso)", async () => {
    mockBackendFindUnique.mockResolvedValueOnce({
      mode: "external_api",
      apiBaseUrl: "https://crm.example.com",
      dbSchema: {},
      capabilities: ["reservas"],
    });
    await expect(resolveAgentBackendAdapter("a6")).rejects.toThrow(/apiBaseUrl o businessId/);
  });
});
