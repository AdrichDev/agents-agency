/**
 * Tests for ecommerce-flow-improvements:
 * R1/R2 RAG prompt, R3 intent, R4 handoff/business-hours, R5 order-status, crypto round-trip, GET /leads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "@/lib/logger";

// SSRF guard usa dns.lookup; en tests lo resolvemos a una IP pública determinista.
vi.mock("node:dns", () => {
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  return { default: { promises: { lookup } }, promises: { lookup } };
});

import { isWithinBusinessHours, type EcommerceConfig } from "@/lib/agent/handoff";
import { fetchOrderStatus } from "@/lib/agent/order-status";
import * as tools from "@/lib/agent/tools";
import { KNOWLEDGE_TOOL, HANDOFF_TOOL, ECOMMERCE_TOOLS, TOOLS_BY_PROVIDER } from "@/lib/agent/tools";
import { encryptToken, decryptToken } from "@/lib/integrations/oauth";

// ── R2-1: KNOWLEDGE_TOOL description menciona source ─────────────────────────

describe("KNOWLEDGE_TOOL description", () => {
  it("menciona 'source' y citar", () => {
    expect(KNOWLEDGE_TOOL.description).toMatch(/source/i);
    expect(KNOWLEDGE_TOOL.description).toMatch(/cita/i);
  });
});

// ── R1: HANDOFF_TOOL exportado; INTENT_TOOL retirada (T8.6) ───────────────────

describe("INTENT_TOOL retirada (T8.6)", () => {
  // Esta prueba antes fijaba el nombre y el esquema de `record_lead_intent`. Protegía una tool
  // cuyo `output` era un eco de su argumento y que por tanto costaba una segunda llamada al LLM por
  // cada mensaje con intención de compra. Se invierte: lo que hay que fijar es que ya no existe.
  it("el módulo no exporta INTENT_TOOL", () => {
    expect("INTENT_TOOL" in tools).toBe(false);
  });
});

describe("HANDOFF_TOOL", () => {
  it("tiene nombre correcto", () => {
    expect(HANDOFF_TOOL.name).toBe("request_human_handoff");
  });
  it("no requiere fields obligatorios (reason opcional)", () => {
    expect(HANDOFF_TOOL.input_schema.required ?? []).toHaveLength(0);
  });
});

// ── R5: ECOMMERCE_TOOLS ───────────────────────────────────────────────────────

describe("ECOMMERCE_TOOLS", () => {
  it("contiene get_order_status con orderId required", () => {
    const t = ECOMMERCE_TOOLS.find((x) => x.name === "get_order_status");
    expect(t).toBeDefined();
    expect(t!.input_schema.required).toContain("orderId");
  });
  it("TOOLS_BY_PROVIDER.ecommerce incluye get_order_status", () => {
    const names = TOOLS_BY_PROVIDER["ecommerce"]?.map((t) => t.name) ?? [];
    expect(names).toContain("get_order_status");
  });
});

// ── R4-1/R4-D: isWithinBusinessHours (función pura) ──────────────────────────

describe("isWithinBusinessHours", () => {
  // Fijamos un miércoles (day=3) a las 10:30 en Europe/Madrid
  // Para las pruebas usamos UTC directo con horario simple
  const makeCfg = (schedule: EcommerceConfig["businessHours"]): EcommerceConfig => ({
    businessHours: schedule,
  });

  it("config vacía → 24/7 (true)", () => {
    expect(isWithinBusinessHours(undefined)).toBe(true);
    expect(isWithinBusinessHours({})).toBe(true);
    expect(isWithinBusinessHours({ businessHours: { timezone: "", schedule: [] } })).toBe(true);
  });

  it("dentro de franja → true", () => {
    // Lunes 10:00 UTC (day=1)
    const monday10 = new Date("2024-01-08T10:00:00Z"); // lunes
    const cfg = makeCfg({ timezone: "UTC", schedule: [{ day: 1, open: "09:00", close: "18:00" }] });
    expect(isWithinBusinessHours(cfg, monday10)).toBe(true);
  });

  it("fuera de franja → false", () => {
    const monday20 = new Date("2024-01-08T20:00:00Z"); // lunes 20:00 UTC
    const cfg = makeCfg({ timezone: "UTC", schedule: [{ day: 1, open: "09:00", close: "18:00" }] });
    expect(isWithinBusinessHours(cfg, monday20)).toBe(false);
  });

  it("día no laborable → false", () => {
    const saturday = new Date("2024-01-06T11:00:00Z"); // sábado
    const cfg = makeCfg({ timezone: "UTC", schedule: [{ day: 1, open: "09:00", close: "18:00" }] });
    expect(isWithinBusinessHours(cfg, saturday)).toBe(false);
  });

  it("timezone inválida → fallback 24/7 (true) + no lanza", () => {
    const cfg = makeCfg({ timezone: "Invalid/Timezone_XYZ", schedule: [{ day: 1, open: "09:00", close: "18:00" }] });
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(() => isWithinBusinessHours(cfg, new Date())).not.toThrow();
    expect(isWithinBusinessHours(cfg, new Date())).toBe(true);
    warnSpy.mockRestore();
  });
});

// ── R5-2/R5-3/R5-6: fetchOrderStatus ─────────────────────────────────────────

describe("fetchOrderStatus", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("endpoint OK → { ok: true, raw }", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "shipped", trackingId: "ABC123" }),
      text: async () => "",
    } as any);

    const result = await fetchOrderStatus({ url: "https://api.test.com/orders" }, "12345");
    expect(result.ok).toBe(true);
    expect(result.raw).toMatchObject({ status: "shipped" });
    expect(result.error).toBeUndefined();
  });

  it("endpoint 500 → { ok: false, error }", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as any);

    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const result = await fetchOrderStatus({ url: "https://api.test.com/orders" }, "12345");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
    errorSpy.mockRestore();
  });

  it("timeout/network error → { ok: false, error } sin throw", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));

    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const result = await fetchOrderStatus({ url: "https://api.test.com/orders" }, "12345");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    errorSpy.mockRestore();
  });

  it("incluye Authorization Bearer si apiKey presente", async () => {
    let capturedHeaders: any;
    globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
      capturedHeaders = opts?.headers;
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      } as any);
    });

    await fetchOrderStatus({ url: "https://api.test.com/orders", apiKey: "secret-key" }, "99");
    expect(capturedHeaders?.Authorization).toBe("Bearer secret-key");
  });

  it("orderId se pasa por query param", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: async () => ({}) } as any);
    });

    await fetchOrderStatus({ url: "https://api.test.com/orders" }, "ORDER-42");
    expect(capturedUrl).toContain("orderId=ORDER-42");
  });
});

// ── AD7: encryptToken/decryptToken round-trip ─────────────────────────────────

describe("encryptToken / decryptToken round-trip", () => {
  beforeEach(() => {
    process.env.CHANNEL_ENCRYPTION_KEY =
      "0000000000000000000000000000000000000000000000000000000000000001"; // 32 bytes hex de test
  });

  it("cifra y descifra correctamente", () => {
    const plain = "my-super-secret-api-key";
    const encrypted = encryptToken(plain);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain(plain);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(plain);
  });

  it("apiKey no aparece en claro en el token cifrado", () => {
    const plain = "should-not-be-visible";
    const encrypted = encryptToken(plain);
    expect(encrypted).not.toContain(plain);
  });
});

// ── R3: record_lead_intent retirada del executor (T8.6) ──────────────────────

describe("record_lead_intent ya no es ejecutable (T8.6)", () => {
  it("el executor no tiene handler para la tool retirada", async () => {
    vi.mock("@/lib/db", () => ({
      prisma: {
        agent: { findUniqueOrThrow: vi.fn() },
        conversation: { findUnique: vi.fn(), update: vi.fn() },
        lead: { upsert: vi.fn() },
        knowledgeChunk: { count: vi.fn().mockResolvedValue(0) },
      },
    }));

    const { executeTool } = await import("@/lib/agent/executor");
    // El modelo puede alucinar una llamada a una tool que no se le ofreció. `executeTool` lanza
    // "Tool desconocida", y el bucle agéntico ya captura eso y se lo devuelve al modelo como
    // output de error, así que el turno sigue vivo.
    await expect(
      executeTool("agent-1", "record_lead_intent", { intent: "plan Pro" }, "conv-1")
    ).rejects.toThrow(/Tool desconocida/);
  });
});
