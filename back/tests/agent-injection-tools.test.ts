/**
 * S2 (security-wave-2, T4) — guardas del executor: argumentos, propiedad de la reserva,
 * destinos de salida y topes por conversación.
 *
 * El encuadre del contenido no confiable se prueba en `agent-injection.test.ts` (bucle real).
 * Aquí se prueba la capa que decide ANTES de tocar el mundo: si un argumento inválido, una
 * reserva ajena o un destino externo llegan al handler, no hay prompt que valga.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    integration: { findUnique: vi.fn(), findMany: vi.fn() },
    agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },
    agentDataBackend: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/agent-backend/managed-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-backend/managed-db")>();
  return { ...actual, resolveAgentBackendAdapter: vi.fn(), enabledBackendCapabilities: vi.fn() };
});
vi.mock("@/lib/integrations/gmail", () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: "m1" })) }));
vi.mock("@/lib/integrations/slack", () => ({ sendMessage: vi.fn(async () => ({ ok: true, ts: "1" })) }));
vi.mock("@/lib/integrations/jira", () => ({
  createIssue: vi.fn(async () => ({ ok: true, key: "SUP-1", url: "https://x/browse/SUP-1" })),
}));
vi.mock("@/lib/integrations/calendar", () => ({
  createEvent: vi.fn(async () => ({ ok: true, id: "e1", link: "https://cal/e1" })),
}));
vi.mock("@/lib/integrations/oauth", () => ({
  getValidToken: vi.fn(async () => "token-de-prueba"),
  decryptToken: vi.fn((v: string) => v),
  encryptToken: vi.fn((v: string) => v),
}));
vi.mock("@/lib/integrations/service-map", () => ({
  toPhysicalProvider: vi.fn((p: string) => (p === "gmail" ? "google" : p)),
}));

import { prisma } from "@/lib/db";
import { resolveAgentBackendAdapter } from "@/lib/agent-backend/managed-db";
import * as gmail from "@/lib/integrations/gmail";
import * as slack from "@/lib/integrations/slack";
import * as jira from "@/lib/integrations/jira";
import * as calendar from "@/lib/integrations/calendar";
import { executeTool } from "@/lib/agent/executor";
import { validateToolInput, ToolInputError } from "@/lib/agent/tool-schema";
import { DESTRUCTIVE_ACTION_LIMIT, OUTBOUND_ACTION_LIMIT } from "@/lib/agent/outbound-guard";

const asMock = (v: unknown) => v as ReturnType<typeof vi.fn>;

const mockAgent = asMock(prisma.agent.findUnique);
const mockLead = asMock(prisma.lead.findUnique);
const mockConversation = asMock(prisma.conversation.findUnique);
const mockConversationUpdate = asMock(prisma.conversation.update);
const mockResolve = asMock(resolveAgentBackendAdapter);
const mockGmailSend = asMock(gmail.sendEmail);
const mockSlackSend = asMock(slack.sendMessage);
const mockJiraIssue = asMock(jira.createIssue);
const mockCalendarEvent = asMock(calendar.createEvent);

/** Estado real (mutable) del metadata de la conversación: los topes se escriben ahí. */
let convMetadata: Record<string, any>;

function wireAgent(over: Record<string, unknown> = {}) {
  mockAgent.mockResolvedValue({
    ecommerceConfig: {},
    tenant: { email: "negocio@barberia.es", phone: null },
    integrations: [],
    ...over,
  });
}

function fakeAdapter() {
  const cancelarReservaPorCodigo = vi.fn(async () => ({ ok: true, estado: "cancelled" }));
  mockResolve.mockResolvedValue({ cancelarReservaPorCodigo } as any);
  return { cancelarReservaPorCodigo };
}

beforeEach(() => {
  vi.clearAllMocks();
  convMetadata = {};
  mockConversation.mockImplementation(async () => ({ metadata: convMetadata }));
  mockConversationUpdate.mockImplementation(async ({ data }: any) => {
    convMetadata = data.metadata;
    return { metadata: convMetadata };
  });
  mockLead.mockResolvedValue({ email: "ana@example.com", phone: null });
  wireAgent();
});

// ── R2 — validación de argumentos contra el input_schema ──────────────────

describe("S2/R2 — los argumentos se validan contra el schema ANTES de despachar", () => {
  it("un tipo equivocado devuelve error estructurado y el handler NO se ejecuta", async () => {
    const { cancelarReservaPorCodigo } = fakeAdapter();

    await expect(
      executeTool("a1", "crear_reserva", {
        servicio: "Corte",
        comensales: 1,
        startIso: "2026-08-11T17:00:00",
        endIso: "2026-08-11T17:45:00",
        nombre: 123,
      })
    ).rejects.toBeInstanceOf(ToolInputError);
    expect(cancelarReservaPorCodigo).not.toHaveBeenCalled();
    // El modelo recibe el error por el bucle: aquí basta con que el mensaje sea accionable.
    await expect(
      executeTool("a1", "crear_reserva", { servicio: "Corte", nombre: "Ana", comensales: 1 })
    ).rejects.toThrow(/startIso/);
  });

  it("un enum fuera de rango nombra los valores permitidos y no llega al handler", async () => {
    const upsert = vi.fn();
    asMock(prisma.lead.upsert).mockImplementation(upsert);
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      mode: "managed_db",
      capabilities: ["leads"],
    });

    await expect(
      executeTool("a1", "calificar_lead", { qualification: "meh", reason: "x" }, "conv-1")
    ).rejects.toThrow(/hot.*warm.*cold/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("una cadena por encima del tope se rechaza (el modelo no infla el prompt por tool)", async () => {
    await expect(
      executeTool("a1", "send_email", {
        to: "ana@example.com",
        subject: "x",
        body: "y".repeat(9000),
      })
    ).rejects.toBeInstanceOf(ToolInputError);
    expect(mockGmailSend).not.toHaveBeenCalled();
  });

  it("claves desconocidas sólo se rechazan donde el schema dice additionalProperties:false", () => {
    const estricto = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
    };
    expect(() => validateToolInput("t", estricto, { a: "x", b: 1 })).toThrow(/b/);
    // Un schema sin la bandera acepta claves extra (retrocompatibilidad con el modelo).
    const laxo = { type: "object", properties: { a: { type: "string" } } };
    expect(validateToolInput("t", laxo, { a: "x", b: 1 })).toEqual({ a: "x", b: 1 });
  });

  it("los argumentos válidos pasan intactos (no se recorta ni se renombra nada)", async () => {
    const { cancelarReservaPorCodigo } = fakeAdapter();

    const res = await executeTool(
      "a1",
      "cancelar_reserva",
      { codigo: "CAS-KVPA", email: "ana@example.com", extra: "se conserva" },
      "conv-1"
    );

    expect(cancelarReservaPorCodigo).toHaveBeenCalledWith("CAS-KVPA", {
      email: "ana@example.com",
      telefono: undefined,
    });
    expect(res).toEqual({ ok: true, estado: "cancelled" });
  });
});

// ── Preservación: las herramientas que ya existían siguen funcionando igual ──

describe("sin regresión para el negocio legítimo", () => {
  it("crear_reserva con argumentos válidos sigue llegando al adapter", async () => {
    const crearReserva = vi.fn(async () => ({
      id: "r1",
      servicioId: "s1",
      servicioNombre: "Corte",
      startTime: "2026-08-11T17:00:00.000+02:00",
      endTime: "2026-08-11T17:45:00.000+02:00",
      estado: "scheduled",
    }));
    mockResolve.mockResolvedValue({ crearReserva, notificar: vi.fn(async () => {}) } as any);

    const res = await executeTool(
      "a1",
      "crear_reserva",
      {
        servicio: "Corte",
        comensales: 1,
        startIso: "2026-08-11T17:00:00",
        endIso: "2026-08-11T17:45:00",
        nombre: "Ana",
      },
      "conv-1"
    );

    expect(crearReserva).toHaveBeenCalled();
    expect(res).toMatchObject({ id: "r1" });
  });

  it("consultar_mis_reservas no cambia: sigue aceptando el contacto del cliente", async () => {
    const consultarMisReservas = vi.fn(async () => []);
    mockResolve.mockResolvedValue({ consultarMisReservas } as any);

    const res = await executeTool(
      "a1",
      "consultar_mis_reservas",
      { email: "ana@example.com" },
      "conv-1"
    );

    expect(consultarMisReservas).toHaveBeenCalledWith({ email: "ana@example.com", telefono: undefined });
    expect(res).toEqual([]);
  });

  it("usar_skill con su argumento válido sigue cargando la skill", async () => {
    const res = (await executeTool("a1", "usar_skill", { skillName: "   " })) as { error?: string };
    // Sin tocar BD: el nombre vacío sigue devolviendo el error honesto de siempre.
    expect(res.error).toContain("nombre exacto");
  });
});

// ── R3 — la reserva tiene que ser de esta conversación ────────────────────

describe("S2/R3 — cancelar sólo la reserva del contacto de ESTA conversación", () => {
  it("un contacto que no es el de la conversación se rechaza sin llamar al adapter", async () => {
    const { cancelarReservaPorCodigo } = fakeAdapter();

    await expect(
      executeTool(
        "a1",
        "cancelar_reserva",
        { codigo: "OTRA-9999", email: "otra@example.com" },
        "conv-1"
      )
    ).rejects.toThrow(/contacto de esta conversación/i);
    expect(cancelarReservaPorCodigo).not.toHaveBeenCalled();
  });

  it("sin contacto capturado en la conversación no se cancela nada", async () => {
    const { cancelarReservaPorCodigo } = fakeAdapter();
    mockLead.mockResolvedValue(null);

    await expect(
      executeTool("a1", "cancelar_reserva", { codigo: "CAS-KVPA", email: "ana@example.com" }, "conv-1")
    ).rejects.toThrow(/pídele|pide/i);
    expect(cancelarReservaPorCodigo).not.toHaveBeenCalled();
  });

  it("sin conversación no hay forma de comprobar la propiedad: se rechaza", async () => {
    const { cancelarReservaPorCodigo } = fakeAdapter();

    await expect(
      executeTool("a1", "cancelar_reserva", { codigo: "CAS-KVPA", email: "ana@example.com" })
    ).rejects.toThrow(/conversación/i);
    expect(cancelarReservaPorCodigo).not.toHaveBeenCalled();
  });

  it("el camino legítimo devuelve el MISMO resultado que antes", async () => {
    const { cancelarReservaPorCodigo } = fakeAdapter();

    const res = await executeTool("a1", "cancelar_reserva", { codigo: "CAS-KVPA" }, "conv-1");

    expect(res).toEqual({ ok: true, estado: "cancelled" });
    expect(cancelarReservaPorCodigo).toHaveBeenCalledTimes(1);
  });

  it("sin código mantiene el mensaje accionable de siempre", async () => {
    fakeAdapter();
    await expect(executeTool("a1", "cancelar_reserva", { codigo: "  " }, "conv-1")).rejects.toThrow(
      /Falta el código/
    );
  });

  it(`la ${DESTRUCTIVE_ACTION_LIMIT + 1}ª cancelación de la misma conversación se bloquea`, async () => {
    const { cancelarReservaPorCodigo } = fakeAdapter();

    for (let i = 0; i < DESTRUCTIVE_ACTION_LIMIT; i++) {
      await executeTool("a1", "cancelar_reserva", { codigo: `CAS-${i}` }, "conv-1");
    }
    expect(cancelarReservaPorCodigo).toHaveBeenCalledTimes(DESTRUCTIVE_ACTION_LIMIT);

    await expect(
      executeTool("a1", "cancelar_reserva", { codigo: "CAS-FINAL" }, "conv-1")
    ).rejects.toThrow(/límite|limite/i);
    expect(cancelarReservaPorCodigo).toHaveBeenCalledTimes(DESTRUCTIVE_ACTION_LIMIT);
  });
});

// ── R4 — destinos de las herramientas de salida ───────────────────────────

describe("S2/R4 — salidas sólo hacia los destinos configurados del negocio", () => {
  it("email a un tercero: rechazado sin tocar Gmail", async () => {
    wireAgent({ integrations: [{ provider: "google", metadata: { email: "bot@barberia.es" } }] });

    await expect(
      executeTool(
        "a1",
        "send_email",
        { to: "atacante@evil.example", subject: "s", body: "b" },
        "conv-1"
      )
    ).rejects.toThrow(/destino|no permitid/i);
    expect(mockGmailSend).not.toHaveBeenCalled();
  });

  it("email al contacto de la conversación: permitido y sin cambios", async () => {
    wireAgent({ integrations: [{ provider: "google", metadata: { email: "bot@barberia.es" } }] });

    const res = await executeTool(
      "a1",
      "send_email",
      { to: "ana@example.com", subject: "s", body: "b" },
      "conv-1"
    );

    expect(mockGmailSend).toHaveBeenCalledWith("token-de-prueba", "ana@example.com", "s", "b");
    expect(res).toEqual({ ok: true, id: "m1" });
  });

  it("email a la dirección de avisos del tenant: permitido", async () => {
    const res = await executeTool(
      "a1",
      "send_email",
      { to: "negocio@barberia.es", subject: "s", body: "b" },
      "conv-1"
    );
    expect(mockGmailSend).toHaveBeenCalled();
    expect(res).toEqual({ ok: true, id: "m1" });
  });

  it("un destinatario permitido junto a uno externo se rechaza entero", async () => {
    await expect(
      executeTool(
        "a1",
        "send_email",
        { to: "ana@example.com, atacante@evil.example", subject: "s", body: "b" },
        "conv-1"
      )
    ).rejects.toThrow(/destino|no permitid/i);
    expect(mockGmailSend).not.toHaveBeenCalled();
  });

  it("Slack sin canal configurado: se rechaza (antes el modelo elegía el canal)", async () => {
    wireAgent({ integrations: [{ provider: "slack", metadata: { team: "Barberia" } }] });

    await expect(
      executeTool("a1", "send_slack_message", { channel: "#general", text: "hola" }, "conv-1")
    ).rejects.toThrow(/canal/i);
    expect(mockSlackSend).not.toHaveBeenCalled();
  });

  it("Slack al canal de la integración configurado: permitido", async () => {
    wireAgent({
      integrations: [{ provider: "slack", metadata: { team: "Barberia", channel: "#avisos" } }],
    });

    const res = await executeTool(
      "a1",
      "send_slack_message",
      { channel: "#avisos", text: "Nueva reserva" },
      "conv-1"
    );

    expect(mockSlackSend).toHaveBeenCalledWith("token-de-prueba", "#avisos", "Nueva reserva");
    expect(res).toEqual({ ok: true, ts: "1" });
  });

  it("Jira con proyecto configurado: otro proyecto se rechaza", async () => {
    wireAgent({ ecommerceConfig: { jiraProjectKey: "SUP" } });

    await expect(
      executeTool(
        "a1",
        "create_jira_issue",
        { projectKey: "OTRO", summary: "x" },
        "conv-1"
      )
    ).rejects.toThrow(/proyecto/i);
    expect(mockJiraIssue).not.toHaveBeenCalled();

    const res = await executeTool("a1", "create_jira_issue", { projectKey: "SUP", summary: "x" }, "conv-1");
    expect(mockJiraIssue).toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, key: "SUP-1" });
  });

  it("calendario: un invitado externo se rechaza; sin invitados se crea igual", async () => {
    const base = { title: "Corte", startIso: "2026-08-11T17:00:00Z", endIso: "2026-08-11T17:45:00Z" };

    await expect(
      executeTool(
        "a1",
        "create_calendar_event",
        { ...base, attendees: ["atacante@evil.example"] },
        "conv-1"
      )
    ).rejects.toThrow(/invitad|destino/i);
    expect(mockCalendarEvent).not.toHaveBeenCalled();

    const res = await executeTool("a1", "create_calendar_event", base, "conv-1");
    expect(mockCalendarEvent).toHaveBeenCalledWith("token-de-prueba", base);
    expect(res).toMatchObject({ ok: true, id: "e1" });
  });

  it(`la ${OUTBOUND_ACTION_LIMIT + 1}ª salida de la conversación se bloquea`, async () => {
    for (let i = 0; i < OUTBOUND_ACTION_LIMIT; i++) {
      await executeTool(
        "a1",
        "send_email",
        { to: "ana@example.com", subject: `s${i}`, body: "b" },
        "conv-1"
      );
    }
    expect(mockGmailSend).toHaveBeenCalledTimes(OUTBOUND_ACTION_LIMIT);

    await expect(
      executeTool("a1", "send_email", { to: "ana@example.com", subject: "s", body: "b" }, "conv-1")
    ).rejects.toThrow(/límite|limite/i);
    expect(mockGmailSend).toHaveBeenCalledTimes(OUTBOUND_ACTION_LIMIT);
  });
});
