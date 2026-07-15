/**
 * T1 — aa-agent-backend-foundation Fase 1 (AC1).
 * Cubre: (1) el modelo `AgentDataBackend` existe en el schema con el contrato
 * de design.md §B.3; (2) la migración es ADITIVA (sin DROP ni cambios
 * destructivos) y backfillea desde `agente` infiriendo la capacidad "pedidos"
 * de `config_ecommerce.orderStatusUrl`; (3) retrocompat: `get_order_status`
 * sigue resolviendo contra `ecommerceConfig.orderStatusUrl` (path legado
 * intacto, T1.3).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── Mocks para aislar el executor (patrón de engine.test.ts) ────────────────
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUniqueOrThrow: vi.fn() },
    integration: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));
vi.mock("@/lib/agent/order-status", () => ({
  fetchOrderStatus: vi.fn(async () => ({ ok: true, raw: { status: "enviado" } })),
}));

import { prisma } from "@/lib/db";
import { fetchOrderStatus } from "@/lib/agent/order-status";
import { executeTool } from "@/lib/agent/executor";

const mockAgent = prisma.agent.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockFetchOrder = fetchOrderStatus as ReturnType<typeof vi.fn>;

const SCHEMA = readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf-8");
const MIGRATION = readFileSync(
  path.join(__dirname, "..", "prisma", "migrations", "20260716000000_agent_data_backend", "migration.sql"),
  "utf-8"
);

// ── T1.1: el modelo existe con el contrato de design.md §B.3 ────────────────
describe("schema: modelo AgentDataBackend", () => {
  const model = SCHEMA.match(/model AgentDataBackend \{[\s\S]*?\n\}/)?.[0];

  it("existe y es 1:1 con Agent (agentId @unique, cascade)", () => {
    expect(model).toBeTruthy();
    expect(model).toMatch(/agentId\s+String\s+@unique/);
    expect(model).toMatch(/onDelete: Cascade/);
    // Relación inversa declarada en Agent
    expect(SCHEMA).toMatch(/dataBackend\s+AgentDataBackend\?/);
  });

  it("declara mode con default none_yet y los campos del contrato B.3", () => {
    expect(model).toMatch(/mode\s+String\s+@default\("none_yet"\)/);
    expect(model).toMatch(/dbUrlEncrypted\s+String\?/);
    expect(model).toMatch(/dbSchema\s+Json\s+@default\("\{\}"\)/);
    expect(model).toMatch(/capabilities\s+Json\s+@default\("\[\]"\)/);
    expect(model).toMatch(/notificationConfig\s+Json\s+@default\("\{\}"\)/);
    // forward-compat external_api (declarados, NO cableados en v1)
    expect(model).toMatch(/apiBaseUrl\s+String\?/);
    expect(model).toMatch(/apiKeyEncrypted\s+String\?/);
    // Convención castellano snake_case del repo
    expect(model).toMatch(/@@map\("backend_datos_agente"\)/);
  });
});

// ── T1.2: migración aditiva + backfill ──────────────────────────────────────
describe("migración 20260716000000_agent_data_backend", () => {
  // Sin comentarios SQL: los asserts destructivos deben mirar solo statements.
  const sql = MIGRATION.replace(/^\s*--.*$/gm, "");

  it("crea la tabla nueva con unique + FK a agente", () => {
    expect(sql).toMatch(/CREATE TABLE "backend_datos_agente"/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "backend_datos_agente_agente_id_key"/);
    expect(sql).toMatch(/REFERENCES "agente"\("id"\) ON DELETE CASCADE/);
  });

  it("es ADITIVA: sin DROP, sin ALTER de tablas existentes, sin UPDATE/DELETE", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    // UPDATE como statement (el "ON UPDATE CASCADE" de la FK no muta datos)
    expect(sql).not.toMatch(/^\s*UPDATE\b/im);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    // El único ALTER permitido es sobre la tabla NUEVA (su FK)
    const alters = sql.match(/ALTER TABLE\s+"([^"]+)"/gi) ?? [];
    for (const a of alters) expect(a).toContain('"backend_datos_agente"');
  });

  it("backfillea una fila por agente con modo none_yet e infiere 'pedidos' de orderStatusUrl", () => {
    expect(sql).toMatch(/INSERT INTO "backend_datos_agente"/);
    expect(sql).toMatch(/FROM "agente"/);
    expect(sql).toMatch(/'none_yet'/);
    expect(sql).toMatch(/config_ecommerce"->>'orderStatusUrl'/);
    expect(sql).toMatch(/'\["pedidos"\]'::jsonb/);
    // Idempotente: re-aplicar no duplica ni pisa filas
    expect(sql).toMatch(/ON CONFLICT \("agente_id"\) DO NOTHING/);
  });
});

// ── T1.3: retrocompat get_order_status (path legado intacto) ────────────────
describe("retrocompat get_order_status", () => {
  beforeEach(() => {
    mockAgent.mockReset();
    mockFetchOrder.mockClear();
  });

  it("agente en prod con orderStatusUrl sigue consultando pedidos vía ecommerceConfig", async () => {
    mockAgent.mockResolvedValue({
      ecommerceConfig: { orderStatusUrl: "https://tienda.example.com/api/orders" },
    });

    const res = await executeTool("agent-legacy", "get_order_status", { orderId: "P-123" });

    expect(mockFetchOrder).toHaveBeenCalledWith(
      { url: "https://tienda.example.com/api/orders", apiKey: undefined },
      "P-123"
    );
    expect(res).toEqual({ ok: true, raw: { status: "enviado" } });
  });

  it("sin orderStatusUrl responde 'no configurado' sin llamar al endpoint (R5-4)", async () => {
    mockAgent.mockResolvedValue({ ecommerceConfig: {} });

    const res = (await executeTool("agent-x", "get_order_status", { orderId: "P-1" })) as {
      configured: boolean;
    };

    expect(res.configured).toBe(false);
    expect(mockFetchOrder).not.toHaveBeenCalled();
  });
});
