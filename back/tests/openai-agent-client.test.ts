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

  /**
   * aa-openclaw-runtime-fail-closed — Desde este cambio, `runtime="openclaw"` EXIGE gateway
   * configurado: ya no hay fallback a `http://localhost:18791/v1`. Los tests que miden el
   * routing del `model` (prioridad override global → target per-agente → default) siguen
   * midiendo lo mismo, pero necesitan la precondición. No se relajan: se les da el gateway.
   */
  function conGatewayConfigurado(baseUrl = "http://localhost:18791/v1", token = "gw-token") {
    process.env.OPENCLAW_BASE_URL = baseUrl;
    process.env.OPENCLAW_GATEWAY_TOKEN = token;
  }

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
    const resolution = await getClientForAgent({});

    expect(resolution.client).toBe(openai); // mismo singleton — comportamiento intacto
    expect(resolution.model).toBeUndefined();
    expect(resolution.isOpenclaw).toBe(false);
  });

  it('runtime "openai" → cliente global openai, sin model override (byte-identical)', async () => {
    const { getClientForAgent, openai } = await import("@/lib/openai");
    const resolution = await getClientForAgent({ runtime: "openai" });

    expect(resolution.client).toBe(openai);
    expect(resolution.model).toBeUndefined();
    expect(resolution.isOpenclaw).toBe(false);
  });

  it('runtime "openclaw" → cliente NUEVO (no el singleton), baseURL/apiKey del gateway configurado', async () => {
    conGatewayConfigurado();

    const { getClientForAgent, openai } = await import("@/lib/openai");
    const resolution = await getClientForAgent({ runtime: "openclaw" });

    expect(resolution.client).not.toBe(openai); // instancia nueva, no el singleton parcheado
    expect(resolution.isOpenclaw).toBe(true);
    expect(resolution.model).toBe("openclaw/default"); // default cuando no hay OPENCLAW_AGENT_ID
    expect(OpenAICtor).toHaveBeenCalledWith({
      baseURL: "http://localhost:18791/v1",
      apiKey: "gw-token",
    });
  });

  // ── E1-E3 · Fail-closed sin gateway (aa-openclaw-runtime-fail-closed) ──────
  // Antes de este cambio la factory caía a `?? "http://localhost:18791/v1"`. En Render eso es
  // el propio contenedor del back: ECONNREFUSED, error sin status, 500 opaco. El agente no
  // responde igual; la diferencia es que ahora dice por qué.

  it('E1 · runtime "openclaw" SIN OPENCLAW_BASE_URL → HttpError 503, y no construye cliente', async () => {
    const { getClientForAgent } = await import("@/lib/openai");
    const { HttpError } = await import("@/lib/http");

    // El constructor ya se ha llamado una vez al importar el módulo (singleton de la
    // plataforma). Lo que se mide es que la rama openclaw no añada NINGUNA construcción:
    // no basta con que lance, tiene que no haber intentado hablar con localhost.
    const construccionesPrevias = OpenAICtor.mock.calls.length;

    await expect(getClientForAgent({ runtime: "openclaw", agentId: "ag-42" })).rejects.toThrow(
      HttpError
    );
    expect(OpenAICtor.mock.calls.length).toBe(construccionesPrevias);

    const error = await getClientForAgent({ runtime: "openclaw", agentId: "ag-42" }).catch((e) => e);
    expect(error.status).toBe(503);
  });

  it('E2 · runtime "openclaw" con URL pero SIN OPENCLAW_GATEWAY_TOKEN → HttpError 503', async () => {
    // Sin token el SDK real lanza hablando de OPENAI_API_KEY: una pista falsa que apunta al
    // proveedor equivocado. El gateway exige `Authorization: Bearer` (spike.md §1).
    process.env.OPENCLAW_BASE_URL = "http://gateway.local:9000/v1";

    const { getClientForAgent } = await import("@/lib/openai");
    const error = await getClientForAgent({ runtime: "openclaw" }).catch((e) => e);

    expect(error.status).toBe(503);
    expect(error.message).toContain("OPENCLAW_GATEWAY_TOKEN");
  });

  it("E3 · el mensaje es accionable para el operador y opaco para el visitante", async () => {
    const { getClientForAgent } = await import("@/lib/openai");
    const { visitorError } = await import("@/lib/agent/visitor-error");

    const error = await getClientForAgent({ runtime: "openclaw" }).catch((e) => e);
    expect(error.message).toContain("OPENCLAW_BASE_URL");

    // Un 503 cae en CUALQUIER_5XX de la tabla cerrada: el visitante de la web de un cliente no
    // lee nunca el nombre de una variable de entorno nuestra.
    const publico = visitorError(error);
    expect(publico.code).toBe("INTERNAL");
    expect(publico.error).not.toMatch(/OPENCLAW|localhost|env/i);
  });

  it('runtime "openclaw" → respeta OPENCLAW_BASE_URL / OPENCLAW_GATEWAY_TOKEN / OPENCLAW_AGENT_ID', async () => {
    process.env.OPENCLAW_BASE_URL = "http://gateway.local:9000/v1";
    process.env.OPENCLAW_GATEWAY_TOKEN = "secret-token";
    process.env.OPENCLAW_AGENT_ID = "openclaw/bot-lua";

    const { getClientForAgent } = await import("@/lib/openai");
    const resolution = await getClientForAgent({ runtime: "openclaw" });

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
    conGatewayConfigurado();

    const { getClientForAgent } = await import("@/lib/openai");
    const resolution = await getClientForAgent({ runtime: "openclaw", agentId: "ag-42" });

    expect(resolution.model).toBe("openclaw/aa-ag-42");
    expect(resolution.model).not.toBe("openclaw/default");
  });

  it('runtime "openclaw" + agentId + OPENCLAW_AGENT_ID definido → el override global GANA (no el target per-agente)', async () => {
    conGatewayConfigurado();
    process.env.OPENCLAW_AGENT_ID = "openclaw/shared-single-agent";

    const { getClientForAgent } = await import("@/lib/openai");
    const resolution = await getClientForAgent({ runtime: "openclaw", agentId: "ag-42" });

    expect(resolution.model).toBe("openclaw/shared-single-agent");
    expect(resolution.model).not.toBe("openclaw/aa-ag-42");
  });

  it('runtime "openclaw" SIN agentId y SIN OPENCLAW_AGENT_ID → fallback final "openclaw/default"', async () => {
    conGatewayConfigurado();

    const { getClientForAgent } = await import("@/lib/openai");
    const resolution = await getClientForAgent({ runtime: "openclaw" });

    expect(resolution.model).toBe("openclaw/default");
  });

  it('runtime "openclaw" → nunca inyecta reasoning_effort (el choke-point solo cubre el singleton openai)', async () => {
    conGatewayConfigurado();

    const { getClientForAgent, openai } = await import("@/lib/openai");
    const resolution = await getClientForAgent({ runtime: "openclaw" });

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
