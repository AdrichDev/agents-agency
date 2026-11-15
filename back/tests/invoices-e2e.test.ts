import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * E2E de facturas: cubre AC1/AC5 (aa-facturas-desde-presupuestos-aceptados) —
 * creación automática e idempotente de la factura al aceptar un presupuesto
 * (montada en budgetsRouter), y el router /api/invoices (listado + métricas +
 * cambio de estado de cobro). Prisma va mockeado — sin BD real.
 */

const prismaMock = vi.hoisted(() => {
  const p: any = {
    budget: { update: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    invoice: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  // $transaction interactivo ejecuta el callback pasándole el propio mock como tx.
  p.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(p));
  return p;
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { budgetsRouter } from "@/routes/budgets";
import { invoicesRouter } from "@/routes/invoices";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/budgets", budgetsRouter);
  app.use("/api/invoices", invoicesRouter);
  return app;
}

function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {},
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            let parsed: any = null;
            try {
              parsed = data ? JSON.parse(data) : null;
            } catch {
              parsed = data;
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe("facturas E2E (router montado)", () => {
  const app = buildApp();

  beforeEach(() => vi.clearAllMocks());

  it("PUT /api/budgets/:id/status a 'aceptada' crea una factura pendiente vinculada", async () => {
    prismaMock.budget.findUnique.mockResolvedValue({ id: "b1", status: "generada", invoice: null });
    prismaMock.budget.update.mockResolvedValue({ id: "b1", quoteNumber: "AD-2026-001", status: "aceptada" });
    prismaMock.invoice.create.mockResolvedValue({ id: "i1" });

    const res = await request(app, "PUT", "/api/budgets/b1/status", { status: "aceptada" });

    expect(res.status).toBe(200);
    expect(prismaMock.invoice.create).toHaveBeenCalledWith({
      data: { number: "FAC - 2026-001", budgetId: "b1", status: "pendiente" },
    });
  });

  it("PUT /api/budgets/:id/status con estado desconocido devuelve 400 y no toca facturas", async () => {
    const res = await request(app, "PUT", "/api/budgets/b1/status", { status: "invented" });
    expect(res.status).toBe(400);
    expect(prismaMock.budget.update).not.toHaveBeenCalled();
    expect(prismaMock.invoice.create).not.toHaveBeenCalled();
  });

  it("AC5 — reprocesar la aceptación (P2002 por budgetId) no duplica la factura ni rompe la respuesta", async () => {
    prismaMock.budget.findUnique.mockResolvedValue({ id: "b1", status: "generada", invoice: null });
    prismaMock.budget.update.mockResolvedValue({ id: "b1", quoteNumber: "AD-2026-001", status: "aceptada" });
    prismaMock.invoice.create.mockRejectedValue({ code: "P2002", meta: { target: ["presupuesto_id"] } });

    const res = await request(app, "PUT", "/api/budgets/b1/status", { status: "aceptada" });

    expect(res.status).toBe(200);
    expect(prismaMock.invoice.create).toHaveBeenCalledTimes(1);
  });

  it("P2002 por 'number' (colisión de numeración con otro presupuesto) NO se traga: propaga error, no responde 200", async () => {
    prismaMock.budget.findUnique.mockResolvedValue({ id: "b1", status: "generada", invoice: null });
    prismaMock.budget.update.mockResolvedValue({ id: "b1", quoteNumber: "AD-2026-001", status: "aceptada" });
    prismaMock.invoice.create.mockRejectedValue({ code: "P2002", meta: { target: ["numero_factura"] } });

    const res = await request(app, "PUT", "/api/budgets/b1/status", { status: "aceptada" });

    // No debe ser un 200 silencioso: el error no es de la columna budgetId/presupuesto_id.
    expect(res.status).not.toBe(200);
    expect(prismaMock.invoice.create).toHaveBeenCalledTimes(1);
  });

  it("PUT /api/budgets/:id/status a un estado distinto de 'aceptada' NO crea factura", async () => {
    prismaMock.budget.findUnique.mockResolvedValue({ id: "b1", status: "generada", invoice: null });
    prismaMock.budget.update.mockResolvedValue({ id: "b1", quoteNumber: "AD-2026-001", status: "rechazada" });
    const res = await request(app, "PUT", "/api/budgets/b1/status", { status: "rechazada" });
    expect(res.status).toBe(200);
    expect(prismaMock.invoice.create).not.toHaveBeenCalled();
  });

  it("PUT /api/budgets/:id/status devuelve 404 si el presupuesto no existe", async () => {
    prismaMock.budget.findUnique.mockResolvedValue(null);
    const res = await request(app, "PUT", "/api/budgets/nope/status", { status: "rechazada" });
    expect(res.status).toBe(404);
    expect(prismaMock.budget.update).not.toHaveBeenCalled();
  });

  it("Bug 2 — rechaza (400) un intento de mover un presupuesto 'aceptada' con factura a otro estado", async () => {
    prismaMock.budget.findUnique.mockResolvedValue({
      id: "b1",
      status: "aceptada",
      invoice: { id: "i1", number: "FAC - 2026-001" },
    });

    const res = await request(app, "PUT", "/api/budgets/b1/status", { status: "rechazada" });

    expect(res.status).toBe(400);
    expect(prismaMock.budget.update).not.toHaveBeenCalled();
  });

  it("permite mover un presupuesto 'aceptada' SIN factura asociada a otro estado", async () => {
    prismaMock.budget.findUnique.mockResolvedValue({ id: "b1", status: "aceptada", invoice: null });
    prismaMock.budget.update.mockResolvedValue({ id: "b1", quoteNumber: "AD-2026-001", status: "rechazada" });

    const res = await request(app, "PUT", "/api/budgets/b1/status", { status: "rechazada" });

    expect(res.status).toBe(200);
    expect(prismaMock.budget.update).toHaveBeenCalled();
  });

  it("re-aceptar un presupuesto ya 'aceptada' con factura no dispara el guard (mismo estado)", async () => {
    prismaMock.budget.findUnique.mockResolvedValue({
      id: "b1",
      status: "aceptada",
      invoice: { id: "i1", number: "FAC - 2026-001" },
    });
    prismaMock.budget.update.mockResolvedValue({ id: "b1", quoteNumber: "AD-2026-001", status: "aceptada" });
    prismaMock.invoice.create.mockRejectedValue({ code: "P2002", meta: { target: ["presupuesto_id"] } });

    const res = await request(app, "PUT", "/api/budgets/b1/status", { status: "aceptada" });

    expect(res.status).toBe(200);
    expect(prismaMock.budget.update).toHaveBeenCalled();
  });

  it("GET /api/invoices devuelve facturas + métricas calculadas server-side", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      { id: "i1", status: "pendiente", budget: { totalImpl: 121, totalMaint: 0 } },
      { id: "i2", status: "cobrada", budget: { totalImpl: 242, totalMaint: 0 } },
    ]);

    const res = await request(app, "GET", "/api/invoices");

    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(2);
    expect(res.body.metrics).toEqual({
      totalCount: 2,
      pendingCount: 1,
      paidCount: 1,
      totalAmount: 363,
      paidAmount: 242,
      pendingAmount: 121,
    });
  });

  it("GET /api/invoices/:id inexistente devuelve 404", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(null);
    const res = await request(app, "GET", "/api/invoices/nope");
    expect(res.status).toBe(404);
  });

  it("PUT /api/invoices/:id/status a 'cobrada' fija paidAt", async () => {
    prismaMock.invoice.update.mockImplementation(async ({ data }: any) => ({ id: "i1", ...data }));
    const res = await request(app, "PUT", "/api/invoices/i1/status", { status: "cobrada" });
    expect(res.status).toBe(200);
    expect(prismaMock.invoice.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "cobrada", paidAt: expect.any(Date) },
    });
  });

  it("PUT /api/invoices/:id/status con valor fuera del vocabulario cerrado devuelve 400", async () => {
    const res = await request(app, "PUT", "/api/invoices/i1/status", { status: "aceptada" });
    expect(res.status).toBe(400);
    expect(prismaMock.invoice.update).not.toHaveBeenCalled();
  });
});

// ── PRESERVE (S17): el alta del PANEL no cambia al extraer su código a lib/ ───
// El builder de datos del POST /api/budgets se movió a lib/budgets.ts para que el
// operador (agencia_crear_factura) lo reutilice en vez de duplicarlo. Este test
// fija el comportamiento de ANTES: mismo status, mismo body y mismos totales
// persistidos (calculados desde las líneas, nunca los que manda el navegador).
describe("POST /api/budgets — el alta del panel no cambia", () => {
  const app = buildApp();
  const PAYLOAD_PANEL = {
    quoteNumber: "AD-2026-010",
    status: "generada" as const,
    clientId: "ten_1",
    clientSnapshot: { name: "Peluquería Sol", cif: "B12345678" },
    issuerSnapshot: { company: "ADRICH", cif: "B00000000" },
    // Totales del navegador: se ignoran, los calcula el servidor desde las líneas.
    subtotalImpl: 999,
    subtotalMaint: 999,
    totalImpl: 999,
    totalMaint: 999,
    vatRate: 0.21,
    lines: [
      { serviceId: "svc_web", name: "Web", description: "Diseño", quantity: 2, implPrice: 100, maintPrice: 10 },
    ],
  };

  it("responde 201 y persiste snapshots, líneas y totales calculados en el servidor", async () => {
    prismaMock.budget.create.mockImplementation(async ({ data }: any) => ({ id: "b_new", ...data }));

    const res = await request(app, "POST", "/api/budgets", PAYLOAD_PANEL);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "b_new", quoteNumber: "AD-2026-010" });

    expect(prismaMock.budget.create).toHaveBeenCalledTimes(1);
    const llamada = prismaMock.budget.create.mock.calls[0][0];
    expect(llamada.include).toEqual({ lines: true });
    expect(llamada.data).toEqual({
      quoteNumber: "AD-2026-010",
      tenantId: "ten_1",
      clientSnapshot: { name: "Peluquería Sol", cif: "B12345678" },
      issuerSnapshot: { company: "ADRICH", cif: "B00000000" },
      status: "generada",
      subtotalImpl: 200,
      subtotalMaint: 20,
      totalImpl: 242,
      totalMaint: 24.2,
      vatRate: 0.21,
      validDays: 30,
      notes: undefined,
      lines: {
        create: [
          {
            serviceId: "svc_web",
            name: "Web",
            description: "Diseño",
            quantity: 2,
            implPrice: 100,
            maintPrice: 10,
            position: 0,
          },
        ],
      },
    });
  });

  it("sin cliente ni snapshots usa los valores por defecto de siempre", async () => {
    prismaMock.budget.create.mockImplementation(async ({ data }: any) => ({ id: "b_new", ...data }));

    const res = await request(app, "POST", "/api/budgets", {
      quoteNumber: "AD-2026-011",
      lines: [],
    });

    expect(res.status).toBe(201);
    const data = prismaMock.budget.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      quoteNumber: "AD-2026-011",
      tenantId: undefined,
      clientSnapshot: {},
      issuerSnapshot: {},
      status: "draft",
      vatRate: 0.21,
      validDays: 30,
      totalImpl: 0,
      lines: { create: [] },
    });
  });

  it("un número de presupuesto repetido sigue siendo 409", async () => {
    prismaMock.budget.create.mockRejectedValue({ code: "P2002", meta: { target: ["numero_presupuesto"] } });

    const res = await request(app, "POST", "/api/budgets", PAYLOAD_PANEL);

    // El cuerpo del error lo pone el manejador global de la app real; aquí se fija
    // el contrato del router: 409 y ninguna factura creada.
    expect(res.status).toBe(409);
    expect(prismaMock.invoice.create).not.toHaveBeenCalled();
  });
});
