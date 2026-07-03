/**
 * service-operator.test.ts — F1-T1 (openspec/changes/aa-operator-agent).
 *
 * Cubre el router /service/operator: auth por service token (x-service-token),
 * protocolo de confirmación (confirmado:true → si no, 409), y las escrituras
 * (alta tenant, conversión de lead) con su auditoría fire-and-forget.
 *
 * Patrón del repo: mock de prisma / servicios vía vi.mock (hoisted), handlers
 * importados y llamados con req/res simulados (ver channels-openclaw-handover).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks (hoisted por vitest — sin referencias a variables externas) ──────────
vi.mock("@/lib/db", () => {
  const prismaMock: any = {
    tenant: { create: vi.fn(), count: vi.fn() },
    agent: { groupBy: vi.fn() },
    lead: { findUnique: vi.fn(), count: vi.fn(), update: vi.fn() },
  };
  // $transaction ejecuta el callback pasándole el propio mock como tx.
  prismaMock.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/lib/codes", () => ({
  nextClientCode: vi.fn().mockResolvedValue("cli-05"),
  withCodeRetry: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock("@/lib/agent/service", () => ({ createAgent: vi.fn() }));
vi.mock("@/lib/operator-audit", () => ({ writeOperatorAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { createAgent } from "@/lib/agent/service";
import { writeOperatorAudit } from "@/lib/operator-audit";
import { requireOperatorToken } from "@/lib/operator-token";
import {
  estadoHandler,
  crearClienteHandler,
  convertirLeadHandler,
  crearAgenteHandler,
} from "@/routes/service-operator";

const TOKEN = "operator-secret-token-123";

// Helpers de req/res simulados.
function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = vi.fn((b: any) => {
    res.body = b;
    return res;
  });
  return res;
}

function mockReq({
  body = {},
  params = {},
  headers = {},
}: { body?: any; params?: any; headers?: Record<string, string> } = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    body,
    params,
    header: (name: string) => lower[name.toLowerCase()],
  } as any;
}

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_1", codigo: "cli-05", name: "Peluquería Sol" });
});

// ── Middleware: service token ─────────────────────────────────────────────────
describe("requireOperatorToken", () => {
  const mw = requireOperatorToken(TOKEN);

  it("401 sin header x-service-token", () => {
    const res = mockRes();
    const next = vi.fn();
    mw(mockReq(), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401 con token incorrecto", () => {
    const res = mockRes();
    const next = vi.fn();
    mw(mockReq({ headers: { "x-service-token": "wrong" } }), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401 si OPERATOR_SERVICE_TOKEN no está configurado (fail-closed)", () => {
    const res = mockRes();
    const next = vi.fn();
    requireOperatorToken("")(mockReq({ headers: { "x-service-token": "" } }), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("continúa con token correcto", () => {
    const res = mockRes();
    const next = vi.fn();
    mw(mockReq({ headers: { "x-service-token": TOKEN } }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ── GET /estado ───────────────────────────────────────────────────────────────
describe("GET /estado", () => {
  it("devuelve tenants activos, agentes por runtime y leads pendientes", async () => {
    asMock(prisma.tenant.count).mockResolvedValue(7);
    asMock(prisma.agent.groupBy).mockResolvedValue([
      { runtime: "openai", _count: { _all: 3 } },
      { runtime: "openclaw", _count: { _all: 1 } },
    ]);
    asMock(prisma.lead.count).mockResolvedValue(2);
    const res = mockRes();

    await estadoHandler(mockReq(), res);

    expect(res.body).toEqual({
      tenantsActivos: 7,
      agentes: [
        { runtime: "openai", total: 3 },
        { runtime: "openclaw", total: 1 },
      ],
      leadsPendientes: 2,
    });
  });
});

// ── POST /clientes ────────────────────────────────────────────────────────────
describe("POST /clientes", () => {
  it("409 confirmation_required sin confirmado, y NO crea nada", async () => {
    const res = mockRes();
    await crearClienteHandler(mockReq({ body: { nombre: "Peluquería Sol" } }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: { code: "confirmation_required" } });
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resultado: "error", detalle: "confirmation_required" })
    );
  });

  it("crea el tenant con confirmado y deja auditoría ok", async () => {
    const res = mockRes();
    await crearClienteHandler(
      mockReq({ body: { nombre: "Peluquería Sol", confirmado: true } }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: "ten_1", codigo: "cli-05", name: "Peluquería Sol" });
    expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_crear_cliente", resultado: "ok", detalle: "ten_1" })
    );
  });
});

// ── POST /leads/:id/convertir ─────────────────────────────────────────────────
describe("POST /leads/:id/convertir", () => {
  it("convierte un lead existente en tenant y lo marca converted", async () => {
    asMock(prisma.lead.findUnique).mockResolvedValue({
      id: "lead_1",
      customerName: "Peluquería Sol",
      email: "sol@ejemplo.com",
      phone: "600111222",
    });
    const res = mockRes();

    await convertirLeadHandler(
      mockReq({ params: { id: "lead_1" }, body: { confirmado: true } }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: "ten_1", leadId: "lead_1" });
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: "lead_1" },
      data: { status: "converted" },
    });
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_convertir_lead", resultado: "ok" })
    );
  });

  it("fallo parcial: lead.update lanza dentro de la transacción → 500 y el create queda revertido", async () => {
    asMock(prisma.lead.findUnique).mockResolvedValue({
      id: "lead_1",
      customerName: "Peluquería Sol",
      email: "sol@ejemplo.com",
      phone: "600111222",
    });
    // Trazamos que create y update ocurren DENTRO del mismo callback de
    // $transaction y que el error del update propaga fuera (rollback real en Prisma).
    const calls: string[] = [];
    asMock(prisma.$transaction).mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      calls.push("tx:start");
      try {
        return await fn(prisma);
      } finally {
        calls.push("tx:end");
      }
    });
    asMock(prisma.tenant.create).mockImplementationOnce(async () => {
      calls.push("create");
      return { id: "ten_1", codigo: "cli-05", name: "Peluquería Sol" };
    });
    asMock(prisma.lead.update).mockImplementationOnce(async () => {
      calls.push("update:boom");
      throw new Error("boom");
    });

    const res = mockRes();
    await convertirLeadHandler(
      mockReq({ params: { id: "lead_1" }, body: { confirmado: true } }),
      res
    );

    expect(res.statusCode).toBe(500);
    expect(calls).toEqual(["tx:start", "create", "update:boom", "tx:end"]);
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resultado: "error", detalle: "convert_failed" })
    );

    // Reintento con update funcional → convierte normalmente (sin duplicado: el
    // create anterior quedó dentro de la transacción abortada).
    asMock(prisma.lead.update).mockResolvedValue({});
    const res2 = mockRes();
    await convertirLeadHandler(
      mockReq({ params: { id: "lead_1" }, body: { confirmado: true } }),
      res2
    );
    expect(res2.statusCode).toBe(201);
    expect(res2.body).toMatchObject({ id: "ten_1", leadId: "lead_1" });
  });

  it("404 si el lead no existe, sin crear tenant", async () => {
    asMock(prisma.lead.findUnique).mockResolvedValue(null);
    const res = mockRes();

    await convertirLeadHandler(
      mockReq({ params: { id: "nope" }, body: { confirmado: true } }),
      res
    );

    expect(res.statusCode).toBe(404);
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resultado: "error", detalle: "lead_not_found" })
    );
  });

  it("409 sin confirmado, sin tocar la BD", async () => {
    const res = mockRes();
    await convertirLeadHandler(mockReq({ params: { id: "lead_1" }, body: {} }), res);

    expect(res.statusCode).toBe(409);
    expect(prisma.lead.findUnique).not.toHaveBeenCalled();
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it("409 si el lead ya estaba convertido", async () => {
    asMock(prisma.lead.findUnique).mockResolvedValue({
      id: "lead_1",
      customerName: "Peluquería Sol",
      email: "sol@ejemplo.com",
      phone: "600111222",
      status: "converted",
    });
    const res = mockRes();

    await convertirLeadHandler(
      mockReq({ params: { id: "lead_1" }, body: { confirmado: true } }),
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: { code: "already_converted" } });
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it("cierra la carrera (TOCTOU): re-verificación DENTRO de la tx ve status ya puesto por otra request concurrente → 409 already_converted, sin duplicar el tenant", async () => {
    // El chequeo previo a la tx (findUnique de arriba, primera llamada) NO ve
    // el status todavía; el re-fetch DENTRO de la tx (segunda llamada, vía
    // tx.lead.findUnique) sí: simula que la tx de la otra request concurrente
    // ya confirmó su commit entre medias.
    asMock(prisma.lead.findUnique)
      .mockResolvedValueOnce({
        id: "lead_1",
        customerName: "Peluquería Sol",
        email: "sol@ejemplo.com",
        phone: "600111222",
        status: "new",
      })
      .mockResolvedValueOnce({ status: "converted" });

    const res = mockRes();
    await convertirLeadHandler(
      mockReq({ params: { id: "lead_1" }, body: { confirmado: true } }),
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: { code: "already_converted" } });
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_convertir_lead", resultado: "error", detalle: "already_converted" })
    );
  });
});

// ── POST /agentes ─────────────────────────────────────────────────────────────
describe("POST /agentes", () => {
  it("409 sin confirmado", async () => {
    const res = mockRes();
    await crearAgenteHandler(mockReq({ body: { name: "Bot" } }), res);
    expect(res.statusCode).toBe(409);
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("crea el agente vía createAgent con runtime por defecto openai", async () => {
    asMock(createAgent).mockResolvedValue({ id: "ag_1", name: "Bot", sector: "retail", runtime: "openai" });
    const res = mockRes();

    await crearAgenteHandler(
      mockReq({
        body: { name: "Bot", sector: "retail", systemPrompt: "Eres útil", confirmado: true },
      }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: "ag_1", name: "Bot", sector: "retail", runtime: "openai" });
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Bot", sector: "retail", runtime: "openai", skillIds: [] })
    );
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_crear_agente", resultado: "ok", detalle: "ag_1" })
    );
  });
});
