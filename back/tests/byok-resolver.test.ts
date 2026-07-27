/**
 * H2 (aa-credenciales-byok-multiproveedor) — T4.3 / T4.4 / T4.5.
 *
 * `getClientForAgent` es donde se decide CON QUÉ CUENTA se paga la llamada. El peligro de H2 es
 * el inverso al de H1: allí era servir a quien no era facturable; aquí es cargar el LLM a la
 * parte equivocada. Dos formas de que eso pasara en silencio, y las dos se prueban aquí:
 *
 *  1. Un tenant en modo `byok` sin credencial usable cayendo al cliente global → la plataforma
 *     pagaría el consumo de quien contrató precisamente para pagarlo él. Debe ser **402**,
 *     nunca un fallback (T4.3).
 *  2. El proveedor deducido del modelo equivocado → se buscaría la credencial de OpenAI para
 *     servir un `claude-*`, o se usaría la clave de un proveedor contra otro.
 *
 * Igual que `openai-agent-client.test.ts`, aquí NO se mockea `@/lib/openai` (es el módulo bajo
 * test): se mockea el SDK y las credenciales.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const OpenAICtor = vi.fn();

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    public opts: any;
    public models = { list: vi.fn() };
    public chat = { completions: { create: vi.fn() } };
    constructor(opts: any) {
      this.opts = opts;
      OpenAICtor(opts);
    }
  },
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() }, config: vi.fn() }));

const mockGetKey = vi.fn();
vi.mock("@/lib/llm/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/credentials")>();
  return { ...actual, getDecryptedApiKey: mockGetKey };
});

const mockCreateGoverned = vi.fn();
vi.mock("@/lib/llm/governance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/governance")>();
  return {
    ...actual,
    createGovernedClient: vi.fn((opts: any) => {
      mockCreateGoverned(opts);
      // Instancia distinta por llamada: así se puede distinguir "vino de caché" de "se
      // construyó otra vez" comparando referencias.
      return { __byok: true, opts, chat: { completions: { create: vi.fn() } } } as any;
    }),
  };
});

const ORIGINAL_ENV = { ...process.env };

function conectada(over: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    credential: {
      apiKey: "sk-del-cliente",
      updatedAt: new Date("2026-07-27T10:00:00.000Z"),
      ...over,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  OpenAICtor.mockClear();
  mockGetKey.mockReset();
  mockCreateGoverned.mockClear();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.OPENCLAW_BASE_URL;
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  delete process.env.OPENCLAW_AGENT_ID;
  process.env.OPENAI_API_KEY = "sk-plataforma";
  process.env.GEMINI_API_KEY = "gemini-plataforma";
  process.env.ANTHROPIC_API_KEY = "sk-ant-plataforma";
  mockGetKey.mockResolvedValue(conectada());
});

describe("T4.1 — modo platform: nada cambia respecto a antes de H2", () => {
  it("devuelve el cliente global y no consulta credenciales del tenant", async () => {
    const { getClientForAgent, openai } = await import("@/lib/openai");

    const res = await getClientForAgent({ tenantId: "t1", credentialMode: "platform", model: "gpt-4o" });

    expect(res.client).toBe(openai);
    expect(res.isOpenclaw).toBe(false);
    expect(mockGetKey).not.toHaveBeenCalled();
  });

  it("sin credentialMode (agente/tenant anterior a H2) también usa el global", async () => {
    const { getClientForAgent, openai } = await import("@/lib/openai");

    const res = await getClientForAgent({ tenantId: "t1", model: "gpt-4o" });

    expect(res.client).toBe(openai);
    expect(mockGetKey).not.toHaveBeenCalled();
  });
});

describe("T4.2 — modo byok: se sirve con la clave del cliente", () => {
  it("construye un cliente per-tenant con la clave descifrada, no el global", async () => {
    const { getClientForAgent, openai } = await import("@/lib/openai");

    const res = await getClientForAgent({
      tenantId: "t1",
      credentialMode: "byok",
      model: "gpt-4o",
    });

    expect(res.client).not.toBe(openai);
    expect(mockCreateGoverned).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", apiKey: "sk-del-cliente" })
    );
  });

  it("el proveedor sale del MODELO: un claude-* busca la credencial de Anthropic", async () => {
    // Si esto se equivocara, se intentaría servir Claude con la clave de OpenAI del cliente:
    // ni funcionaría, ni el mensaje de error diría por qué.
    const { getClientForAgent } = await import("@/lib/openai");

    await getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "claude-opus-5" });

    expect(mockGetKey).toHaveBeenCalledWith("t1", "anthropic");
    expect(mockCreateGoverned).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic" })
    );
  });

  it("un gemini-* busca la credencial de Gemini", async () => {
    const { getClientForAgent } = await import("@/lib/openai");

    await getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "gemini-3.5-flash" });

    expect(mockGetKey).toHaveBeenCalledWith("t1", "gemini");
  });

  it("el cliente per-tenant queda gobernado por la misma regla que el global", async () => {
    // Se construye vía `createGovernedClient`, no con `new OpenAI` a pelo. Es lo que impide que
    // un cliente BYOK reciba un 400 por `reasoning_effort` que el global nunca recibiría.
    const { getClientForAgent } = await import("@/lib/openai");

    await getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "gpt-5.4" });

    expect(mockCreateGoverned).toHaveBeenCalledTimes(1);
    // Y con un thunk para el effort global, no un valor capturado al construir.
    expect(typeof mockCreateGoverned.mock.calls[0][0].defaultEffort).toBe("function");
  });
});

describe("T4.3 — fail-closed: byok sin clave usable NO cae al cliente de la plataforma", () => {
  it("credencial ausente: 402, no fallback", async () => {
    mockGetKey.mockResolvedValue({ ok: false, failure: { kind: "missing" } });
    const { getClientForAgent } = await import("@/lib/openai");

    // Que LANCE es la prueba de que no hubo fallback: con fallback, esto resolvería con el
    // cliente global y la plataforma pagaría la llamada.
    await expect(
      getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "gpt-4o" })
    ).rejects.toMatchObject({ status: 402 });

    expect(mockCreateGoverned).not.toHaveBeenCalled();
  });

  it("credencial inválida: 402 aunque exista la fila", async () => {
    mockGetKey.mockResolvedValue({
      ok: false,
      failure: { kind: "not_connected", status: "invalid" },
    });
    const { getClientForAgent } = await import("@/lib/openai");

    await expect(
      getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "gpt-4o" })
    ).rejects.toMatchObject({ status: 402 });
  });

  it("clave ilegible: 402, y el motivo apunta al problema real", async () => {
    mockGetKey.mockResolvedValue({ ok: false, failure: { kind: "undecryptable" } });
    const { getClientForAgent } = await import("@/lib/openai");

    await expect(
      getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "gpt-4o" })
    ).rejects.toMatchObject({ status: 402, message: expect.stringMatching(/administrador/i) });
  });

  it("el 402 NO revela la clave ni el interno del cifrado al visitante del widget", async () => {
    mockGetKey.mockResolvedValue({ ok: false, failure: { kind: "undecryptable" } });
    const { getClientForAgent } = await import("@/lib/openai");

    const err = await getClientForAgent({
      tenantId: "t1",
      credentialMode: "byok",
      model: "gpt-4o",
    }).catch((e) => e);

    expect(err.message).not.toMatch(/CHANNEL_ENCRYPTION_KEY|enc:v1|sk-/);
  });

  it("byok sigue cortando aunque la plataforma SÍ tenga clave configurada", async () => {
    // El caso que un fallback silencioso haría invisible: hay con qué servir, y precisamente
    // por eso hay que no hacerlo.
    process.env.OPENAI_API_KEY = "sk-plataforma-con-saldo";
    mockGetKey.mockResolvedValue({ ok: false, failure: { kind: "missing" } });
    const { getClientForAgent } = await import("@/lib/openai");

    await expect(
      getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "gpt-4o" })
    ).rejects.toMatchObject({ status: 402 });
  });
});

describe("T4.4 — caché de clientes por tenant, invalidada por updatedAt", () => {
  it("dos llamadas iguales reutilizan la misma instancia", async () => {
    const { getClientForAgent } = await import("@/lib/openai");
    const sel = { tenantId: "t1", credentialMode: "byok", model: "gpt-4o" };

    const a = await getClientForAgent(sel);
    const b = await getClientForAgent(sel);

    expect(a.client).toBe(b.client);
    expect(mockCreateGoverned).toHaveBeenCalledTimes(1);
  });

  it("cambiar la clave cambia updatedAt y por tanto la instancia", async () => {
    // `updatedAt` va DENTRO de la clave de caché a propósito: quita el paso "acordarse de
    // invalidar". Sin esto, un cliente que rota su clave seguiría siendo servido con la vieja
    // hasta el siguiente reinicio del proceso.
    const { getClientForAgent } = await import("@/lib/openai");
    const sel = { tenantId: "t1", credentialMode: "byok", model: "gpt-4o" };

    const antes = await getClientForAgent(sel);
    mockGetKey.mockResolvedValue(
      conectada({ apiKey: "sk-rotada", updatedAt: new Date("2026-07-28T09:00:00.000Z") })
    );
    const despues = await getClientForAgent(sel);

    expect(despues.client).not.toBe(antes.client);
    expect(mockCreateGoverned).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: "sk-rotada" })
    );
  });

  it("al rotar, la instancia con la clave VIEJA se purga (no queda en memoria)", async () => {
    // Poner `updatedAt` en la clave de caché deja la entrada vieja inalcanzable, pero no la borra:
    // seguiría residente con la clave que el cliente acaba de revocar dentro. Se comprueba
    // volviendo a presentar la credencial ANTIGUA: si la entrada vieja siguiera en el Map, se
    // devolvería la instancia cacheada; al haberse purgado, hay que construirla otra vez.
    const { getClientForAgent } = await import("@/lib/openai");
    const sel = { tenantId: "t1", credentialMode: "byok", model: "gpt-4o" };

    const vieja = await getClientForAgent(sel);
    mockGetKey.mockResolvedValue(
      conectada({ apiKey: "sk-rotada", updatedAt: new Date("2026-07-28T09:00:00.000Z") })
    );
    await getClientForAgent(sel);

    mockGetKey.mockResolvedValue(conectada()); // vuelve la credencial original
    const revisitada = await getClientForAgent(sel);

    expect(revisitada.client).not.toBe(vieja.client);
    expect(mockCreateGoverned).toHaveBeenCalledTimes(3);
  });

  it("la purga es por tenant y proveedor: no tira los clientes de los demás", async () => {
    const { getClientForAgent } = await import("@/lib/openai");
    mockGetKey.mockImplementation(async (tenantId: string) =>
      conectada({ apiKey: `sk-de-${tenantId}` })
    );

    const otro = await getClientForAgent({ tenantId: "t2", credentialMode: "byok", model: "gpt-4o" });
    await getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "gpt-4o" });
    mockGetKey.mockImplementation(async (tenantId: string) =>
      conectada({ apiKey: `sk-de-${tenantId}`, updatedAt: new Date("2026-07-28T09:00:00.000Z") })
    );
    await getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "gpt-4o" });

    // t2 no ha rotado nada: su cliente sigue siendo el mismo objeto.
    mockGetKey.mockImplementation(async (tenantId: string) =>
      conectada({ apiKey: `sk-de-${tenantId}` })
    );
    const otroDespues = await getClientForAgent({
      tenantId: "t2",
      credentialMode: "byok",
      model: "gpt-4o",
    });
    expect(otroDespues.client).toBe(otro.client);
  });

  it("dos tenants distintos nunca comparten instancia (ni clave)", async () => {
    const { getClientForAgent } = await import("@/lib/openai");
    mockGetKey.mockImplementation(async (tenantId: string) =>
      conectada({ apiKey: `sk-de-${tenantId}` })
    );

    const a = await getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "gpt-4o" });
    const b = await getClientForAgent({ tenantId: "t2", credentialMode: "byok", model: "gpt-4o" });

    expect(a.client).not.toBe(b.client);
    expect((a.client as any).opts.apiKey).toBe("sk-de-t1");
    expect((b.client as any).opts.apiKey).toBe("sk-de-t2");
  });

  it("el mismo tenant con dos proveedores tiene un cliente por proveedor", async () => {
    const { getClientForAgent } = await import("@/lib/openai");

    const a = await getClientForAgent({ tenantId: "t1", credentialMode: "byok", model: "gpt-4o" });
    const b = await getClientForAgent({
      tenantId: "t1",
      credentialMode: "byok",
      model: "claude-opus-5",
    });

    expect(a.client).not.toBe(b.client);
  });
});

describe("T4.5 — bordes: sin tenant y runtime openclaw", () => {
  it("byok sin tenantId cae al global: sin tenant no hay credencial que resolver", async () => {
    // `credentialMode` vive en el Tenant, así que este estado no debería existir; si aparece
    // (agente de prueba sin asignar), no se puede resolver clave de nadie.
    const { getClientForAgent, openai } = await import("@/lib/openai");

    const res = await getClientForAgent({ credentialMode: "byok", model: "gpt-4o" });

    expect(res.client).toBe(openai);
    expect(mockGetKey).not.toHaveBeenCalled();
  });

  it("openclaw ignora byok: su gateway no se paga con la clave del cliente", async () => {
    process.env.OPENCLAW_BASE_URL = "https://openclaw.example/v1";
    process.env.OPENCLAW_GATEWAY_TOKEN = "token-gw";
    const { getClientForAgent } = await import("@/lib/openai");

    const res = await getClientForAgent({
      runtime: "openclaw",
      agentId: "a1",
      tenantId: "t1",
      credentialMode: "byok",
      model: "gpt-4o",
    });

    expect(res.isOpenclaw).toBe(true);
    expect(mockGetKey).not.toHaveBeenCalled();
    expect(mockCreateGoverned).not.toHaveBeenCalled();
  });
});
