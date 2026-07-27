/**
 * H7 (aa-cupo-defecto-y-avisos, T4.1) — El aviso viaja con el cupo, no se recalcula en el panel.
 *
 * `quotaWarningLevel` ya está probada como función pura en `cupo-avisos-umbrales.test.ts`. Lo que se
 * prueba aquí es lo otro: que la ruta la aplique al consumo DEL PERIODO (no al acumulado de por vida)
 * y que en `byok` no mande nivel ninguno. Un porcentaje calculado contra un tope que el gate no mira
 * mandaría al operador a recargar tokens a quien paga su propio LLM.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findMany: vi.fn(), findUnique: vi.fn() },
    agent: { groupBy: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("@/lib/codes", () => ({ nextClientCode: vi.fn(), withCodeRetry: vi.fn() }));

import { prisma } from "@/lib/db";
import { clientsRouter } from "@/routes/clients";
import { DEFAULT_TOKEN_QUOTA_PER_AGENT } from "@/lib/quota";

const mockFindMany = prisma.tenant.findMany as ReturnType<typeof vi.fn>;
const mockGroupBy = prisma.agent.groupBy as ReturnType<typeof vi.fn>;

/** Fila mínima tal y como la devuelve el `include` de la ruta. */
function fila(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    name: "Cliente",
    tokenBalance: null,
    tokensUsed: 9_999_999_999, // acumulado de por vida, deliberadamente enorme
    tokensUsedPeriod: 0,
    credentialMode: "platform",
    isActive: true,
    plan: null,
    _count: { budgets: 0, agents: 1 },
    ...over,
  };
}

function get(path: string): Promise<{ status: number; body: any }> {
  const app = express();
  app.use(express.json());
  app.use("/api/clients", clientsRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      http
        .request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null });
          });
        })
        .on("error", (e) => {
          server.close();
          reject(e);
        })
        .end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGroupBy.mockResolvedValue([{ tenantId: "t1", _count: { _all: 1 } }]);
});

describe("T4.1 — GET /clients expone cupo, origen y aviso coherentes", () => {
  it("cliente nuevo sin consumo: cupo por defecto, origen 'default' y aviso 'ok'", async () => {
    mockFindMany.mockResolvedValue([fila()]);

    const { status, body } = await get("/api/clients");

    expect(status).toBe(200);
    expect(body[0].tokenQuota).toBe(DEFAULT_TOKEN_QUOTA_PER_AGENT);
    expect(body[0].quotaSource).toBe("default");
    expect(body[0].quotaWarning).toBe("ok");
    expect(body[0].billableAgents).toBe(1);
  });

  it("al 75% del cupo por defecto avisa 'warn75'", async () => {
    mockFindMany.mockResolvedValue([
      fila({ tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT * 0.75 }),
    ]);

    const { body } = await get("/api/clients");

    expect(body[0].quotaWarning).toBe("warn75");
  });

  it("al 90% avisa 'warn90'", async () => {
    mockFindMany.mockResolvedValue([
      fila({ tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT * 0.9 }),
    ]);

    const { body } = await get("/api/clients");

    expect(body[0].quotaWarning).toBe("warn90");
  });

  it("cupo agotado: 'exhausted', el mismo punto en el que corta el gate", async () => {
    mockFindMany.mockResolvedValue([
      fila({ tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT }),
    ]);

    const { body } = await get("/api/clients");

    expect(body[0].quotaWarning).toBe("exhausted");
  });

  it("el aviso se calcula con el consumo DEL PERIODO, no con el acumulado de por vida", async () => {
    // `tokensUsed` de la fila es 9.999.999.999. Si el aviso lo mirara, saldría 'exhausted'.
    mockFindMany.mockResolvedValue([fila({ tokensUsedPeriod: 0 })]);

    const { body } = await get("/api/clients");

    expect(body[0].quotaWarning).toBe("ok");
  });

  it("byok: sin aviso (`null`), aunque el periodo venga consumido de cuando era 'platform'", async () => {
    mockFindMany.mockResolvedValue([
      fila({
        credentialMode: "byok",
        tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT * 0.95,
      }),
    ]);

    const { body } = await get("/api/clients");

    expect(body[0].quotaWarning).toBeNull();
  });

  it("override del tenant: el aviso se mide contra el override, y el origen lo dice", async () => {
    mockFindMany.mockResolvedValue([
      fila({ tokenBalance: 1_000, tokensUsedPeriod: 900 }),
    ]);

    const { body } = await get("/api/clients");

    expect(body[0].tokenQuota).toBe(1_000);
    expect(body[0].quotaSource).toBe("override");
    expect(body[0].quotaWarning).toBe("warn90");
  });

  it("freno de mano (`tokenBalance = 0`): cupo 0 y 'exhausted', no cupo por defecto", async () => {
    mockFindMany.mockResolvedValue([fila({ tokenBalance: 0 })]);

    const { body } = await get("/api/clients");

    expect(body[0].tokenQuota).toBe(0);
    expect(body[0].quotaSource).toBe("override");
    expect(body[0].quotaWarning).toBe("exhausted");
  });

  it("plan sin tope: cupo `null` y aviso 'ok' — la pregunta no aplica", async () => {
    mockFindMany.mockResolvedValue([
      fila({
        plan: { id: "p1", codigo: "ilimitado", nombre: "Ilimitado", tokenQuotaPerAgent: null },
        tokensUsedPeriod: 50_000_000,
      }),
    ]);

    const { body } = await get("/api/clients");

    expect(body[0].tokenQuota).toBeNull();
    expect(body[0].quotaWarning).toBe("ok");
  });
});
