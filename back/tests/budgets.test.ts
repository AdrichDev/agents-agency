/**
 * budgets.test.ts — lib/budgets.ts (totales) y lib/issuer.ts (emisor, S18).
 *
 * S18 (odd/tasks/mcp-plataforma-read-surface, L30):
 *   · el emisor de presupuestos/facturas vive en el SERVIDOR (lib/issuer.ts),
 *     con los datos que dio el dueño y cada campo sobreescribible por entorno;
 *   · el panel (POST /api/budgets) NO cambia: sigue guardando el snapshot del
 *     navegador tal cual, y sin snapshot sigue guardando {}.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks (hoisted): el panel no toca base de datos real ──────────────────────
const prismaMock = vi.hoisted(() => ({
  budget: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { computeBudgetTotals } from "@/lib/budgets";
import { ISSUER_DEFAULTS, issuerSnapshot } from "@/lib/issuer";
import { budgetsRouter } from "@/routes/budgets";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("computeBudgetTotals", () => {
  it("suma cantidad * precio por línea (subtotales sin IVA)", () => {
    const totals = computeBudgetTotals(
      [
        { quantity: 2, implPrice: 100, maintPrice: 10 },
        { quantity: 1, implPrice: 50, maintPrice: 5 },
      ],
      0.21
    );
    expect(totals.subtotalImpl).toBe(250); // 2*100 + 1*50
    expect(totals.subtotalMaint).toBe(25); // 2*10 + 1*5
  });

  it("aplica IVA a los totales", () => {
    const totals = computeBudgetTotals([{ quantity: 1, implPrice: 100, maintPrice: 0 }], 0.21);
    expect(totals.totalImpl).toBe(121);
    expect(totals.totalMaint).toBe(0);
  });

  it("ignora totales enviados por el cliente (solo usa líneas)", () => {
    // El cálculo no acepta totales externos: si las líneas suman 100, el total es 100*IVA.
    const totals = computeBudgetTotals([{ quantity: 1, implPrice: 100 }], 0);
    expect(totals.totalImpl).toBe(100);
  });

  it("usa quantity=1 por defecto y precios=0 ausentes", () => {
    const totals = computeBudgetTotals([{ implPrice: 30 }, {}], 0);
    expect(totals.subtotalImpl).toBe(30);
    expect(totals.subtotalMaint).toBe(0);
  });

  it("redondea a 2 decimales", () => {
    const totals = computeBudgetTotals([{ quantity: 3, implPrice: 33.33 }], 0.21);
    expect(totals.subtotalImpl).toBe(99.99);
    expect(totals.totalImpl).toBe(120.99); // 99.99 * 1.21 = 120.9879 → 120.99
  });
});

// ── lib/issuer — datos del emisor (S18) ──────────────────────────────────────
describe("issuerSnapshot — datos del emisor por defecto", () => {
  it("sin entorno devuelve los cinco campos del emisor con los valores del dueño", () => {
    expect(issuerSnapshot({})).toEqual({
      company: "Adrich Digital S.L.",
      cif: "B87451239",
      address: "Calle Aquiles 25, Madrid",
      email: "achozas9@gmail.com",
      phone: "635984010",
    });
  });

  it("el snapshot tiene EXACTAMENTE las cinco claves que lee el front", () => {
    // Mismas claves que el formulario del panel (company/cif/address/email/phone):
    // una clave nueva aquí no la pintaría ningún renderizador de presupuesto.
    expect(Object.keys(issuerSnapshot({})).sort()).toEqual([
      "address",
      "cif",
      "company",
      "email",
      "phone",
    ]);
  });

  it("el CIF por defecto es inventado pero sintácticamente válido (B + 8 dígitos)", () => {
    // Decisión explícita del dueño (L30): no es el CIF real de ninguna sociedad.
    expect(ISSUER_DEFAULTS.cif).toMatch(/^B\d{8}$/);
  });

  it.each([
    ["ISSUER_COMPANY", "company", "Emisor de Pruebas S.L."],
    ["ISSUER_CIF", "cif", "B99999999"],
    ["ISSUER_ADDRESS", "address", "Calle Otra 2, Madrid"],
    ["ISSUER_EMAIL", "email", "emisor@example.com"],
    ["ISSUER_PHONE", "phone", "600000000"],
  ])("%s sobreescribe SOLO %s", (variable, campo, valor) => {
    const snapshot = issuerSnapshot({ [variable]: valor });

    expect(snapshot[campo as keyof typeof snapshot]).toBe(valor);
    // El resto sigue en su valor por defecto: la sobreescritura es por campo.
    for (const [otro, defecto] of Object.entries(ISSUER_DEFAULTS)) {
      if (otro === campo) continue;
      expect(snapshot[otro as keyof typeof snapshot]).toBe(defecto);
    }
  });

  it.each([
    ["ISSUER_COMPANY", "company"],
    ["ISSUER_CIF", "cif"],
    ["ISSUER_ADDRESS", "address"],
    ["ISSUER_EMAIL", "email"],
    ["ISSUER_PHONE", "phone"],
  ])("%s vacío vuelve al valor por defecto de %s", (variable, campo) => {
    for (const vacio of ["", "   "]) {
      const snapshot = issuerSnapshot({ [variable]: vacio });
      expect(snapshot[campo as keyof typeof snapshot]).toBe(
        ISSUER_DEFAULTS[campo as keyof typeof ISSUER_DEFAULTS]
      );
    }
  });

  it("lee process.env por defecto (la variable real del despliegue)", () => {
    process.env.ISSUER_PHONE = "611222333";
    try {
      const snapshot = issuerSnapshot();
      expect(snapshot.phone).toBe("611222333");
      expect(snapshot.company).toBe(ISSUER_DEFAULTS.company);
    } finally {
      delete process.env.ISSUER_PHONE;
    }
  });
});

// ── Panel: POST /api/budgets NO cambia (passthrough del navegador) ───────────
const SNAPSHOT_NAVEGADOR = {
  company: "Emisor del navegador S.L.",
  cif: "B00000000",
  address: "Calle Falsa 1",
  email: "emisor@navegador.test",
  phone: "699888777",
};

const CUERPO_PANEL = {
  quoteNumber: "AD-2026-010",
  clientSnapshot: { name: "Peluquería Sol", cif: "B12345678" },
  vatRate: 0.21,
  validDays: 30,
  lines: [
    { serviceId: "web_basic", name: "Página Web", quantity: 1, implPrice: 890, maintPrice: 59 },
  ],
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/budgets", budgetsRouter);
  app.use((_req, res) => res.status(404).json({ error: "No encontrado" }));
  return app;
}

function postCuerpo(body: unknown): Promise<{ status: number; body: any }> {
  const app = buildApp();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/api/budgets",
          headers: {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(payload)),
          },
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
      req.write(payload);
      req.end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prismaMock.budget.create).mockImplementation(async ({ data }: any) => ({
    id: "bud_panel",
    ...data,
  }));
});

describe("POST /api/budgets (panel) — el snapshot del navegador se guarda tal cual", () => {
  it("con snapshot del navegador lo persiste sin mezclar los defectos del servidor", async () => {
    const res = await postCuerpo({ ...CUERPO_PANEL, issuerSnapshot: SNAPSHOT_NAVEGADOR });

    expect(res.status).toBe(201);
    const data = asMock(prismaMock.budget.create).mock.calls[0][0].data;
    expect(data.issuerSnapshot).toEqual(SNAPSHOT_NAVEGADOR);
    // Ni un campo del emisor por defecto se cuela en el camino del panel.
    const serializado = JSON.stringify(data.issuerSnapshot);
    expect(serializado).not.toContain(ISSUER_DEFAULTS.company);
    expect(serializado).not.toContain(ISSUER_DEFAULTS.cif);
    expect(serializado).not.toContain(ISSUER_DEFAULTS.address);
    expect(serializado).not.toContain(ISSUER_DEFAULTS.email);
    expect(serializado).not.toContain(ISSUER_DEFAULTS.phone);
  });

  it("sin snapshot del navegador guarda {} (no inventa el emisor en el panel)", async () => {
    const res = await postCuerpo(CUERPO_PANEL);

    expect(res.status).toBe(201);
    const data = asMock(prismaMock.budget.create).mock.calls[0][0].data;
    expect(data.issuerSnapshot).toEqual({});
  });
});

afterEach(() => {
  delete process.env.ISSUER_PHONE;
});
