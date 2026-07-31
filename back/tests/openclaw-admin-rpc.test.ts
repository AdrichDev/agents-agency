/**
 * Tests unitarios para el cliente admin-http-rpc de OpenClaw (F2 —
 * openspec/changes/aa-openclaw-brain). Mockea fetch global — sin gateway real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  delete process.env.OPENCLAW_ADMIN_URL;
  delete process.env.OPENCLAW_BASE_URL;
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  // `admin-rpc.ts` resuelve el bearer como PASSWORD || TOKEN. En una máquina con un
  // OPENCLAW_GATEWAY_PASSWORD real en el entorno gana ese, y la aserción de la cabecera
  // Authorization recibe la credencial de producción en vez del literal del test. El test no
  // puede depender de la AUSENCIA de una variable, así que se borra explícitamente.
  delete process.env.OPENCLAW_GATEWAY_PASSWORD;
}

beforeEach(() => {
  resetEnv();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isConfigured", () => {
  it("false sin OPENCLAW_ADMIN_URL/OPENCLAW_GATEWAY_TOKEN", async () => {
    const { isConfigured } = await import("@/lib/openclaw/admin-rpc");
    expect(isConfigured()).toBe(false);
  });

  it("true con OPENCLAW_ADMIN_URL + OPENCLAW_GATEWAY_TOKEN explícitos", async () => {
    process.env.OPENCLAW_ADMIN_URL = "http://localhost:18791";
    process.env.OPENCLAW_GATEWAY_TOKEN = "tok";
    const { isConfigured } = await import("@/lib/openclaw/admin-rpc");
    expect(isConfigured()).toBe(true);
  });

  it("true derivando el host admin de OPENCLAW_BASE_URL (quita el sufijo /v1)", async () => {
    process.env.OPENCLAW_BASE_URL = "http://localhost:18791/v1";
    process.env.OPENCLAW_GATEWAY_TOKEN = "tok";
    const { isConfigured } = await import("@/lib/openclaw/admin-rpc");
    expect(isConfigured()).toBe(true);
  });

  it("false si solo hay token pero ningún host configurado", async () => {
    process.env.OPENCLAW_GATEWAY_TOKEN = "tok";
    const { isConfigured } = await import("@/lib/openclaw/admin-rpc");
    expect(isConfigured()).toBe(false);
  });
});

describe("configGet / configPatch — modo noop (fail-soft, sin gateway configurado)", () => {
  it("configGet devuelve ok:false sin lanzar y sin llamar a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { configGet } = await import("@/lib/openclaw/admin-rpc");
    const result = await configGet();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/noop/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("configPatch devuelve ok:false sin lanzar y sin llamar a fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { configPatch } = await import("@/lib/openclaw/admin-rpc");
    const result = await configPatch({ agents: { list: [] } }, ["agents.list"]);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("configGet / configPatch — gateway configurado", () => {
  beforeEach(() => {
    process.env.OPENCLAW_ADMIN_URL = "http://localhost:18791";
    process.env.OPENCLAW_GATEWAY_TOKEN = "secret-gw-token";
  });

  it("configGet hace POST a /api/v1/admin/rpc con method config.get y Bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, payload: { config: { agents: { list: [] } } } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { configGet } = await import("@/lib/openclaw/admin-rpc");
    const result = await configGet();

    expect(result.ok).toBe(true);
    expect(result.payload?.config?.agents?.list).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:18791/api/v1/admin/rpc");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-gw-token");
    const body = JSON.parse(init.body);
    expect(body.method).toBe("config.get");
  });

  it("configPatch envía params = {...patch, replacePaths}", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, payload: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { configPatch } = await import("@/lib/openclaw/admin-rpc");
    await configPatch({ agents: { list: [{ id: "aa-1" }] } }, ["agents.list"]);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.method).toBe("config.patch");
    expect(body.params.agents.list).toEqual([{ id: "aa-1" }]);
    expect(body.params.replacePaths).toEqual(["agents.list"]);
  });

  it("status HTTP no-ok → ok:false, no lanza", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { configGet } = await import("@/lib/openclaw/admin-rpc");
    const result = await configGet();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });

  it("respuesta { ok:false } del RPC → ok:false con el error del payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "unknown method" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { configGet } = await import("@/lib/openclaw/admin-rpc");
    const result = await configGet();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown method");
  });

  it("error de red (fetch rechaza) → ok:false, nunca lanza", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const { configGet } = await import("@/lib/openclaw/admin-rpc");
    await expect(configGet()).resolves.toMatchObject({ ok: false });
  });
});
