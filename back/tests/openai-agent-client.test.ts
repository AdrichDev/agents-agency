// F1 (aa-openclaw-brain): tests de la factory getClientForAgent (lib/openai.ts).
// A diferencia del resto de la suite, aquí NO se mockea "@/lib/openai" entero
// (es el módulo bajo test) — se mockea el SDK "openai" (sin red, constructor
// stub) para poder inspeccionar con qué opciones se instancia cada cliente.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const OpenAICtor = vi.fn();

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    public opts: any;
    public chat = { completions: { create: vi.fn() } };
    constructor(opts: any) {
      this.opts = opts;
      OpenAICtor(opts);
    }
  },
}));

// getClientForAgent no toca la BD (solo refreshModelConfig lo hace, y no se
// llama aquí), pero mockeamos @/lib/db igualmente para no depender de
// DATABASE_URL / red en la suite unitaria.
vi.mock("@/lib/db", () => ({ prisma: {} }));

// Evita que dotenv.config() lea el .env real del repo y repueble las env
// vars OPENCLAW_* que este archivo borra a propósito en cada test — hermético.
vi.mock("dotenv", () => ({ default: { config: vi.fn() }, config: vi.fn() }));

describe("getClientForAgent (lib/openai.ts)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    OpenAICtor.mockClear();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OPENCLAW_BASE_URL;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.OPENCLAW_AGENT_ID;
    // Determinismo: fuerza la rama OpenAI (no Gemini) del choke-point de
    // reasoning_effort, independiente de si el .env real define GEMINI_API_KEY.
    delete process.env.GEMINI_API_KEY;
    // Hermeticidad: el mock de dotenv (arriba) impide cargar OPENAI_API_KEY del
    // .env real, así que la fijamos explícitamente. Sin esto, en un entorno donde
    // OPENAI_API_KEY no está exportada al shell, `openai` sería null y el módulo
    // reventaría al importar (choke-point). El SDK está mockeado (FakeOpenAI).
    process.env.OPENAI_API_KEY = "sk-test-hermetic";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("runtime ausente (fila sin migrar) → cliente global openai, sin model override", async () => {
    const { getClientForAgent, openai } = await import("@/lib/openai");
    const resolution = getClientForAgent({});

    expect(resolution.client).toBe(openai); // mismo singleton — comportamiento intacto
    expect(resolution.model).toBeUndefined();
    expect(resolution.isOpenclaw).toBe(false);
  });

  it('runtime "openai" → cliente global openai, sin model override (byte-identical)', async () => {
    const { getClientForAgent, openai } = await import("@/lib/openai");
    const resolution = getClientForAgent({ runtime: "openai" });

    expect(resolution.client).toBe(openai);
    expect(resolution.model).toBeUndefined();
    expect(resolution.isOpenclaw).toBe(false);
  });

  it('runtime "openclaw" → cliente NUEVO (no el singleton), baseURL/apiKey del gateway por defecto', async () => {
    const { getClientForAgent, openai } = await import("@/lib/openai");
    const resolution = getClientForAgent({ runtime: "openclaw" });

    expect(resolution.client).not.toBe(openai); // instancia nueva, no el singleton parcheado
    expect(resolution.isOpenclaw).toBe(true);
    expect(resolution.model).toBe("openclaw/default"); // default cuando no hay OPENCLAW_AGENT_ID
    expect(OpenAICtor).toHaveBeenCalledWith({
      baseURL: "http://localhost:18791/v1",
      apiKey: undefined,
    });
  });

  it('runtime "openclaw" → respeta OPENCLAW_BASE_URL / OPENCLAW_GATEWAY_TOKEN / OPENCLAW_AGENT_ID', async () => {
    process.env.OPENCLAW_BASE_URL = "http://gateway.local:9000/v1";
    process.env.OPENCLAW_GATEWAY_TOKEN = "secret-token";
    process.env.OPENCLAW_AGENT_ID = "openclaw/bot-lua";

    const { getClientForAgent } = await import("@/lib/openai");
    const resolution = getClientForAgent({ runtime: "openclaw" });

    expect(resolution.model).toBe("openclaw/bot-lua");
    expect(OpenAICtor).toHaveBeenCalledWith({
      baseURL: "http://gateway.local:9000/v1",
      apiKey: "secret-token",
    });
  });

  // ── Routing per-agente (cierre del gap F1↔F2, 03/07/2026) ─────────────────
  // F2 (lib/openclaw/provision.ts) aprovisiona una entrada agents.list[] POR
  // AGENTE con id "aa-<agentId>". El factory debe apuntar el chat a ESE mismo
  // target salvo que OPENCLAW_AGENT_ID (override global) esté definido.

  it('runtime "openclaw" + agentId, SIN OPENCLAW_AGENT_ID → model derivado "openclaw/aa-<agentId>"', async () => {
    const { getClientForAgent } = await import("@/lib/openai");
    const resolution = getClientForAgent({ runtime: "openclaw", agentId: "ag-42" });

    expect(resolution.model).toBe("openclaw/aa-ag-42");
    expect(resolution.model).not.toBe("openclaw/default");
  });

  it('runtime "openclaw" + agentId + OPENCLAW_AGENT_ID definido → el override global GANA (no el target per-agente)', async () => {
    process.env.OPENCLAW_AGENT_ID = "openclaw/shared-single-agent";

    const { getClientForAgent } = await import("@/lib/openai");
    const resolution = getClientForAgent({ runtime: "openclaw", agentId: "ag-42" });

    expect(resolution.model).toBe("openclaw/shared-single-agent");
    expect(resolution.model).not.toBe("openclaw/aa-ag-42");
  });

  it('runtime "openclaw" SIN agentId y SIN OPENCLAW_AGENT_ID → fallback final "openclaw/default"', async () => {
    const { getClientForAgent } = await import("@/lib/openai");
    const resolution = getClientForAgent({ runtime: "openclaw" });

    expect(resolution.model).toBe("openclaw/default");
  });

  it('runtime "openclaw" → nunca inyecta reasoning_effort (el choke-point solo cubre el singleton openai)', async () => {
    const { getClientForAgent, openai } = await import("@/lib/openai");
    const resolution = getClientForAgent({ runtime: "openclaw" });

    // El choke-point de reasoning_effort reasigna openai.chat.completions.create
    // (singleton) a una función envoltorio — deja de ser el stub original.
    const singletonCreate = (openai.chat.completions as any).create;
    expect(vi.isMockFunction(singletonCreate)).toBe(false); // envuelto por el choke-point

    // Un cliente `new OpenAI(...)` fresco (caso openclaw) nunca pasa por ahí:
    // su create() sigue siendo el stub original del mock, sin envolver.
    const openclawCreate = (resolution.client.chat.completions as any).create;
    expect(vi.isMockFunction(openclawCreate)).toBe(true);
  });
});
