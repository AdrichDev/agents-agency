/**
 * Tests unitarios para el servicio de aprovisionamiento AA → OpenClaw (F2 —
 * openspec/changes/aa-openclaw-brain). Mockea @/lib/openclaw/admin-rpc (sin
 * gateway real) y usa el cifrado real de @/lib/crypto para el handover de
 * Telegram (roundtrip determinista, mismo patrón que tests/channels.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const configGet = vi.fn();
const configPatch = vi.fn();
const listModels = vi.fn();

vi.mock("@/lib/openclaw/admin-rpc", () => ({
  configGet: (...args: unknown[]) => configGet(...args),
  configPatch: (...args: unknown[]) => configPatch(...args),
  listModels: (...args: unknown[]) => listModels(...args),
}));

import {
  syncAgentProvisioning,
  provisionTelegramChannel,
  reconcileAgentsProvisioning,
} from "@/lib/openclaw/provision";
import { openclawAgentId } from "@/lib/openclaw/agent-id";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: la sonda en vivo no ve el target (gateway sin restart) → pending.
  listModels.mockResolvedValue({ ok: false, error: "noop" });
});

describe("syncAgentProvisioning — skip para agentes no-openclaw", () => {
  it("runtime='openai' y remove=false → skip, no llama al gateway", async () => {
    const result = await syncAgentProvisioning({ id: "a1", name: "Bot", runtime: "openai" });
    expect(result).toEqual({ ok: true, status: "skipped", reason: "runtime is not openclaw" });
    expect(configGet).not.toHaveBeenCalled();
    expect(configPatch).not.toHaveBeenCalled();
  });

  it("runtime ausente (fila sin migrar) y remove=false → skip", async () => {
    const result = await syncAgentProvisioning({ id: "a1", name: "Bot" });
    expect(result.status).toBe("skipped");
    expect(configGet).not.toHaveBeenCalled();
  });
});

describe("syncAgentProvisioning — upsert (runtime='openclaw')", () => {
  it("agente nuevo: añade una entrada a agents.list y hace patch con replacePaths=['agents.list']", async () => {
    configGet.mockResolvedValue({ ok: true, payload: { config: { agents: { list: [] } } } });
    configPatch.mockResolvedValue({ ok: true, payload: {} });

    const result = await syncAgentProvisioning({ id: "a1", name: "Bot", runtime: "openclaw", temperature: 0.4, systemPrompt: "Prompt del agente" });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("synced");
    expect(result.pendingRestart).toBe(true);
    expect(configPatch).toHaveBeenCalledTimes(1);
    const [patchArg, replacePaths] = configPatch.mock.calls[0];
    expect(replacePaths).toEqual(["agents.list"]);
    expect(patchArg.agents.list).toHaveLength(1);
    expect(patchArg.agents.list[0]).toMatchObject({
      id: openclawAgentId("a1"),
      identity: { name: "Bot" },
      systemPrompt: "Prompt del agente",
      channels: { telegram: { managedBy: "agents-agency", mode: "aa-webhook" } },
      params: { temperature: 0.4 },
    });
    // Sin workspace fantasma: "aa-<id>" relativo nunca se desplegó (hardening).
    expect(patchArg.agents.list[0].workspace).toBeUndefined();
  });

  it("agente ya provisionado: actualiza la entrada existente sin duplicarla ni tocar otras", async () => {
    configGet.mockResolvedValue({
      ok: true,
      payload: {
        config: {
          agents: {
            list: [
              { id: "aa-other", identity: { name: "Otro bot" } },
              { id: openclawAgentId("a1"), identity: { name: "Nombre viejo" }, workspace: openclawAgentId("a1") },
            ],
          },
        },
      },
    });
    configPatch.mockResolvedValue({ ok: true, payload: {} });

    await syncAgentProvisioning({ id: "a1", name: "Nombre nuevo", runtime: "openclaw" });

    const [patchArg] = configPatch.mock.calls[0];
    expect(patchArg.agents.list).toHaveLength(2);
    expect(patchArg.agents.list.find((a: any) => a.id === "aa-other")).toMatchObject({ identity: { name: "Otro bot" } });
    expect(patchArg.agents.list.find((a: any) => a.id === openclawAgentId("a1"))).toMatchObject({
      identity: { name: "Nombre nuevo" },
    });
  });

  it("config.get falla → status error, no llama a config.patch", async () => {
    configGet.mockResolvedValue({ ok: false, error: "gateway down" });

    const result = await syncAgentProvisioning({ id: "a1", name: "Bot", runtime: "openclaw" });

    expect(result).toEqual({ ok: false, status: "error", reason: "gateway down" });
    expect(configPatch).not.toHaveBeenCalled();
  });

  it("config.patch falla → status error", async () => {
    configGet.mockResolvedValue({ ok: true, payload: { config: { agents: { list: [] } } } });
    configPatch.mockResolvedValue({ ok: false, error: "patch rejected" });

    const result = await syncAgentProvisioning({ id: "a1", name: "Bot", runtime: "openclaw" });

    expect(result).toEqual({ ok: false, status: "error", reason: "patch rejected" });
  });
});

describe("syncAgentProvisioning — sonda en vivo (/v1/models)", () => {
  beforeEach(() => {
    configGet.mockResolvedValue({
      ok: true,
      payload: { config: { agents: { list: [{ id: openclawAgentId("a1") }] } } },
    });
    configPatch.mockResolvedValue({ ok: true, payload: {} });
  });

  it("el gateway ya sirve el target → provisioned y SIN pendingRestart", async () => {
    listModels.mockResolvedValue({
      ok: true,
      payload: { data: [{ id: "openclaw/main" }, { id: `openclaw/${openclawAgentId("a1")}` }] },
    });

    const result = await syncAgentProvisioning({ id: "a1", name: "Bot", runtime: "openclaw" });

    expect(result.provisionState).toBe("provisioned");
    expect(result.pendingRestart).toBe(false);
  });

  it("en config pero el gateway aún no lo sirve → pending con pendingRestart", async () => {
    listModels.mockResolvedValue({ ok: true, payload: { data: [{ id: "openclaw/main" }] } });

    const result = await syncAgentProvisioning({ id: "a1", name: "Bot", runtime: "openclaw" });

    expect(result.provisionState).toBe("pending");
    expect(result.pendingRestart).toBe(true);
    expect(result.reason).toMatch(/restart/i);
  });
});

describe("reconcileAgentsProvisioning — reconciliación BD ↔ OpenClaw", () => {
  it("re-aprovisiona faltantes, retira huérfanos aa-* y respeta entradas del sistema", async () => {
    configGet.mockResolvedValue({
      ok: true,
      payload: {
        config: {
          agents: {
            list: [
              { id: "main", default: true },
              { id: "aa-orphan", identity: { name: "Borrado en BD" } },
              { id: openclawAgentId("a1"), identity: { name: "Nombre viejo" }, workspace: openclawAgentId("a1") },
            ],
          },
        },
      },
    });
    configPatch.mockResolvedValue({ ok: true, payload: {} });
    listModels.mockResolvedValue({
      ok: true,
      payload: { data: [{ id: `openclaw/${openclawAgentId("a1")}` }] },
    });

    const result = await reconcileAgentsProvisioning([
      { id: "a1", name: "Nombre nuevo", runtime: "openclaw" },
      { id: "a2", name: "Bot nuevo", runtime: "openclaw", systemPrompt: "Prompt" },
      { id: "a3", name: "Bot cloud", runtime: "openai" }, // no-openclaw → fuera del scope
    ]);

    expect(result.ok).toBe(true);
    expect(result.removedOrphans).toEqual(["aa-orphan"]);

    const [patchArg, replacePaths] = configPatch.mock.calls[0];
    expect(replacePaths).toEqual(["agents.list"]);
    const ids = patchArg.agents.list.map((a: any) => a.id);
    expect(ids).toEqual(["main", openclawAgentId("a1"), openclawAgentId("a2")]);
    const a1Entry = patchArg.agents.list.find((a: any) => a.id === openclawAgentId("a1"));
    expect(a1Entry.identity).toEqual({ name: "Nombre nuevo" });
    expect(a1Entry.workspace).toBeUndefined(); // limpieza del workspace fantasma legado

    // Estados: a1 lo sirve ya el gateway; a2 espera restart.
    expect(result.states).toEqual([
      { agentId: "a1", provisionState: "provisioned" },
      expect.objectContaining({ agentId: "a2", provisionState: "pending" }),
    ]);
  });

  it("lista ya reconciliada → NO llama a config.patch (idempotente)", async () => {
    const entry = {
      id: openclawAgentId("a1"),
      identity: { name: "Bot" },
      channels: { telegram: { managedBy: "agents-agency", mode: "aa-webhook" } },
    };
    configGet.mockResolvedValue({
      ok: true,
      payload: { config: { agents: { list: [{ id: "main" }, entry] } } },
    });
    listModels.mockResolvedValue({ ok: true, payload: { data: [] } });

    const result = await reconcileAgentsProvisioning([{ id: "a1", name: "Bot", runtime: "openclaw" }]);

    expect(result.ok).toBe(true);
    expect(configPatch).not.toHaveBeenCalled();
  });

  it("config.get falla → ok:false y no toca nada", async () => {
    configGet.mockResolvedValue({ ok: false, error: "gateway down" });

    const result = await reconcileAgentsProvisioning([{ id: "a1", name: "Bot", runtime: "openclaw" }]);

    expect(result).toMatchObject({ ok: false, reason: "gateway down" });
    expect(configPatch).not.toHaveBeenCalled();
  });
});

describe("syncAgentProvisioning — remove (delete de agente / cambio de runtime)", () => {
  it("elimina la entrada existente y hace patch con la lista sin ella", async () => {
    configGet.mockResolvedValue({
      ok: true,
      payload: { config: { agents: { list: [{ id: openclawAgentId("a1") }, { id: "aa-other" }] } } },
    });
    configPatch.mockResolvedValue({ ok: true, payload: {} });

    const result = await syncAgentProvisioning({ id: "a1", name: "Bot", runtime: "openclaw" }, { remove: true });

    expect(result.status).toBe("removed");
    const [patchArg] = configPatch.mock.calls[0];
    expect(patchArg.agents.list).toEqual([{ id: "aa-other" }]);
  });

  it("entrada inexistente → skipped, no llama a config.patch", async () => {
    configGet.mockResolvedValue({ ok: true, payload: { config: { agents: { list: [] } } } });

    const result = await syncAgentProvisioning({ id: "a1", name: "Bot", runtime: "openclaw" }, { remove: true });

    expect(result).toEqual({ ok: true, status: "skipped", reason: "not provisioned" });
    expect(configPatch).not.toHaveBeenCalled();
  });
});

// -- provisionTelegramChannel (retired handover after aa-centro-mando 5.4a/6.3) --

describe("provisionTelegramChannel -- retired global-token handover", () => {
  const validKey = "d".repeat(64);

  beforeEach(() => {
    process.env.CHANNEL_ENCRYPTION_KEY = validKey;
  });

  afterEach(() => {
    delete process.env.CHANNEL_ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  it("does not decrypt or patch the global OpenClaw channels.telegram.botToken", async () => {
    const result = await provisionTelegramChannel({
      agentId: "a1",
      encryptedCredentials: { iv: "00", authTag: "00", data: "00" },
    });

    expect(result).toEqual({
      ok: true,
      status: "skipped",
      reason: "Telegram is managed per agent by Agents Agency webhooks; no OpenClaw global bot token handover",
    });
    expect(configPatch).not.toHaveBeenCalled();
  });

  it("never logs or sends the plaintext token on the retired path", async () => {
    const { logger } = await import("@/lib/logger");
    const warnSpy = vi.spyOn(logger, "warn");
    const errorSpy = vi.spyOn(logger, "error");
    const secretToken = "999999:SUPER-SECRETO-token-value";

    const { encrypt } = await import("@/lib/crypto");
    const encrypted = encrypt(JSON.stringify({ token: secretToken }));

    await provisionTelegramChannel({ agentId: "a1", encryptedCredentials: encrypted });

    expect(configPatch).not.toHaveBeenCalled();
    const allLoggedArgs = [...warnSpy.mock.calls, ...errorSpy.mock.calls].flat();
    for (const arg of allLoggedArgs) {
      const serialized = typeof arg === "string" ? arg : JSON.stringify(arg);
      expect(serialized).not.toContain(secretToken);
    }
  });
});
