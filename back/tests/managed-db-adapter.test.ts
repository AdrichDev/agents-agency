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
    // `findMany`: al no resolver el servicio, el adapter lista los validos para
    // meterlos en el mensaje de error y que el modelo pueda reintentar.
    service: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    // `listar_servicios` anuncia el turno de cada servicio y cae al horario del agente
    // cuando el servicio no tiene el suyo: sin este doble, resolver un nombre de servicio
    // inexistente reventaba con un TypeError en vez de con `ServiceNotFoundError`.
    agentSchedule: { findUnique: vi.fn(async () => null) },
    lead: { create: vi.fn(), upsert: vi.fn() },
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
const mockLeadUpsert = prisma.lead.upsert as ReturnType<typeof vi.fn>;
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
    // El cliente Prisma viaja como 3er argumento (mismo camino que routes/booking.ts) y los
    // comensales como 4o: sin ellos el helper no puede descartar las mesas que no dan cabida.
    expect(mockComputeSlots).toHaveBeenCalledWith("svc-1", RANGO, prisma, 1);
    expect(slots).toEqual([SLOT]);
  });

  it("propaga los comensales pedidos al helper", async () => {
    mockServiceFindFirst.mockResolvedValue({ id: "svc-1", name: "Cena" });
    mockComputeSlots.mockResolvedValue([SLOT]);

    await makeAdapter().consultarDisponibilidad("Cena", RANGO, 6);

    expect(mockComputeSlots).toHaveBeenCalledWith("svc-1", RANGO, prisma, 6);
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

  // T3.1 de `aa-agente-no-inventa-datos-ni-politicas`. Medido en T0: el agente no inventaba una
  // politica de aforo, razonaba bien sobre un resultado que nunca le dijo cuantas plazas tiene la
  // hora. `computeAvailableSlots` colapsa a una entrada por instante, asi que dos cabinas libres y
  // una libre se veian identicas y la segunda persona acababa a las 11:30.
  describe("plazasSimultaneas — publica la cardinalidad, nunca el inventario", () => {
    it("emite plazasSimultaneas cuando el instante tiene dos recursos libres", async () => {
      mockServiceFindFirst.mockResolvedValue({ id: "svc-1", name: "Manicura" });
      mockComputeSlots.mockResolvedValue([
        { ...SLOT, freeResourceIds: ["res-cabina-1", "res-cabina-2"] },
      ]);

      const slots = await makeAdapter().consultarDisponibilidad("Manicura", RANGO);

      expect(slots).toEqual([{ ...SLOT, plazasSimultaneas: 2 }]);
    });

    it("omite el campo con un solo recurso libre: repetir 1 en cada franja es gasto sin dato", async () => {
      mockServiceFindFirst.mockResolvedValue({ id: "svc-1", name: "Manicura" });
      mockComputeSlots.mockResolvedValue([{ ...SLOT, freeResourceIds: ["res-cabina-1"] }]);

      const slots = await makeAdapter().consultarDisponibilidad("Manicura", RANGO);

      // Ausente de verdad, no `undefined`: `toEqual` da por buena una clave con valor undefined,
      // asi que la ausencia se comprueba sobre las claves reales del objeto serializado.
      expect(Object.keys(slots[0])).toEqual(["startTime", "endTime"]);
    });

    it("omite el campo en el camino legado, sin inventario declarado", async () => {
      mockServiceFindFirst.mockResolvedValue({ id: "svc-1", name: "Corte" });
      // Unidad implicita: `computeAvailableSlots` no devuelve `freeResourceIds`.
      mockComputeSlots.mockResolvedValue([SLOT]);

      const slots = await makeAdapter().consultarDisponibilidad("Corte", RANGO);

      expect(Object.keys(slots[0])).toEqual(["startTime", "endTime"]);
    });

    it("no filtra los ids de recurso al prompt del modelo", async () => {
      mockServiceFindFirst.mockResolvedValue({ id: "svc-1", name: "Manicura" });
      mockComputeSlots.mockResolvedValue([
        { ...SLOT, freeResourceIds: ["res-cabina-1", "res-cabina-2"] },
      ]);

      const slots = await makeAdapter().consultarDisponibilidad("Manicura", RANGO);

      // El inventario es interno. Lo que sale es la CUENTA, y se comprueba sobre el payload
      // serializado porque es exactamente lo que se le entrega al modelo.
      const payload = JSON.stringify(slots);
      expect(payload).not.toContain("res-cabina");
      expect(payload).not.toContain("freeResourceIds");
    });
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
      // `createAppointment` siempre resuelve un recurso: si el agente no tiene inventario se
      // crea uno implicito, asi que estas tres claves nunca vienen vacias.
      partySize: 2,
      confirmationCode: "COR-KVPA",
      resource: { id: "rec-1", name: "Silla 1", zone: null },
    });

    const adapter = makeAdapter();
    const reserva = await adapter.crearReserva("Corte", SLOT, {
      nombre: "Ana",
      email: "ana@example.com",
      telefono: "600111222",
      comensales: 2,
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
      // La confirmacion vuelve en la zona del negocio (aqui, sin horario configurado, el
      // Europe/Madrid por defecto): es la hora que el modelo le repite al cliente. Con
      // `toISOString()` confirmaba las 09:00 un hueco que se habia ofrecido a las 11:00.
      startTime: "2026-07-20T11:00:00.000+02:00",
      endTime: "2026-07-20T11:30:00.000+02:00",
      estado: "scheduled",
      // El codigo es lo que el agente tiene que dictar al cliente para que luego pueda
      // cancelar por su cuenta; la zona del recurso ("Terraza", "Cabina 2") es lo que hace
      // util la confirmacion. Sin estas claves la reserva se confirma a ciegas.
      comensales: 2,
      codigo: "COR-KVPA",
      recurso: { nombre: "Silla 1", zona: undefined },
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
    // Sin conversacion (llamada por API): se crea, como siempre.
    const lead = await adapter.guardarLead(
      { nombre: "Bruno", telefono: "600111222" },
      "quiere reservar corte de pelo"
    );

    expect(lead).toEqual({ id: "lead-1", creadoEn: creado.toISOString() });

    const arg = mockLeadCreate.mock.calls[0][0];
    expect(arg.data).toEqual({
      agentId: AGENT_ID,
      customerName: "Bruno",
      email: null,
      phone: "600111222",
      consent: false,
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

// ── Un lead por conversacion (aa-servicios-completos-y-enlaces-clicables, F) ──
//
// Una conversacion real dejo TRES filas incompletas de la misma persona: el modelo llama a
// `guardar_lead` cada vez que consigue un dato, y cada llamada era un `create`. Lo que
// impedia la segunda llamada era prosa en la descripcion de la tool ("usala una sola vez
// por conversacion"); la prosa no ata, la clave si.
describe("guardarLead — fusion por conversationId", () => {
  const CONV = "conv-1";
  const creado = new Date("2026-07-20T10:00:00.000Z");

  beforeEach(() => {
    mockLeadUpsert.mockResolvedValue({ id: "lead-1", createdAt: creado });
  });

  it("con conversacion hace upsert sobre esa clave, no un create", async () => {
    await makeAdapter().guardarLead({ nombre: "Adrian", email: "a@b.com" }, "", CONV);

    expect(mockLeadCreate).not.toHaveBeenCalled();
    const arg = mockLeadUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({ conversationId: CONV });
    expect(arg.create).toEqual({
      agentId: AGENT_ID,
      conversationId: CONV,
      customerName: "Adrian",
      email: "a@b.com",
      phone: null,
      consent: true,
    });
  });

  it("no pisa con null lo que trajo la llamada anterior", async () => {
    // Segunda llamada de la misma charla: llega el telefono y ya no el email. Si el update
    // escribiera todos los campos, borraria el email que ya estaba guardado.
    await makeAdapter().guardarLead({ nombre: "Adrian", telefono: "635984010" }, "", CONV);

    expect(mockLeadUpsert.mock.calls[0][0].update).toEqual({
      customerName: "Adrian",
      phone: "635984010",
      consent: true,
    });
  });

  it("el marcador 'Visitante' no pisa un nombre real", async () => {
    // `calificar_lead` crea la fila con "Visitante" cuando aun no hay nombre. Si luego
    // llegara por aqui, no puede sustituir a "Adrian".
    await makeAdapter().guardarLead({ nombre: "Visitante" }, "", CONV);

    expect(mockLeadUpsert.mock.calls[0][0].update).toEqual({ consent: true });
  });

  it("el consentimiento lo decide el servidor: true si viene de una conversacion", async () => {
    // Seis leads reales con consent:false mientras el propio bot decia "con consentimiento
    // RGPD". El campo era opcional en el schema de la tool y el modelo no lo mandaba nunca.
    await makeAdapter().guardarLead({ nombre: "Adrian" }, "", CONV);
    expect(mockLeadUpsert.mock.calls[0][0].create.consent).toBe(true);

    mockLeadCreate.mockResolvedValue({ id: "lead-2", createdAt: creado });
    await makeAdapter().guardarLead({ nombre: "Adrian" }, "");
    expect(mockLeadCreate.mock.calls[0][0].data.consent).toBe(false);
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
