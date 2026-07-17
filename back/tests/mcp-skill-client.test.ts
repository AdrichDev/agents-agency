/**
 * aa-agent-skills-install-execute — Nivel 2 / F2b (tools externas MCP).
 * Cubre:
 *  - T6.1: schema `Skill.mcpUrl`/`mcpTransport` + `AgentSkill.secretEncrypted` y
 *          migración ADITIVA (asserts estáticos, sin BD real).
 *  - T6.3: cliente MCP con transporte FAKE inyectado — allowlist (fail-closed),
 *          timeout duro, kill switch OFF (degrada/fail-soft), cache TTL.
 *  - T6.4: namespacing `skill__<skillId>__<tool>` + router de prefijo del executor
 *          con secreto per-agente descifrado + aislamiento + fail-soft server caído.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── Mocks (executor: solo lo que necesita el router MCP) ────────────────────
vi.mock("@/lib/db", () => ({
  prisma: {
    agentSkill: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));
vi.mock("@/lib/agent/order-status", () => ({ fetchOrderStatus: vi.fn() }));
vi.mock("@/lib/agent-backend/managed-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-backend/managed-db")>();
  return { ...actual, resolveAgentBackendAdapter: vi.fn() };
});
vi.mock("@/lib/agent-backend/notify-dispatcher", () => ({ dispatchNotification: vi.fn() }));
// El secreto per-agente se descifra en el executor: mock determinista (no depende
// de la clave de cifrado real) — marca el plaintext para verificar el passthrough.
vi.mock("@/lib/integrations/oauth", () => ({
  getValidToken: vi.fn(),
  decryptToken: vi.fn((s: string) => `PLAIN(${s})`),
}));

import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/integrations/oauth";
import { executeTool } from "@/lib/agent/executor";
import {
  listSkillMcpTools,
  callSkillMcpTool,
  isHostAllowed,
  mcpSkillsEnabled,
  allowedHosts,
  skillMcpToolName,
  parseSkillMcpToolName,
  __setMcpTransport,
  __resetMcpClient,
  type McpTransport,
} from "@/lib/mcp/client";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const HOST = "mcp.example.com";
const URL_OK = `https://${HOST}/rpc`;

// ── Gestión de env (kill switch / allowlist / timeout) ──────────────────────
const ENV_KEYS = ["MCP_SKILLS_ENABLED", "MCP_SKILL_ALLOWED_HOSTS", "MCP_SKILL_TIMEOUT_MS"] as const;
let envBackup: Record<string, string | undefined>;

beforeEach(() => {
  envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // Estado por defecto de cada test: capa ENCENDIDA + host permitido. Los tests
  // de kill switch / allowlist sobreescriben explícitamente.
  process.env.MCP_SKILLS_ENABLED = "true";
  process.env.MCP_SKILL_ALLOWED_HOSTS = HOST;
  delete process.env.MCP_SKILL_TIMEOUT_MS;
  vi.clearAllMocks();
  __resetMcpClient();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
  __resetMcpClient();
});

/** Transporte fake configurable (T6.3): no golpea red real. */
function fakeTransport(overrides: Partial<McpTransport> = {}): McpTransport {
  return {
    listTools: vi.fn(async () => [{ name: "do_thing", description: "hace algo" }]),
    callTool: vi.fn(async (_s, toolName, args, secret) => ({ ok: true, toolName, args, secret })),
    ...overrides,
  };
}

// ── Config / env helpers ─────────────────────────────────────────────────────
describe("config y kill switch (T6.3)", () => {
  it("kill switch OFF por defecto: solo 'true'/'1' activan la capa", () => {
    process.env.MCP_SKILLS_ENABLED = "";
    expect(mcpSkillsEnabled()).toBe(false);
    process.env.MCP_SKILLS_ENABLED = "false";
    expect(mcpSkillsEnabled()).toBe(false);
    process.env.MCP_SKILLS_ENABLED = "true";
    expect(mcpSkillsEnabled()).toBe(true);
    process.env.MCP_SKILLS_ENABLED = "1";
    expect(mcpSkillsEnabled()).toBe(true);
  });

  it("allowlist vacía → fail-closed (nada pasa)", () => {
    process.env.MCP_SKILL_ALLOWED_HOSTS = "";
    expect(allowedHosts()).toEqual([]);
    expect(isHostAllowed(URL_OK)).toBe(false);
  });

  it("isHostAllowed: host exacto en allowlist → true; ajeno o URL inválida → false", () => {
    expect(isHostAllowed(URL_OK)).toBe(true);
    expect(isHostAllowed("https://evil.com/rpc")).toBe(false);
    expect(isHostAllowed("no-es-una-url")).toBe(false);
    // Sin comodines: un subdominio NO permitido no pasa.
    expect(isHostAllowed(`https://sub.${HOST}/rpc`)).toBe(false);
  });
});

// ── listSkillMcpTools ─────────────────────────────────────────────────────────
describe("listSkillMcpTools (T6.3)", () => {
  it("kill switch OFF → [] sin tocar el transporte (degrada a baseline)", async () => {
    process.env.MCP_SKILLS_ENABLED = "false";
    const t = fakeTransport();
    __setMcpTransport(t);
    expect(await listSkillMcpTools({ url: URL_OK })).toEqual([]);
    expect(t.listTools).not.toHaveBeenCalled();
  });

  it("host fuera de allowlist → [] sin tocar el transporte (anti-SSRF)", async () => {
    const t = fakeTransport();
    __setMcpTransport(t);
    expect(await listSkillMcpTools({ url: "https://evil.com/rpc" })).toEqual([]);
    expect(t.listTools).not.toHaveBeenCalled();
  });

  it("happy path: lista las tools del servidor permitido", async () => {
    __setMcpTransport(fakeTransport());
    const tools = await listSkillMcpTools({ url: URL_OK });
    expect(tools.map((t) => t.name)).toEqual(["do_thing"]);
  });

  it("cache TTL: dos llamadas al mismo url → un solo round-trip al transporte", async () => {
    const t = fakeTransport();
    __setMcpTransport(t);
    const a = await listSkillMcpTools({ url: URL_OK });
    const b = await listSkillMcpTools({ url: URL_OK });
    expect(a).toEqual(b);
    expect(asMock(t.listTools)).toHaveBeenCalledTimes(1);
  });

  it("timeout duro: transporte que nunca resuelve → [] (fail-soft, no cuelga)", async () => {
    process.env.MCP_SKILL_TIMEOUT_MS = "15";
    __setMcpTransport(fakeTransport({ listTools: vi.fn(() => new Promise<never>(() => {})) }));
    expect(await listSkillMcpTools({ url: URL_OK })).toEqual([]);
  });

  it("error de red del transporte → [] (fail-soft, nunca lanza)", async () => {
    __setMcpTransport(fakeTransport({ listTools: vi.fn(async () => { throw new Error("ECONNREFUSED"); }) }));
    expect(await listSkillMcpTools({ url: URL_OK })).toEqual([]);
  });
});

// ── callSkillMcpTool ──────────────────────────────────────────────────────────
describe("callSkillMcpTool (T6.3)", () => {
  it("kill switch OFF → { error } honesto (no invoca)", async () => {
    process.env.MCP_SKILLS_ENABLED = "false";
    const t = fakeTransport();
    __setMcpTransport(t);
    const res = (await callSkillMcpTool({ server: { url: URL_OK }, toolName: "do_thing", args: {} })) as any;
    expect(res.error).toBeTruthy();
    expect(t.callTool).not.toHaveBeenCalled();
  });

  it("host fuera de allowlist → { error } (no invoca)", async () => {
    const t = fakeTransport();
    __setMcpTransport(t);
    const res = (await callSkillMcpTool({ server: { url: "https://evil.com" }, toolName: "x", args: {} })) as any;
    expect(res.error).toMatch(/hosts permitidos/i);
    expect(t.callTool).not.toHaveBeenCalled();
  });

  it("happy path: pasa el secreto per-agente descifrado al transporte", async () => {
    const t = fakeTransport();
    __setMcpTransport(t);
    const res = (await callSkillMcpTool({
      server: { url: URL_OK },
      toolName: "do_thing",
      args: { a: 1 },
      secret: "SECRETO_DESCIFRADO",
    })) as any;
    expect(res).toEqual({ ok: true, toolName: "do_thing", args: { a: 1 }, secret: "SECRETO_DESCIFRADO" });
    expect(asMock(t.callTool).mock.calls[0][3]).toBe("SECRETO_DESCIFRADO");
  });

  it("servidor caído → { error } fail-soft (nunca lanza al loop)", async () => {
    __setMcpTransport(fakeTransport({ callTool: vi.fn(async () => { throw new Error("boom"); }) }));
    const res = (await callSkillMcpTool({ server: { url: URL_OK }, toolName: "do_thing", args: {} })) as any;
    expect(res.error).toMatch(/no está disponible/i);
  });
});

// ── Namespacing (T6.4) ────────────────────────────────────────────────────────
describe("namespacing skill__<skillId>__<tool> (T6.4)", () => {
  it("skillMcpToolName + parse round-trip", () => {
    const name = skillMcpToolName("ckskill123", "do_thing");
    expect(name).toBe("skill__ckskill123__do_thing");
    expect(parseSkillMcpToolName(name)).toEqual({ skillId: "ckskill123", toolName: "do_thing" });
  });

  it("nombres sin prefijo o mal formados → null", () => {
    expect(parseSkillMcpToolName("send_email")).toBeNull(); // tool de integración, no colisiona
    expect(parseSkillMcpToolName("skill__")).toBeNull();
    expect(parseSkillMcpToolName("skill__soloskill")).toBeNull();
    expect(parseSkillMcpToolName("skill__x__")).toBeNull();
  });
});

// ── Router de prefijo del executor (T6.4) ──────────────────────────────────────
describe("executeTool router skill__ (T6.4)", () => {
  it("descifra el secreto per-agente de ESTE agente y llama a la tool MCP", async () => {
    asMock(prisma.agentSkill.findUnique).mockResolvedValue({
      secretEncrypted: "enc:v1:XYZ",
      skill: { mcpUrl: URL_OK, mcpTransport: "http" },
    });
    const t = fakeTransport();
    __setMcpTransport(t);

    const res = (await executeTool("ag-1", "skill__sk-1__do_thing", { q: 1 })) as any;

    // La fila se busca por clave compuesta agentId+skillId (aislamiento).
    expect(asMock(prisma.agentSkill.findUnique).mock.calls[0][0].where).toEqual({
      agentId_skillId: { agentId: "ag-1", skillId: "sk-1" },
    });
    // decryptToken se llamó con el secreto almacenado; el transporte recibió el plaintext.
    expect(decryptToken).toHaveBeenCalledWith("enc:v1:XYZ");
    expect(res).toEqual({ ok: true, toolName: "do_thing", args: { q: 1 }, secret: "PLAIN(enc:v1:XYZ)" });
  });

  it("AISLAMIENTO: skill no instalada en el agente → error honesto, sin descifrar ni invocar", async () => {
    asMock(prisma.agentSkill.findUnique).mockResolvedValue(null);
    const t = fakeTransport();
    __setMcpTransport(t);

    const res = (await executeTool("ag-1", "skill__sk-otro__do_thing", {})) as any;
    expect(res.error).toMatch(/no está instalada/i);
    expect(decryptToken).not.toHaveBeenCalled();
    expect(t.callTool).not.toHaveBeenCalled();
  });

  it("secreto ausente (MCP pendiente): invoca sin Authorization", async () => {
    asMock(prisma.agentSkill.findUnique).mockResolvedValue({
      secretEncrypted: null,
      skill: { mcpUrl: URL_OK, mcpTransport: "http" },
    });
    const t = fakeTransport();
    __setMcpTransport(t);

    const res = (await executeTool("ag-1", "skill__sk-1__do_thing", {})) as any;
    expect(decryptToken).not.toHaveBeenCalled();
    expect(res.secret).toBeUndefined();
  });

  it("fail-soft: servidor MCP caído → { error }, nunca rompe el loop", async () => {
    asMock(prisma.agentSkill.findUnique).mockResolvedValue({
      secretEncrypted: "enc:v1:XYZ",
      skill: { mcpUrl: URL_OK, mcpTransport: "http" },
    });
    __setMcpTransport(fakeTransport({ callTool: vi.fn(async () => { throw new Error("down"); }) }));

    const res = (await executeTool("ag-1", "skill__sk-1__do_thing", {})) as any;
    expect(res.error).toBeTruthy();
  });

  it("tool no-MCP desconocida sigue lanzando 'Tool desconocida' (router no la traga)", async () => {
    await expect(executeTool("ag-1", "tool_inexistente", {})).rejects.toThrow(/Tool desconocida/);
  });
});

// ── T6.1: schema + migración (asserts estáticos, sin BD) ─────────────────────
const SCHEMA = readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf-8");
const MIGRATION = readFileSync(
  path.join(__dirname, "..", "prisma", "migrations", "20260716160000_skill_mcp", "migration.sql"),
  "utf-8"
);

describe("schema MCP (T6.1)", () => {
  it("Skill añade mcpUrl/mcpTransport con @map castellano", () => {
    const model = SCHEMA.match(/model Skill \{[\s\S]*?\n\}/)?.[0];
    expect(model).toMatch(/mcpUrl\s+String\?\s+@map\("mcp_url"\)/);
    expect(model).toMatch(/mcpTransport\s+String\?\s+@map\("mcp_transport"\)/);
  });

  it("AgentSkill añade secretEncrypted con @map castellano", () => {
    const model = SCHEMA.match(/model AgentSkill \{[\s\S]*?\n\}/)?.[0];
    expect(model).toMatch(/secretEncrypted\s+String\?\s+@map\("secreto_cifrado"\)/);
  });
});

describe("migración 20260716160000_skill_mcp (T6.1)", () => {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, "");

  it("es ADITIVA: solo ADD COLUMN, sin DROP/DELETE/UPDATE/TRUNCATE", () => {
    expect(sql).toMatch(/ALTER TABLE "skill" ADD COLUMN "mcp_url" TEXT/);
    expect(sql).toMatch(/ALTER TABLE "skill" ADD COLUMN "mcp_transport" TEXT/);
    expect(sql).toMatch(/ALTER TABLE "agente_skill" ADD COLUMN "secreto_cifrado" TEXT/);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\b/im);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });
});
