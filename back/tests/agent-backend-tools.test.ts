/**
 * T3 — aa-agent-backend-foundation Fase 3 (AC3).
 * Cubre: (1) gating de tools por mode+capability (`none_yet` no recibe tools de
 * backend; `managed_db` + capability sí); (2) los handlers del executor son un
 * puente que DELEGA en el `AgentBackendAdapter` del agente (sin lógica de
 * reservas propia); (3) `buildSystemPrompt` refleja la capacidad real (guía de
 * reserva REAL sustituye a la de Google Calendar crudo); (4) retrocompat de
 * pedidos: `get_order_status` intacto y `consultar_pedido` cae al path legado
 * `orderStatusUrl` cuando no hay managed_db.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (patrón de engine.test.ts / agent-data-backend.migration.test.ts) ──
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUniqueOrThrow: vi.fn() },
    integration: { findUnique: vi.fn() },
    // Lo lee `getAgentTimezone`: las tools de reserva resuelven la zona del negocio para
    // interpretar el ISO naive que emite el modelo.
    agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },
  },
}));
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));
vi.mock("@/lib/agent/order-status", () => ({
  fetchOrderStatus: vi.fn(async () => ({ ok: true, raw: { status: "enviado" } })),
}));
vi.mock("@/lib/agent-backend/managed-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-backend/managed-db")>();
  return { ...actual, resolveAgentBackendAdapter: vi.fn() };
});
vi.mock("@/lib/openai", () => ({ openai: {}, getClientForAgent: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn() }));
vi.mock("@/lib/token-metering", () => ({
  deductTokens: vi.fn(),
  // H1 (aa-metering-fail-closed): el gate real corta si el agente no tiene tenant. En
  // tests se deja pasar y se devuelve el tenant del agente, de modo que deductTokens
  // recibe exactamente lo mismo que antes del change (regresión cero).
  // H2: el gate devuelve tenant + modo de credenciales. Los mocks reproducen la forma real
  // ("platform" por defecto) para que el motor resuelva el cliente global, como antes.
  assertUsageAllowed: vi.fn(async (tenantId?: string | null) => ({
    meteredTenantId: tenantId ?? null,
    credentialMode: "platform",
  })),
}));

import { prisma } from "@/lib/db";
import { fetchOrderStatus } from "@/lib/agent/order-status";
import { resolveAgentBackendAdapter } from "@/lib/agent-backend/managed-db";
import { executeTool } from "@/lib/agent/executor";
import { buildAgentTools, buildSystemPrompt } from "@/lib/agent/engine";
import type { AgentBackendAdapter } from "@/lib/agent-backend/types";

const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockFetchOrder = fetchOrderStatus as ReturnType<typeof vi.fn>;
const mockResolve = resolveAgentBackendAdapter as ReturnType<typeof vi.fn>;

function fakeAdapter(over: Partial<AgentBackendAdapter> = {}): AgentBackendAdapter {
  return {
    consultarDisponibilidad: vi.fn(async () => [
      { startTime: "2026-07-20T09:00:00.000Z", endTime: "2026-07-20T09:30:00.000Z" },
    ]),
    crearReserva: vi.fn(async () => ({
      id: "r1",
      servicioId: "s1",
      servicioNombre: "Corte",
      startTime: "2026-07-20T09:00:00.000Z",
      endTime: "2026-07-20T09:30:00.000Z",
      estado: "confirmada",
    })),
    cancelarReserva: vi.fn(async () => ({ ok: true, estado: "cancelada" })),
    guardarLead: vi.fn(async () => ({ id: "l1", creadoEn: "2026-07-16T00:00:00.000Z" })),
    consultarPedido: vi.fn(async () => ({ encontrado: true, codigo: "P-1", estado: "enviado" })),
    notificar: vi.fn(async () => {}),
    ...over,
  } as AgentBackendAdapter;
}

function toolNames(
  ecomCfg: { orderStatusUrl?: string } | null,
  backend: { mode: string; capabilities: unknown } | null
): string[] {
  return buildAgentTools([], [], ecomCfg as any, backend).map((t) => t.function.name);
}

const BACKEND_TOOL_NAMES = [
  "listar_servicios",
  "consultar_disponibilidad",
  "crear_reserva",
  "consultar_mis_reservas",
  "cancelar_reserva",
  "guardar_lead",
  "consultar_pedido",
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ── T3.2 — gating por mode + capability ─────────────────────────────────────

describe("buildAgentTools — gating de tools de backend (mode + capability)", () => {
  it("sin fila AgentDataBackend (backend=null) → ninguna tool de backend", () => {
    const names = toolNames(null, null);
    for (const n of BACKEND_TOOL_NAMES) expect(names).not.toContain(n);
  });

  it("mode=none_yet NO recibe tools de backend aunque declare capabilities", () => {
    const names = toolNames(null, { mode: "none_yet", capabilities: ["reservas", "leads", "pedidos"] });
    for (const n of BACKEND_TOOL_NAMES) expect(names).not.toContain(n);
  });

  it("managed_db + reservas → listar_servicios, consultar_disponibilidad y crear_reserva (solo esas)", () => {
    const names = toolNames(null, { mode: "managed_db", capabilities: ["reservas"] });
    // `listar_servicios` cierra el fallo medido en produccion: sin catalogo, ante "quiero
    // pedir cita" el agente llamaba con servicio="cita" o negaba que hubiera reservas.
    expect(names).toContain("listar_servicios");
    expect(names).toContain("consultar_disponibilidad");
    expect(names).toContain("crear_reserva");
    // El bot tiene que poder cancelar, no solo reservar: sin estas dos el cliente final
    // depende de llamar al negocio.
    expect(names).toContain("consultar_mis_reservas");
    expect(names).toContain("cancelar_reserva");
    expect(names).not.toContain("guardar_lead");
    expect(names).not.toContain("consultar_pedido");
  });

  it("managed_db + leads → guardar_lead", () => {
    const names = toolNames(null, { mode: "managed_db", capabilities: ["leads"] });
    expect(names).toContain("guardar_lead");
    expect(names).not.toContain("crear_reserva");
  });

  it("managed_db + pedidos → consultar_pedido (sin get_order_status si no hay orderStatusUrl)", () => {
    const names = toolNames(null, { mode: "managed_db", capabilities: ["pedidos"] });
    expect(names).toContain("consultar_pedido");
    expect(names).not.toContain("get_order_status");
  });

  it("managed_db sin capabilities → ninguna tool de backend", () => {
    const names = toolNames(null, { mode: "managed_db", capabilities: [] });
    for (const n of BACKEND_TOOL_NAMES) expect(names).not.toContain(n);
  });

  it("capabilities desconocidas o Json malformado se ignoran", () => {
    const names = toolNames(null, { mode: "managed_db", capabilities: ["facturas", 42, null] });
    for (const n of BACKEND_TOOL_NAMES) expect(names).not.toContain(n);
    const names2 = toolNames(null, { mode: "managed_db", capabilities: "reservas" });
    for (const n of BACKEND_TOOL_NAMES) expect(names2).not.toContain(n);
  });

  it("retrocompat: get_order_status convive con consultar_pedido y no hay duplicados", () => {
    const names = toolNames(
      { orderStatusUrl: "https://x" },
      { mode: "managed_db", capabilities: ["reservas", "leads", "pedidos"] }
    );
    expect(names).toContain("get_order_status");
    for (const n of BACKEND_TOOL_NAMES) expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it("retrocompat: agente legado (sin backend) con orderStatusUrl conserva get_order_status", () => {
    const names = toolNames({ orderStatusUrl: "https://x" }, null);
    expect(names).toContain("get_order_status");
    for (const n of BACKEND_TOOL_NAMES) expect(names).not.toContain(n);
  });

  // T1.5 (aa-agent-external-crm-and-lead-qualification): external_api monta
  // las MISMAS tools que managed_db para reservas/leads, pero NUNCA pedidos
  // (el CRM público no lo expone) aunque la fila lo declare (defensa en
  // profundidad — el schema de creación ya lo impide, pero un dato legado o
  // manual no debe colar la tool).
  it("external_api + reservas/leads → consultar_disponibilidad, crear_reserva, guardar_lead (sin consultar_pedido)", () => {
    const names = toolNames(null, { mode: "external_api", capabilities: ["reservas", "leads"] });
    expect(names).toContain("consultar_disponibilidad");
    expect(names).toContain("crear_reserva");
    expect(names).toContain("guardar_lead");
    expect(names).not.toContain("consultar_pedido");
  });

  // El lane publico del CRM no expone busqueda por contacto ni cancelacion: montar las tools
  // haria que el bot ofreciera cancelar y fallara siempre (ToolDefinition.modes).
  it("external_api NO monta el autoservicio de consulta/cancelacion aunque tenga reservas", () => {
    const names = toolNames(null, { mode: "external_api", capabilities: ["reservas"] });
    expect(names).not.toContain("consultar_mis_reservas");
    expect(names).not.toContain("cancelar_reserva");
  });

  it("external_api con capabilities=['pedidos'] (dato legado/manual) → ninguna tool de backend", () => {
    const names = toolNames(null, { mode: "external_api", capabilities: ["pedidos"] });
    for (const n of BACKEND_TOOL_NAMES) expect(names).not.toContain(n);
  });

  it("calificar_lead: gated igual que guardar_lead, en ambos modos managed_db y external_api", () => {
    expect(toolNames(null, { mode: "managed_db", capabilities: ["leads"] })).toContain("calificar_lead");
    expect(toolNames(null, { mode: "external_api", capabilities: ["leads"] })).toContain("calificar_lead");
    expect(toolNames(null, { mode: "managed_db", capabilities: ["reservas"] })).not.toContain(
      "calificar_lead"
    );
    expect(toolNames(null, null)).not.toContain("calificar_lead");
  });
});

// ── T3.4 — system prompt refleja la capacidad real ──────────────────────────

function makeCaps(over: Record<string, unknown> = {}) {
  return { executableProviders: [], missingConnections: [], informationalSkills: [], ...over } as any;
}

describe("buildSystemPrompt — guía según backend", () => {
  const agent = { name: "Bot", systemPrompt: "Sé útil", skills: [] };

  it("managed_db + reservas → guía de reserva REAL (sustituye a la de calendar crudo)", () => {
    const s = buildSystemPrompt(
      agent,
      makeCaps({ executableProviders: ["calendar"] }),
      [],
      false,
      null,
      { mode: "managed_db", capabilities: ["reservas"] }
    );
    expect(s).toContain("consultar_disponibilidad");
    expect(s).toContain("crear_reserva");
    expect(s).toContain("sistema del negocio");
    // La guía de Google Calendar crudo queda SUSTITUIDA
    expect(s).not.toContain("list_calendar_events");
    expect(s).not.toContain("create_calendar_event");
  });

  it("none_yet + calendar ejecutable → guía calendar crudo intacta (sin tools de backend)", () => {
    const s = buildSystemPrompt(
      agent,
      makeCaps({ executableProviders: ["calendar"] }),
      [],
      false,
      null,
      { mode: "none_yet", capabilities: ["reservas"] }
    );
    expect(s).toContain("list_calendar_events");
    expect(s).not.toContain("crear_reserva");
  });

  it("managed_db + leads → guía de guardar_lead", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, null, {
      mode: "managed_db",
      capabilities: ["leads"],
    });
    expect(s).toContain("guardar_lead");
  });

  it("managed_db + pedidos → guía de consultar_pedido y NO la legada de get_order_status", () => {
    const s = buildSystemPrompt(
      agent,
      makeCaps(),
      [],
      false,
      { orderStatusUrl: "https://x" } as any,
      { mode: "managed_db", capabilities: ["pedidos"] }
    );
    expect(s).toContain("consultar_pedido");
    expect(s).not.toContain("get_order_status");
  });

  it("retrocompat: sin backend, orderStatusUrl mantiene la guía legada de get_order_status", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, { orderStatusUrl: "https://x" } as any);
    expect(s).toContain("get_order_status");
    expect(s).not.toContain("consultar_pedido");
  });

  // T2.3 (aa-agent-external-crm-and-lead-qualification): rúbrica HOT/WARM/COLD
  // SOLO cuando la capability leads está habilitada — en managed_db o
  // external_api indistintamente; ausente si leads está off (regresión).
  it("leads habilitado (managed_db) → incluye la rúbrica HOT/WARM/COLD de calificar_lead", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, null, {
      mode: "managed_db",
      capabilities: ["leads"],
    });
    expect(s).toContain("calificar_lead");
    expect(s).toMatch(/HOT/);
    expect(s).toMatch(/WARM/);
    expect(s).toMatch(/COLD/);
  });

  it("leads habilitado (external_api) → misma rúbrica", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, null, {
      mode: "external_api",
      capabilities: ["leads"],
    });
    expect(s).toContain("calificar_lead");
    expect(s).toMatch(/HOT/);
  });

  it("leads deshabilitado (p.ej. solo reservas) → NO incluye la rúbrica (regresión)", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, null, {
      mode: "managed_db",
      capabilities: ["reservas"],
    });
    expect(s).not.toContain("calificar_lead");
    expect(s).not.toMatch(/HOT/);
  });

  it("sin backend → NO incluye la rúbrica (regresión cero)", () => {
    const s = buildSystemPrompt(agent, makeCaps(), [], false, null, null);
    expect(s).not.toContain("calificar_lead");
  });
});

// ── T3.3 — handlers puente → adapter ────────────────────────────────────────

describe("executeTool — handlers de backend delegan en el adapter", () => {
  it("consultar_disponibilidad delega con servicio + rango de Dates", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    const res = await executeTool("a1", "consultar_disponibilidad", {
      servicio: "Corte",
      desde: "2026-07-20T00:00:00.000Z",
      hasta: "2026-07-21T00:00:00.000Z",
    });

    expect(mockResolve).toHaveBeenCalledWith("a1");
    // Sin `comensales` en el input, el grupo cae a 1: los servicios individuales (barberia,
    // estetica) siguen viendo exactamente la misma disponibilidad que antes.
    expect(adapter.consultarDisponibilidad).toHaveBeenCalledWith(
      "Corte",
      {
        desde: new Date("2026-07-20T00:00:00.000Z"),
        hasta: new Date("2026-07-21T00:00:00.000Z"),
      },
      1
    );
    expect(res).toEqual([
      { startTime: "2026-07-20T09:00:00.000Z", endTime: "2026-07-20T09:30:00.000Z" },
    ]);
  });

  it("consultar_disponibilidad rechaza fechas no ISO con error legible", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    await expect(
      executeTool("a1", "consultar_disponibilidad", { servicio: "Corte", desde: "ayer", hasta: "mañana" })
    ).rejects.toThrow(/ISO 8601/);
    expect(adapter.consultarDisponibilidad).not.toHaveBeenCalled();
  });

  it("crear_reserva delega (servicio, slot, contacto) y notifica nueva_reserva best-effort", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    const res = await executeTool("a1", "crear_reserva", {
      servicio: "Corte",
      startIso: "2026-07-20T09:00:00.000Z",
      endIso: "2026-07-20T09:30:00.000Z",
      nombre: "Ana",
      email: "ana@test.com",
    });

    expect(adapter.crearReserva).toHaveBeenCalledWith(
      "Corte",
      { startTime: "2026-07-20T09:00:00.000Z", endTime: "2026-07-20T09:30:00.000Z" },
      expect.objectContaining({ nombre: "Ana", email: "ana@test.com" })
    );
    expect(adapter.notificar).toHaveBeenCalledWith(
      "nueva_reserva",
      expect.objectContaining({ reservaId: "r1" })
    );
    expect(res).toMatchObject({ id: "r1", estado: "confirmada" });
  });

  it("crear_reserva valida el rango ANTES de tocar el adapter", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    await expect(
      executeTool("a1", "crear_reserva", {
        servicio: "Corte",
        startIso: "2026-07-20T10:00:00.000Z",
        endIso: "2026-07-20T09:00:00.000Z",
        // El contacto va puesto para aislar la guarda del rango: la del canal de contacto
        // corre antes (es la barata, sin BD) y si no, saltaria esa.
        nombre: "Ana",
        email: "ana@example.com",
      })
    ).rejects.toThrow(/posterior/);
    expect(adapter.crearReserva).not.toHaveBeenCalled();
  });

  // Regresion de un fallo REAL: se crearon citas con email=null y telefono=null DESPUES
  // de que el usuario hubiera dado ambos. El negocio recibia un hueco ocupado y nadie a
  // quien llamar. El JSON Schema no puede expresar "email O telefono" de forma portable,
  // asi que la garantia dura vive en el executor.
  it("crear_reserva exige un canal de contacto ANTES de tocar el adapter (AC4)", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    await expect(
      executeTool("a1", "crear_reserva", {
        servicio: "Corte",
        startIso: "2026-07-20T09:00:00.000Z",
        endIso: "2026-07-20T09:30:00.000Z",
        nombre: "Ana",
      })
    ).rejects.toThrow(/email o teléfono/i);
    expect(adapter.crearReserva).not.toHaveBeenCalled();
  });

  it("crear_reserva acepta solo teléfono (AC4)", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    await executeTool("a1", "crear_reserva", {
      servicio: "Corte",
      startIso: "2026-07-20T09:00:00.000Z",
      endIso: "2026-07-20T09:30:00.000Z",
      nombre: "Ana",
      telefono: "600111222",
    });

    expect(adapter.crearReserva).toHaveBeenCalled();
  });

  it("crear_reserva no acepta contacto en blanco (AC4)", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    await expect(
      executeTool("a1", "crear_reserva", {
        servicio: "Corte",
        startIso: "2026-07-20T09:00:00.000Z",
        endIso: "2026-07-20T09:30:00.000Z",
        nombre: "Ana",
        email: "   ",
        telefono: "",
      })
    ).rejects.toThrow(/email o teléfono/i);
    expect(adapter.crearReserva).not.toHaveBeenCalled();
  });

  it("guardar_lead delega (contacto, intencion) y notifica nuevo_lead", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    const res = await executeTool("a1", "guardar_lead", {
      nombre: "Ana",
      telefono: "600111222",
      intencion: "plan Pro",
    });

    expect(adapter.guardarLead).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: "Ana", telefono: "600111222" }),
      "plan Pro"
    );
    expect(adapter.notificar).toHaveBeenCalledWith("nuevo_lead", expect.objectContaining({ leadId: "l1" }));
    expect(res).toMatchObject({ id: "l1" });
  });

  it("sin backend resuelto (null) → configured:false, sin tocar el adapter", async () => {
    mockResolve.mockResolvedValue(null);

    const res = (await executeTool("a1", "crear_reserva", {
      servicio: "Corte",
      startIso: "2026-07-20T09:00:00.000Z",
      endIso: "2026-07-20T09:30:00.000Z",
    })) as { configured: boolean; message: string };

    expect(res.configured).toBe(false);
    expect(res.message).toMatch(/backend de datos/);
  });
});

// ── T3.3/T1.3 — retrocompat de pedidos ──────────────────────────────────────

describe("executeTool — retrocompat consultar_pedido / get_order_status", () => {
  it("consultar_pedido con managed_db → delega en adapter.consultarPedido", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    const res = await executeTool("a1", "consultar_pedido", { orderId: "P-1" });

    expect(adapter.consultarPedido).toHaveBeenCalledWith("P-1");
    expect(mockFetchOrder).not.toHaveBeenCalled();
    expect(res).toMatchObject({ encontrado: true, codigo: "P-1" });
  });

  it("consultar_pedido SIN managed_db cae al path legado orderStatusUrl", async () => {
    mockResolve.mockResolvedValue(null);
    mockAgent.mockResolvedValue({
      ecommerceConfig: { orderStatusUrl: "https://tienda.example.com/api/orders" },
    });

    await executeTool("agent-legacy", "consultar_pedido", { orderId: "P-123" });

    expect(mockFetchOrder).toHaveBeenCalledWith(
      { url: "https://tienda.example.com/api/orders", apiKey: undefined },
      "P-123"
    );
  });

  it("consultar_pedido sin backend NI orderStatusUrl → configured:false honesto", async () => {
    mockResolve.mockResolvedValue(null);
    mockAgent.mockResolvedValue({ ecommerceConfig: null });

    const res = (await executeTool("a1", "consultar_pedido", { orderId: "P-1" })) as {
      configured: boolean;
    };

    expect(res.configured).toBe(false);
    expect(mockFetchOrder).not.toHaveBeenCalled();
  });

  it("get_order_status legado NO cambia: usa orderStatusUrl y no consulta el resolver", async () => {
    mockAgent.mockResolvedValue({
      ecommerceConfig: { orderStatusUrl: "https://tienda.example.com/api/orders" },
    });

    await executeTool("agent-legacy", "get_order_status", { orderId: "P-9" });

    expect(mockFetchOrder).toHaveBeenCalledWith(
      { url: "https://tienda.example.com/api/orders", apiKey: undefined },
      "P-9"
    );
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("get_order_status sin config → configured:false (R5-4, intacto)", async () => {
    mockAgent.mockResolvedValue({ ecommerceConfig: {} });

    const res = (await executeTool("a1", "get_order_status", { orderId: "P-1" })) as {
      configured: boolean;
    };

    expect(res.configured).toBe(false);
    expect(mockFetchOrder).not.toHaveBeenCalled();
  });
});

/**
 * aa-reservas-fecha-y-zona-del-modelo. Fallo REAL en produccion (Lafayette, 2026-07-30):
 * el modelo emite el ISO sin offset y se leia en la zona del proceso (UTC en Render), asi
 * que el rango de una cena se desplazaba dos horas y caia en el dia siguiente, y
 * `crear_reserva` no encontraba NUNCA el hueco que la propia herramienta acababa de ofrecer.
 */
describe("executeTool — fechas del modelo en la zona del negocio", () => {
  const mockResolve = resolveAgentBackendAdapter as unknown as ReturnType<typeof vi.fn>;

  it("consultar_disponibilidad lee un ISO naive en la zona del negocio (AC2)", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    await executeTool("a1", "consultar_disponibilidad", {
      servicio: "Cena",
      desde: "2026-08-07T20:00:00",
      hasta: "2026-08-07T22:45:00",
      comensales: 2,
    });

    const [, rango] = (adapter.consultarDisponibilidad as ReturnType<typeof vi.fn>).mock.calls[0];
    // 20:00 y 22:45 de Madrid, no de UTC: leidas como UTC, el `hasta` caia en la madrugada
    // del dia 8 y la herramienta devolvia los huecos del dia equivocado.
    expect(rango.desde.toISOString()).toBe("2026-08-07T18:00:00.000Z");
    expect(rango.hasta.toISOString()).toBe("2026-08-07T20:45:00.000Z");
  });

  it("consultar_disponibilidad respeta un ISO que ya trae offset (AC1)", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    await executeTool("a1", "consultar_disponibilidad", {
      servicio: "Cena",
      desde: "2026-08-07T20:00:00.000+02:00",
      hasta: "2026-08-07T22:45:00.000+02:00",
    });

    const [, rango] = (adapter.consultarDisponibilidad as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rango.desde.toISOString()).toBe("2026-08-07T18:00:00.000Z");
  });

  it("crear_reserva normaliza un startIso naive a la zona del negocio (AC3)", async () => {
    const adapter = fakeAdapter();
    mockResolve.mockResolvedValue(adapter);

    await executeTool("a1", "crear_reserva", {
      servicio: "Cena",
      startIso: "2026-08-07T20:30:00",
      endIso: "2026-08-07T22:30:00",
      nombre: "Adrian",
      email: "adrian@test.com",
      comensales: 2,
    });

    // El adapter recibe cadenas y las pasa por `new Date()`: si llegaran naive volverian a
    // leerse en la zona del proceso y la comparacion exacta contra el hueco fallaria.
    expect(adapter.crearReserva).toHaveBeenCalledWith(
      "Cena",
      { startTime: "2026-08-07T20:30:00.000+02:00", endTime: "2026-08-07T22:30:00.000+02:00" },
      expect.objectContaining({ nombre: "Adrian" })
    );
  });
});

describe("buildSystemPrompt — ancla de fecha (AC4)", () => {
  const agent = { name: "Bot", systemPrompt: "Sé útil", skills: [] };

  it("el prompt ancla la fecha de hoy en la zona del negocio (AC4)", () => {
    const s = buildSystemPrompt(agent, makeCaps({}), [], false, null, null, {
      // 00:10 del 31 en Madrid: en UTC todavia es el 30. Manda el reloj del negocio.
      instante: new Date("2026-07-30T22:10:00.000Z"),
      timezone: "Europe/Madrid",
    });
    expect(s).toContain("31 de julio de 2026");
    expect(s).toContain("Europe/Madrid");
    // El dia de la semana va dentro: "el sabado" no se resuelve desde una fecha suelta.
    expect(s).toContain("viernes");
  });

  it("la fecha se da en la zona del negocio, no en la del servidor (AC4)", () => {
    const s = buildSystemPrompt(agent, makeCaps({}), [], false, null, null, {
      instante: new Date("2026-07-30T22:10:00.000Z"),
      timezone: "Atlantic/Canary",
    });
    // En Canarias son las 23:10 del 30, no las 00:10 del 31.
    expect(s).toContain("30 de julio de 2026");
  });

  it("sin fechaActual el prompt no cambia (AC4)", () => {
    const s = buildSystemPrompt(agent, makeCaps({}), [], false, null, null);
    expect(s).not.toContain("Hoy es");
  });
});
