/**
 * T6 — aa-agent-backend-foundation Fase 6 (AC9).
 * Cubre el dispatcher de notificaciones al dueno del negocio (canal v1 Telegram):
 *  (1) envia en cada evento habilitado (`nueva_reserva`/`nuevo_lead`/`handoff`);
 *  (2) no-op silencioso si el evento esta deshabilitado, no hay `telegramChatId`
 *      o el agente no tiene canal Telegram conectado;
 *  (3) best-effort: un fallo o timeout de envio NO propaga (no rompe el chat ni
 *      la reserva);
 *  (4) los puntos de llamada del executor disparan el dispatcher:
 *      `ManagedDbAdapter.notificar` delega en el, `crear_reserva`/`guardar_lead`
 *      lo alcanzan via `adapter.notificar`, y `request_human_handoff` lo llama
 *      directo (en paralelo al path Slack legado).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (patron agent-backend-tools.test.ts) ───────────────────────────────
vi.mock("@/lib/db", () => ({
  prisma: {
    agentDataBackend: { findUnique: vi.fn() },
    channelConnection: { findUnique: vi.fn() },
    agent: { findUniqueOrThrow: vi.fn() },
    // aa-reservas-fecha-y-zona-del-modelo: el motor resuelve la zona del negocio para anclar
    // la fecha de hoy en el prompt de sistema.
    agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },
    lead: { upsert: vi.fn() },
  },
}));
vi.mock("@/lib/channels/telegram", () => ({ sendMessage: vi.fn(async () => {}) }));
vi.mock("@/lib/channels/webhook-shared", () => ({
  decryptCreds: vi.fn(() => ({ token: "BOT:TESTTOKEN" })),
}));
// Mantener REAL: managed-db (ManagedDbAdapter) y notify-dispatcher — solo se
// aisla `resolveAgentBackendAdapter` (necesitaria pg) del resto del modulo.
vi.mock("@/lib/agent-backend/managed-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-backend/managed-db")>();
  return { ...actual, resolveAgentBackendAdapter: vi.fn() };
});
// Executor: aislar dependencias pesadas de import (mismo patron que T3).
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));
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
vi.mock("@/lib/agent/order-status", () => ({ fetchOrderStatus: vi.fn() }));
vi.mock("@/lib/agent/handoff", () => ({
  isWithinBusinessHours: vi.fn(() => true),
  mergeConversationMetadata: vi.fn(async () => {}),
  getConversationMetadata: vi.fn(async () => ({})),
  buildConversationSummary: vi.fn(async () => "Resumen: el cliente pide hablar con una persona."),
}));

import { prisma } from "@/lib/db";
import { sendMessage as tgSendMessage } from "@/lib/channels/telegram";
import {
  dispatchNotification,
  buildNotificationMessage,
} from "@/lib/agent-backend/notify-dispatcher";
import {
  ManagedDbAdapter,
  resolveAgentBackendAdapter,
} from "@/lib/agent-backend/managed-db";
import { executeTool } from "@/lib/agent/executor";
import type { AgentBackendAdapter, EventoNotificacion } from "@/lib/agent-backend/types";

const mockBackend = prisma.agentDataBackend.findUnique as ReturnType<typeof vi.fn>;
const mockChannel = prisma.channelConnection.findUnique as ReturnType<typeof vi.fn>;
const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockUpsert = prisma.lead.upsert as ReturnType<typeof vi.fn>;
const mockSend = tgSendMessage as ReturnType<typeof vi.fn>;
const mockResolve = resolveAgentBackendAdapter as ReturnType<typeof vi.fn>;

const AGENT_ID = "agent-1";
const CHAT_ID = "123456789";
const ALL_EVENTS = ["nueva_reserva", "nuevo_lead", "handoff"];

/** Configura el estado prisma que ve el dispatcher. */
function configure(opts: {
  events?: string[] | undefined;
  telegramChatId?: string | undefined;
  hasChannel?: boolean;
}) {
  const { events, telegramChatId, hasChannel = true } = opts;
  mockBackend.mockResolvedValue({ notificationConfig: { telegramChatId, events } });
  mockChannel.mockResolvedValue(hasChannel ? { credentials: { enc: "x" } } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.AGENT_NOTIFY_TIMEOUT_MS;
});

describe("dispatchNotification — envío por evento", () => {
  it.each(ALL_EVENTS)("envía Telegram al dueño en el evento habilitado '%s'", async (evento) => {
    configure({ events: ALL_EVENTS, telegramChatId: CHAT_ID });
    await dispatchNotification(AGENT_ID, evento as EventoNotificacion, { servicio: "Corte", nombre: "Ana" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [token, chatId] = mockSend.mock.calls[0];
    expect(token).toBe("BOT:TESTTOKEN");
    expect(chatId).toBe(Number(CHAT_ID)); // chat_id numérico, no string
  });

  it("el mensaje de nueva_reserva incluye servicio, hora y contacto", async () => {
    configure({ events: ["nueva_reserva"], telegramChatId: CHAT_ID });
    await dispatchNotification(AGENT_ID, "nueva_reserva", {
      servicio: "Corte de pelo",
      startTime: "2026-07-20T09:00:00.000Z",
      contacto: "Ana",
      telefono: "600123123",
    });
    const text = String(mockSend.mock.calls[0][2]);
    expect(text).toContain("Corte de pelo");
    expect(text).toContain("2026-07-20T09:00:00.000Z");
    expect(text).toContain("Ana");
    expect(text).toContain("600123123");
  });
});

describe("dispatchNotification — no-op silencioso", () => {
  it("no envía si el evento está deshabilitado", async () => {
    configure({ events: ["nuevo_lead"], telegramChatId: CHAT_ID });
    await dispatchNotification(AGENT_ID, "nueva_reserva", {});
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("no envía si no hay telegramChatId configurado", async () => {
    configure({ events: ALL_EVENTS, telegramChatId: undefined });
    await dispatchNotification(AGENT_ID, "nueva_reserva", {});
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("no envía si el agente no tiene canal Telegram conectado", async () => {
    configure({ events: ALL_EVENTS, telegramChatId: CHAT_ID, hasChannel: false });
    await dispatchNotification(AGENT_ID, "nueva_reserva", {});
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("no envía si el chatId no es numérico", async () => {
    configure({ events: ALL_EVENTS, telegramChatId: "no-numérico" });
    await dispatchNotification(AGENT_ID, "nueva_reserva", {});
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("no envía si el agente no tiene AgentDataBackend (sin config)", async () => {
    mockBackend.mockResolvedValue(null);
    mockChannel.mockResolvedValue({ credentials: { enc: "x" } });
    await dispatchNotification(AGENT_ID, "nueva_reserva", {});
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("dispatchNotification — best-effort (nunca propaga)", () => {
  it("un fallo de envío no lanza", async () => {
    configure({ events: ALL_EVENTS, telegramChatId: CHAT_ID });
    mockSend.mockRejectedValue(new Error("Telegram 500"));
    await expect(dispatchNotification(AGENT_ID, "nueva_reserva", {})).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("un envío que cuelga se corta por timeout sin propagar", async () => {
    configure({ events: ALL_EVENTS, telegramChatId: CHAT_ID });
    process.env.AGENT_NOTIFY_TIMEOUT_MS = "20";
    mockSend.mockImplementation(() => new Promise(() => {})); // nunca resuelve
    await expect(dispatchNotification(AGENT_ID, "nueva_reserva", {})).resolves.toBeUndefined();
  });
});

describe("buildNotificationMessage", () => {
  it("nuevo_lead incluye nombre e intención", () => {
    const msg = buildNotificationMessage("nuevo_lead", { nombre: "Luis", intencion: "quiere presupuesto" });
    expect(msg).toContain("Luis");
    expect(msg).toContain("quiere presupuesto");
  });

  it("handoff sin resumen produce un mensaje genérico válido", () => {
    const msg = buildNotificationMessage("handoff", {});
    expect(msg.toLowerCase()).toContain("escalado");
  });
});

describe("puntos de llamada — el executor dispara el dispatcher", () => {
  it("ManagedDbAdapter.notificar delega en el dispatcher (envío Telegram)", async () => {
    configure({ events: ["nueva_reserva"], telegramChatId: CHAT_ID });
    const adapter = new ManagedDbAdapter(AGENT_ID, ["reservas"]);
    await adapter.notificar("nueva_reserva", { servicio: "Corte" });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  /** Adapter falso cuyo `notificar` cablea el dispatcher REAL (como ManagedDbAdapter). */
  function wiredAdapter(): AgentBackendAdapter {
    return {
      listarServicios: vi.fn(async () => []),
      consultarDisponibilidad: vi.fn(async () => []),
      crearReserva: vi.fn(async () => ({
        id: "r1",
        servicioId: "s1",
        servicioNombre: "Corte",
        startTime: "2026-07-20T09:00:00.000Z",
        endTime: "2026-07-20T09:30:00.000Z",
        estado: "confirmada",
      })),
      cancelarReserva: vi.fn(async () => ({ ok: true, estado: "cancelada" })),
      consultarMisReservas: vi.fn(async () => []),
      cancelarReservaPorCodigo: vi.fn(async () => ({ ok: true, estado: "cancelada" })),
      guardarLead: vi.fn(async () => ({ id: "l1", creadoEn: "2026-07-16T00:00:00.000Z" })),
      consultarPedido: vi.fn(async () => ({ encontrado: false, codigo: "x" })),
      notificar: (evento, payload) => dispatchNotification(AGENT_ID, evento, payload),
    };
  }

  it("el handler crear_reserva alcanza el dispatcher vía adapter.notificar", async () => {
    configure({ events: ["nueva_reserva"], telegramChatId: CHAT_ID });
    mockResolve.mockResolvedValue(wiredAdapter());
    await executeTool(
      AGENT_ID,
      "crear_reserva",
      {
        servicio: "Corte",
        startIso: "2026-07-20T09:00:00.000Z",
        endIso: "2026-07-20T09:30:00.000Z",
        nombre: "Ana",
        telefono: "600111222",
      },
      "conv-1"
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(String(mockSend.mock.calls[0][2])).toContain("Corte");
  });

  it("el handler guardar_lead alcanza el dispatcher vía adapter.notificar", async () => {
    configure({ events: ["nuevo_lead"], telegramChatId: CHAT_ID });
    mockResolve.mockResolvedValue(wiredAdapter());
    await executeTool(
      AGENT_ID,
      "guardar_lead",
      { nombre: "Luis", intencion: "presupuesto" },
      "conv-1"
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(String(mockSend.mock.calls[0][2])).toContain("Luis");
  });

  it("request_human_handoff dispara el dispatcher (handoff) sin romper el flujo", async () => {
    configure({ events: ["handoff"], telegramChatId: CHAT_ID });
    mockAgent.mockResolvedValue({ ecommerceConfig: {} }); // sin handoffSlackChannel → path Slack no interfiere
    mockUpsert.mockResolvedValue({ id: "lead-h" });

    const result: any = await executeTool(AGENT_ID, "request_human_handoff", {}, "conv-1");

    expect(result.handed_off).toBe(true); // el handoff sigue funcionando
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(String(mockSend.mock.calls[0][2]).toLowerCase()).toContain("escalado");
  });

  it("un fallo de envío en el handoff no rompe la operación (best-effort)", async () => {
    configure({ events: ["handoff"], telegramChatId: CHAT_ID });
    mockAgent.mockResolvedValue({ ecommerceConfig: {} });
    mockUpsert.mockResolvedValue({ id: "lead-h" });
    mockSend.mockRejectedValue(new Error("Telegram caído"));

    const result: any = await executeTool(AGENT_ID, "request_human_handoff", {}, "conv-1");
    expect(result.handed_off).toBe(true); // la caída del aviso no propaga
  });
});
