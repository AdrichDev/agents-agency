/**
 * operator-invoices.test.ts — S17 (odd/tasks/mcp-plataforma-read-surface, L29).
 *
 * Facturas de 3A Estudio a sus clientes, creadas por el bot en UN paso
 * (presupuesto + factura), con confirmación HUMANA previa (S14/S17):
 *   · POST /service/operator/facturas valida (zod estricto), comprueba que el
 *     cliente existe y está activo, calcula los totales en el servidor y responde
 *     202 { pendiente, accion, resumen, expiraEn } con un resumen SIN ids;
 *   · NADA se persiste antes de confirmar;
 *   · al confirmar, en UNA transacción se crea el presupuesto (con líneas y
 *     snapshots), se pone en `aceptada` y se crea la factura con la MISMA lógica
 *     (`ensureInvoiceForBudget`) que usa el panel;
 *   · el número de presupuesto lo genera el SERVIDOR (siguiente libre
 *     AD-<año>-NNN, año del reloj, reintento acotado ante colisión) y el de la
 *     factura se deriva de él: el llamador no puede imponer ninguno de los dos;
 *   · lectura paginada del operador: GET /facturas y GET /presupuestos con
 *     proyección FIJA (nada de snapshots, ids ni secretos);
 *   · POST /facturas (escritura, router legacy) y GET /facturas (lectura, router
 *     de dominio) conviven sin taparse, en la composición REAL de producción.
 *
 * Se monta routes/operator-domain-mounts.ts (la misma función que usa src/index.ts)
 * y se habla HTTP con node:http. Prisma, logger, auditoría, códigos y Telegram van
 * mockeados: aquí no hay base de datos ni red reales.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────
const prismaMock = vi.hoisted(() => {
  const modelo = () => ({
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    groupBy: vi.fn(),
  });
  const p: any = {
    tenant: modelo(),
    lead: modelo(),
    prospectContact: modelo(),
    platformAppointment: modelo(),
    platformIntegration: modelo(),
    agent: modelo(),
    operatorAudit: modelo(),
    budget: modelo(),
    invoice: modelo(),
    $queryRaw: vi.fn(),
  };
  // $transaction interactivo: ejecuta el callback con el propio mock como tx.
  p.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(p));
  return p;
});
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/operator-audit", () => ({ writeOperatorAudit: vi.fn() }));
// Los códigos de cliente/contacto se fijan; el generador de número de presupuesto
// se deja REAL para poder comprobar la paridad de formato con lib/codes.ts.
vi.mock("@/lib/codes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/codes")>();
  return {
    ...real,
    nextClientCode: vi.fn().mockResolvedValue("cli-09"),
    nextContactCode: vi.fn().mockResolvedValue("pc-09"),
    withCodeRetry: vi.fn((fn: () => unknown) => fn()),
  };
});
vi.mock("@/lib/agent/service", () => ({ createAgent: vi.fn() }));
vi.mock("@/lib/integrations/oauth", () => ({ getValidPlatformToken: vi.fn() }));
vi.mock("@/lib/integrations/calendar", () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));

import { logger } from "@/lib/logger";
import { writeOperatorAudit } from "@/lib/operator-audit";
import { montarSuperficieOperador } from "@/routes/operator-domain-mounts";
import { resetConfirmacionesPendientes, tamanoPendientes } from "@/lib/operator-confirmations";
import { computeBudgetTotals, nextQuoteNumber } from "@/lib/budgets";
import { nextQuoteNumber as nextQuoteNumberLegacy } from "@/lib/codes";

const TOKEN = "operator-invoices-secret-token-123";
const TG_BOT_TOKEN = "123456:bot-token-de-pruebas";
const TG_CHAT_ID = "987654321";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const fetchMock = vi.fn();

// ── Composición REAL: la misma función que usa src/index.ts ───────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  montarSuperficieOperador(app);
  app.use((_req, res) => res.status(404).json({ error: "No encontrado" }));
  return app;
}

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const app = buildApp();
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
          headers: {
            ...headers,
            ...(payload
              ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) }
              : {}),
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
            setImmediate(() => resolve({ status: res.statusCode ?? 0, body: parsed }));
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

const autorizado = (headers: Record<string, string> = {}) => ({ "x-service-token": TOKEN, ...headers });

/** Llamadas salientes a la Bot API de Telegram, ya parseadas (método + payload). */
function llamadasTelegram(): Array<{ metodo: string; payload: any }> {
  return fetchMock.mock.calls.map(([url, init]) => ({
    metodo: String(url).split("/").at(-1) ?? "",
    payload: JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? "{}")),
  }));
}

function ultimoEnvioTelegram(): { url: string; payload: any } {
  const llamada = fetchMock.mock.calls.at(-1);
  expect(llamada, "no se llamó al fetch de Telegram").toBeTruthy();
  return {
    url: String(llamada![0]),
    payload: JSON.parse(String((llamada![1] as { body?: unknown })?.body ?? "{}")),
  };
}

function tokenDelTeclado(payload: any): string {
  const datos = payload?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
  expect(typeof datos).toBe("string");
  return datos.replace(/^confirmar:/, "");
}

/** Sólo las ediciones del mensaje de los botones (S15). */
function ediciones(): Array<{ metodo: string; payload: any }> {
  return llamadasTelegram().filter((l) => l.metodo === "editMessageText");
}

function telegramResponde(messageId: number | null = 77) {
  fetchMock.mockImplementation(async (url: unknown) => {
    if (String(url).endsWith("/sendMessage")) {
      return { json: async () => ({ ok: true, result: messageId === null ? {} : { message_id: messageId } }) };
    }
    return { json: async () => ({ ok: true, result: {} }) };
  });
}

/** Petición de escritura → 202 pendiente; devuelve el token de los botones. */
async function pedirFactura(body: unknown): Promise<string> {
  const alta = await request("POST", "/service/operator/facturas", body, autorizado());
  expect(alta.status).toBe(202);
  return tokenDelTeclado(ultimoEnvioTelegram().payload);
}

const confirmar = (token: string) =>
  request("POST", `/service/operator/confirmaciones/${token}/confirmar`, undefined, autorizado());

// ── Datos de trabajo ─────────────────────────────────────────────────────────
const CLIENTE = {
  id: "ten_sol",
  name: "Peluquería Sol",
  razonSocial: "Sol SL",
  nif: "B12345678",
  direccion: "Calle Mayor 1",
  email: "sol@example.com",
  phone: "600111222",
  contactPerson: "Ana",
  isActive: true,
};

/** Factura del dueño: 2 × 100 € de implantación + 2 × 10 €/mes, IVA 21 %. */
const FACTURA = {
  clienteId: CLIENTE.id,
  lineas: [
    {
      concepto: "Web corporativa",
      descripcion: "Diseño y puesta en marcha",
      cantidad: 2,
      precioImplantacion: 100,
      precioMantenimiento: 10,
    },
  ],
};

/** Totales que debe calcular el SERVIDOR para FACTURA (nunca el llamador). */
const TOTALES_FACTURA = computeBudgetTotals(
  [{ quantity: 2, implPrice: 100, maintPrice: 10 }],
  0.21
); // subtotalImpl 200, subtotalMaint 20, totalImpl 242, totalMaint 24.2

const TOTAL_CON_IVA = 266.2;
const RESUMEN_ESPERADO = `Factura para ${CLIENTE.name}: 1 concepto(s), total 266.20 € (IVA 21 %)`;

/** Ninguna escritura del alta presupuesto+factura ha ocurrido. */
function sinEscriturasDeFactura() {
  for (const nombre of ["budget", "invoice"]) {
    const modelo = (prismaMock as any)[nombre];
    for (const metodo of ["create", "update", "updateMany", "delete", "upsert", "findMany", "count"]) {
      expect(modelo[metodo], `${nombre}.${metodo}`).not.toHaveBeenCalled();
    }
  }
  expect(prismaMock.$transaction).not.toHaveBeenCalled();
  expect(tamanoPendientes()).toBe(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reloj fijo: el año del número de presupuesto sale del reloj del SERVIDOR.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-01T09:00:00Z"));
  resetConfirmacionesPendientes();
  process.env.OPERATOR_SERVICE_TOKEN = TOKEN;
  process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN = TG_BOT_TOKEN;
  process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID = TG_CHAT_ID;
  telegramResponde(77);
  vi.stubGlobal("fetch", fetchMock);

  // Cliente activo por defecto.
  prismaMock.tenant.findUnique.mockResolvedValue({ ...CLIENTE });
  // Sin presupuestos previos: el primero libre del año es AD-2026-001.
  prismaMock.budget.findMany.mockResolvedValue([]);
  prismaMock.budget.create.mockImplementation(async ({ data }: any) => ({
    id: "bud_new",
    quoteNumber: data.quoteNumber,
    status: data.status,
  }));
  prismaMock.budget.update.mockImplementation(async ({ where, data }: any) => {
    const llamadas = asMock(prismaMock.budget.create).mock.calls;
    return {
      id: where.id,
      quoteNumber: llamadas[llamadas.length - 1][0].data.quoteNumber,
      status: data.status,
    };
  });
  prismaMock.invoice.create.mockImplementation(async ({ data }: any) => ({ id: "inv_new", ...data }));
});

afterEach(() => {
  delete process.env.OPERATOR_SERVICE_TOKEN;
  delete process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN;
  delete process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetConfirmacionesPendientes();
});

// ── Autorización ─────────────────────────────────────────────────────────────
describe("el service token sigue siendo la única autorización", () => {
  it.each([
    ["POST", "/service/operator/facturas"],
    ["GET", "/service/operator/facturas"],
    ["GET", "/service/operator/presupuestos"],
  ])("%s %s sin token → 401 y nada escrito", async (metodo, ruta) => {
    const res = await request(metodo, ruta, metodo === "POST" ? FACTURA : undefined);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autorizado" });
    sinEscriturasDeFactura();
  });

  it("POST /facturas con token incorrecto → 401 y nada escrito", async () => {
    const res = await request("POST", "/service/operator/facturas", FACTURA, {
      "x-service-token": "token-que-no-es",
    });
    expect(res.status).toBe(401);
    sinEscriturasDeFactura();
  });
});

// ── Entradas inválidas: 400 sin pendiente y sin escribir ─────────────────────
describe("entradas inválidas → 400 sin pendiente y sin escribir", () => {
  const INVALIDAS = [
    { nombre: "sin lineas", body: { clienteId: CLIENTE.id, lineas: [] } },
    { nombre: "sin clienteId", body: { lineas: FACTURA.lineas } },
    {
      nombre: "más de 30 líneas",
      body: { clienteId: CLIENTE.id, lineas: Array.from({ length: 31 }, () => FACTURA.lineas[0]) },
    },
    {
      nombre: "concepto vacío",
      body: { clienteId: CLIENTE.id, lineas: [{ ...FACTURA.lineas[0], concepto: "  " }] },
    },
    {
      nombre: "concepto de más de 200 caracteres",
      body: { clienteId: CLIENTE.id, lineas: [{ ...FACTURA.lineas[0], concepto: "x".repeat(201) }] },
    },
    {
      nombre: "descripción de más de 1000 caracteres",
      body: { clienteId: CLIENTE.id, lineas: [{ ...FACTURA.lineas[0], descripcion: "x".repeat(1001) }] },
    },
    {
      nombre: "cantidad 0",
      body: { clienteId: CLIENTE.id, lineas: [{ ...FACTURA.lineas[0], cantidad: 0 }] },
    },
    {
      nombre: "cantidad no entera",
      body: { clienteId: CLIENTE.id, lineas: [{ ...FACTURA.lineas[0], cantidad: 1.5 }] },
    },
    {
      nombre: "cantidad por encima de 1000",
      body: { clienteId: CLIENTE.id, lineas: [{ ...FACTURA.lineas[0], cantidad: 1001 }] },
    },
    {
      nombre: "precio de implantación negativo",
      body: { clienteId: CLIENTE.id, lineas: [{ ...FACTURA.lineas[0], precioImplantacion: -1 }] },
    },
    {
      nombre: "precio de implantación ausente",
      body: {
        clienteId: CLIENTE.id,
        lineas: [{ concepto: "Web", cantidad: 1, precioMantenimiento: 0 }],
      },
    },
    {
      nombre: "precio de mantenimiento negativo",
      body: { clienteId: CLIENTE.id, lineas: [{ ...FACTURA.lineas[0], precioMantenimiento: -0.01 }] },
    },
    { nombre: "iva por encima de 1", body: { ...FACTURA, iva: 1.5 } },
    { nombre: "iva negativo", body: { ...FACTURA, iva: -0.01 } },
    { nombre: "iva no numérico", body: { ...FACTURA, iva: "21" } },
    { nombre: "validezDias no positiva", body: { ...FACTURA, validezDias: 0 } },
    {
      nombre: "un número de presupuesto impuesto por el llamador",
      body: { ...FACTURA, quoteNumber: "AD-2026-999" },
    },
    {
      nombre: "asunto desconocido en una línea",
      body: { clienteId: CLIENTE.id, lineas: [{ ...FACTURA.lineas[0], total: 1 }] },
    },
  ] as const;

  it.each(INVALIDAS)("$nombre → 400, sin Telegram, sin pendiente y sin escribir", async (caso) => {
    const res = await request("POST", "/service/operator/facturas", caso.body, autorizado());

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeOperatorAudit).not.toHaveBeenCalled();
    sinEscriturasDeFactura();
    // Ni siquiera se consulta el cliente: la validación va primero.
    expect(prismaMock.tenant.findUnique).not.toHaveBeenCalled();
  });
});

// ── Cliente inexistente o inactivo ───────────────────────────────────────────
describe("cliente inexistente o inactivo → 404 sin pendiente", () => {
  it.each([
    ["no existe", null],
    ["está dado de baja", { ...CLIENTE, isActive: false }],
  ])("cliente que %s → 404 y nada guardado", async (_nombre, tenant) => {
    prismaMock.tenant.findUnique.mockResolvedValue(tenant);

    const res = await request("POST", "/service/operator/facturas", FACTURA, autorizado());

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Cliente no encontrado" });
    expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: CLIENTE.id },
      select: expect.objectContaining({ name: true, isActive: true }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeOperatorAudit).not.toHaveBeenCalled();
    sinEscriturasDeFactura();
  });
});

// ── 202 pendiente: resumen sin ids y total del servidor ──────────────────────
describe("202 pendiente con resumen sin ids", () => {
  it("responde el contrato exacto y NO persiste nada antes de confirmar", async () => {
    const res = await request("POST", "/service/operator/facturas", FACTURA, autorizado());

    expect(res.status).toBe(202);
    expect(Object.keys(res.body).sort()).toEqual(["accion", "expiraEn", "pendiente", "resumen"]);
    expect(res.body).toMatchObject({ pendiente: true, accion: "agencia_crear_factura" });
    expect(res.body.resumen).toBe(RESUMEN_ESPERADO);
    // Nunca ids ni detalle técnico en lo que lee el humano (S16).
    expect(res.body.resumen).not.toContain(CLIENTE.id);
    expect(res.body.resumen).not.toContain("agencia_");
    expect(res.body.resumen).not.toMatch(/[0-9a-f]{20,}/);

    expect(prismaMock.budget.create).not.toHaveBeenCalled();
    expect(prismaMock.budget.update).not.toHaveBeenCalled();
    expect(prismaMock.invoice.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tamanoPendientes()).toBe(1);
    // La auditoría de la escritura se emite al EJECUTAR, no al pedir confirmación.
    expect(writeOperatorAudit).not.toHaveBeenCalled();

    // El resumen (y los botones) los envía el BACKEND, no el modelo.
    const envio = ultimoEnvioTelegram();
    expect(envio.payload.chat_id).toBe(Number(TG_CHAT_ID));
    expect(envio.payload.text).toEqual(expect.stringContaining(RESUMEN_ESPERADO));
  });

  it("el total sale de las líneas (IVA incluido), no de ningún importe del llamador", async () => {
    // Dos líneas con céntimos: 3 × 33.33 € + 1 × 0.05 € = 100.04 € base.
    const body = {
      clienteId: CLIENTE.id,
      iva: 0.21,
      lineas: [
        { concepto: "A", cantidad: 3, precioImplantacion: 33.33 },
        { concepto: "B", cantidad: 1, precioImplantacion: 0.05 },
      ],
    };
    const totales = computeBudgetTotals(
      [
        { quantity: 3, implPrice: 33.33 },
        { quantity: 1, implPrice: 0.05 },
      ],
      0.21
    );

    const res = await request("POST", "/service/operator/facturas", body, autorizado());

    expect(res.status).toBe(202);
    expect(res.body.resumen).toBe(
      `Factura para ${CLIENTE.name}: 2 concepto(s), total ${(totales.totalImpl + totales.totalMaint).toFixed(2)} € (IVA 21 %)`
    );
  });

  it("iva explícito distinto de 21 % se refleja en el resumen y en el importe", async () => {
    const res = await request("POST", "/service/operator/facturas", { ...FACTURA, iva: 0.1 }, autorizado());

    expect(res.status).toBe(202);
    // 200 € + 20 € base = 220 € → con 10 % = 242 €
    expect(res.body.resumen).toBe(`Factura para ${CLIENTE.name}: 1 concepto(s), total 242.00 € (IVA 10 %)`);
  });
});

// ── Confirmar: presupuesto + factura en UNA transacción ──────────────────────
describe("confirmar crea presupuesto + líneas + aceptada + factura en UNA transacción", () => {
  it("una sola $transaction, número server-side y respuesta 201 con números, sin ids", async () => {
    telegramResponde(321);
    const token = await pedirFactura(FACTURA);

    const confirmacion = await confirmar(token);

    expect(confirmacion.status).toBe(201);
    expect(confirmacion.body).toEqual({
      presupuesto: { quoteNumber: "AD-2026-001", status: "aceptada" },
      factura: { number: "FAC - 2026-001", status: "pendiente" },
    });

    // UNA transacción para todo el alta (nunca escrituras sueltas).
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    // Presupuesto: snapshots, líneas y totales calculados en el servidor.
    expect(prismaMock.budget.create).toHaveBeenCalledTimes(1);
    const data = asMock(prismaMock.budget.create).mock.calls[0][0].data;
    expect(data).toMatchObject({
      quoteNumber: "AD-2026-001",
      tenantId: CLIENTE.id,
      status: "generada",
      vatRate: 0.21,
      validDays: 30,
      subtotalImpl: TOTALES_FACTURA.subtotalImpl,
      subtotalMaint: TOTALES_FACTURA.subtotalMaint,
      totalImpl: TOTALES_FACTURA.totalImpl,
      totalMaint: TOTALES_FACTURA.totalMaint,
      clientSnapshot: {
        name: CLIENTE.name,
        razonSocial: CLIENTE.razonSocial,
        cif: CLIENTE.nif,
        address: CLIENTE.direccion,
        email: CLIENTE.email,
        phone: CLIENTE.phone,
        contactPerson: CLIENTE.contactPerson,
      },
      issuerSnapshot: {},
    });
    expect(data.lines.create).toEqual([
      {
        serviceId: "",
        name: "Web corporativa",
        description: "Diseño y puesta en marcha",
        quantity: 2,
        implPrice: 100,
        maintPrice: 10,
        position: 0,
      },
    ]);

    // Pasa a `aceptada` y la factura nace con la MISMA lógica del panel.
    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: "bud_new" },
      data: { status: "aceptada" },
    });
    expect(prismaMock.invoice.create).toHaveBeenCalledWith({
      data: { number: "FAC - 2026-001", budgetId: "bud_new", status: "pendiente" },
    });

    // Auditoría de la escritura ejecutada, con el id interno (log, no chat).
    expect(writeOperatorAudit).toHaveBeenCalledTimes(1);
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_crear_factura", resultado: "ok" })
    );
  });

  it("los totales persistidos son exactamente computeBudgetTotals", async () => {
    const token = await pedirFactura({
      clienteId: CLIENTE.id,
      iva: 0.21,
      lineas: [
        { concepto: "A", cantidad: 3, precioImplantacion: 33.33 },
        { concepto: "B", cantidad: 1, precioImplantacion: 10, precioMantenimiento: 5 },
      ],
    });
    await confirmar(token);

    const esperado = computeBudgetTotals(
      [
        { quantity: 3, implPrice: 33.33 },
        { quantity: 1, implPrice: 10, maintPrice: 5 },
      ],
      0.21
    );
    const data = asMock(prismaMock.budget.create).mock.calls[0][0].data;
    expect({
      subtotalImpl: data.subtotalImpl,
      subtotalMaint: data.subtotalMaint,
      totalImpl: data.totalImpl,
      totalMaint: data.totalMaint,
    }).toEqual(esperado);
    expect(data.lines.create.map((l: any) => l.position)).toEqual([0, 1]);
  });

  it("la validez por defecto es la del panel (30 días) y se puede pedir otra", async () => {
    const token = await pedirFactura({ ...FACTURA, validezDias: 15 });
    await confirmar(token);
    expect(asMock(prismaMock.budget.create).mock.calls[0][0].data.validDays).toBe(15);
  });
});

// ── Numeración: siguiente libre, colisión, cambio de año ─────────────────────
describe("número de presupuesto generado por el servidor", () => {
  it("toma el siguiente libre del año a partir del mayor existente", async () => {
    prismaMock.budget.findMany.mockResolvedValue([
      { quoteNumber: "AD-2026-001" },
      { quoteNumber: "AD-2026-007" },
      { quoteNumber: "AD-2026-003-R" },
    ]);
    const token = await pedirFactura(FACTURA);
    const confirmacion = await confirmar(token);

    expect(prismaMock.budget.findMany).toHaveBeenCalledWith({
      where: { quoteNumber: { startsWith: "AD-2026-" } },
      select: { quoteNumber: true },
    });
    expect(confirmacion.body.presupuesto.quoteNumber).toBe("AD-2026-008");
    expect(confirmacion.body.factura.number).toBe("FAC - 2026-008");
  });

  it("ante una colisión de número (P2002) recalcula y reintenta la transacción", async () => {
    prismaMock.budget.findMany
      .mockResolvedValueOnce([{ quoteNumber: "AD-2026-001" }])
      .mockResolvedValueOnce([{ quoteNumber: "AD-2026-001" }, { quoteNumber: "AD-2026-002" }]);
    prismaMock.budget.create
      .mockRejectedValueOnce({ code: "P2002", meta: { target: ["numero_presupuesto"] } })
      .mockImplementation(async ({ data }: any) => ({ id: "bud_new", ...data }));

    const token = await pedirFactura(FACTURA);
    const confirmacion = await confirmar(token);

    expect(confirmacion.status).toBe(201);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(confirmacion.body.presupuesto.quoteNumber).toBe("AD-2026-003");
    expect(confirmacion.body.factura.number).toBe("FAC - 2026-003");
    // La primera transacción no dejó factura colgando.
    expect(prismaMock.invoice.create).toHaveBeenCalledTimes(1);
  });

  it("una colisión del número de FACTURA también se reintenta", async () => {
    prismaMock.budget.findMany
      .mockResolvedValueOnce([{ quoteNumber: "AD-2026-004" }])
      .mockResolvedValueOnce([{ quoteNumber: "AD-2026-005" }]);
    prismaMock.invoice.create
      .mockRejectedValueOnce({ code: "P2002", meta: { target: ["numero_factura"] } })
      .mockImplementation(async ({ data }: any) => ({ id: "inv_new", ...data }));

    const token = await pedirFactura(FACTURA);
    const confirmacion = await confirmar(token);

    expect(confirmacion.status).toBe(201);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(confirmacion.body.presupuesto.quoteNumber).toBe("AD-2026-006");
  });

  it("el reintento está acotado: 5 intentos y después un 500 honesto", async () => {
    prismaMock.budget.findMany.mockResolvedValue([{ quoteNumber: "AD-2026-001" }]);
    prismaMock.budget.create.mockRejectedValue({ code: "P2002", meta: { target: ["numero_presupuesto"] } });

    const token = await pedirFactura(FACTURA);
    const confirmacion = await confirmar(token);

    expect(confirmacion.status).toBe(500);
    expect(confirmacion.body).toEqual({ error: "No se pudo crear la factura" });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(5);
    expect(prismaMock.invoice.create).not.toHaveBeenCalled();
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_crear_factura", resultado: "error" })
    );
  });

  it("un error que NO es de numeración no se reintenta", async () => {
    prismaMock.budget.create.mockRejectedValue(new Error("relation does not exist"));

    const token = await pedirFactura(FACTURA);
    const confirmacion = await confirmar(token);

    expect(confirmacion.status).toBe(500);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("el año del número sale del reloj del servidor (cambio de año → serie nueva)", async () => {
    vi.setSystemTime(new Date("2027-01-02T08:00:00Z"));
    prismaMock.budget.findMany.mockResolvedValue([{ quoteNumber: "AD-2027-001" }]);

    const token = await pedirFactura(FACTURA);
    const confirmacion = await confirmar(token);

    expect(prismaMock.budget.findMany).toHaveBeenCalledWith({
      where: { quoteNumber: { startsWith: "AD-2027-" } },
      select: { quoteNumber: true },
    });
    expect(confirmacion.body.presupuesto.quoteNumber).toBe("AD-2027-002");
  });

  it("el número no aparece en el resumen de la confirmación (solo en la respuesta final)", async () => {
    const alta = await request("POST", "/service/operator/facturas", FACTURA, autorizado());
    expect(alta.body.resumen).not.toContain("AD-");
    expect(alta.body.resumen).not.toContain("FAC");
  });
});

// ── Replay y caducidad ───────────────────────────────────────────────────────
describe("replay y caducidad no ejecutan dos veces", () => {
  it("confirmar dos veces → 404 en el replay y una sola factura", async () => {
    const token = await pedirFactura(FACTURA);
    expect((await confirmar(token)).status).toBe(201);

    const replay = await confirmar(token);

    expect(replay.status).toBe(404);
    expect(replay.body.error.code).toBe("confirmacion_no_encontrada");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.invoice.create).toHaveBeenCalledTimes(1);
  });

  it("confirmar 10 minutos después → 410 y ninguna escritura", async () => {
    const token = await pedirFactura(FACTURA);

    vi.setSystemTime(new Date("2026-03-01T09:11:00Z"));
    const caducada = await confirmar(token);

    expect(caducada.status).toBe(410);
    expect(caducada.body.error.code).toBe("confirmacion_caducada");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    sinEscriturasDeFactura();
  });

  it("cancelar descarta la factura pendiente sin escribir nada", async () => {
    const token = await pedirFactura(FACTURA);

    const cancelacion = await request(
      "POST",
      `/service/operator/confirmaciones/${token}/cancelar`,
      undefined,
      autorizado()
    );

    expect(cancelacion.status).toBe(200);
    expect(cancelacion.body).toEqual({ cancelada: true });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

// ── S15: el mensaje de Telegram cuenta el progreso ───────────────────────────
describe("S15: el mensaje de confirmación cuenta el progreso de la factura", () => {
  it("'⏳ Creando factura…' y después '✅ Factura creada', sin ids", async () => {
    telegramResponde(555);
    const token = await pedirFactura(FACTURA);

    const confirmacion = await confirmar(token);
    expect(confirmacion.status).toBe(201);

    expect(ediciones().map((e) => e.payload.text)).toEqual(["⏳ Creando factura…", "✅ Factura creada"]);
    for (const edicion of ediciones()) {
      expect(edicion.payload.message_id).toBe(555);
      expect(edicion.payload.chat_id).toBe(Number(TG_CHAT_ID));
      expect(edicion.payload.text).not.toContain("bud_new");
      expect(edicion.payload.text).not.toContain(CLIENTE.id);
      expect(edicion.payload.text).not.toContain(TOKEN);
    }
  });

  it("si el alta falla, el mensaje lo dice sin detalle técnico", async () => {
    telegramResponde(556);
    prismaMock.budget.create.mockRejectedValue(new Error("deadlock detected"));
    const token = await pedirFactura(FACTURA);

    const confirmacion = await confirmar(token);

    expect(confirmacion.status).toBe(500);
    expect(ediciones().at(-1)!.payload.text).toBe("⚠️ No se pudo completar: crear la factura");
    expect(ediciones().at(-1)!.payload.text).not.toContain("deadlock");
  });
});

// ── Lectura: GET /service/operator/facturas ──────────────────────────────────
describe("GET /service/operator/facturas (lectura paginada)", () => {
  const FILA_1 = {
    number: "FAC - 2026-002",
    status: "pendiente",
    createdAt: new Date("2026-03-02T10:00:00Z"),
    paidAt: null,
    budget: {
      totalImpl: 242,
      totalMaint: 24.2,
      clientSnapshot: { name: "Peluquería Sol" },
      tenant: { name: "Sol SL" },
    },
  };
  const FILA_2 = {
    number: "FAC - 2026-001",
    status: "cobrada",
    createdAt: new Date("2026-03-01T10:00:00Z"),
    paidAt: new Date("2026-03-05T12:00:00Z"),
    budget: {
      totalImpl: 121,
      totalMaint: 0,
      clientSnapshot: {},
      tenant: { name: "Bar Pepe" },
    },
  };

  beforeEach(() => {
    prismaMock.invoice.findMany.mockResolvedValue([FILA_1, FILA_2]);
    prismaMock.invoice.count.mockResolvedValue(2);
  });

  it("proyección FIJA: número, estado, total con IVA, cliente, alta y cobro", async () => {
    const res = await request("GET", "/service/operator/facturas", undefined, autorizado());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      facturas: [
        {
          number: "FAC - 2026-002",
          status: "pendiente",
          total: 266.2,
          clientName: "Peluquería Sol",
          createdAt: "2026-03-02T10:00:00.000Z",
          paidAt: null,
        },
        {
          number: "FAC - 2026-001",
          status: "cobrada",
          total: 121,
          clientName: "Bar Pepe",
          createdAt: "2026-03-01T10:00:00.000Z",
          paidAt: "2026-03-05T12:00:00.000Z",
        },
      ],
      total: 2,
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("no filtra ids, snapshots, líneas ni el presupuesto completo", async () => {
    const res = await request("GET", "/service/operator/facturas", undefined, autorizado());

    const fila = res.body.facturas[0];
    expect(Object.keys(fila).sort()).toEqual(["clientName", "createdAt", "number", "paidAt", "status", "total"]);
    const serializado = JSON.stringify(res.body);
    expect(serializado).not.toContain("bud_new");
    expect(serializado).not.toContain("inv_new");
    expect(serializado).not.toContain("clientSnapshot");
    expect(serializado).not.toContain("issuerSnapshot");
    expect(serializado).not.toContain("budget");
    expect(serializado).not.toContain("lines");
    expect(serializado).not.toContain("tenant");
  });

  it("selecciona en el servidor solo lo proyectado y ordena de forma estable", async () => {
    await request("GET", "/service/operator/facturas?limit=10&offset=0", undefined, autorizado());

    const args = asMock(prismaMock.invoice.findMany).mock.calls[0][0];
    expect(args.select).toEqual({
      number: true,
      status: true,
      createdAt: true,
      paidAt: true,
      budget: {
        select: {
          totalImpl: true,
          totalMaint: true,
          clientSnapshot: true,
          tenant: { select: { name: true } },
        },
      },
    });
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
  });

  it("pagina con limit/offset y devuelve metadatos coherentes", async () => {
    prismaMock.invoice.count.mockResolvedValue(3);
    prismaMock.invoice.findMany.mockResolvedValue([FILA_1]);

    const res = await request(
      "GET",
      "/service/operator/facturas?limit=1&offset=1",
      undefined,
      autorizado()
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, limit: 1, offset: 1, hasMore: true, nextOffset: 2 });
    const args = asMock(prismaMock.invoice.findMany).mock.calls[0][0];
    expect(args.skip).toBe(1);
    expect(args.take).toBe(1);
  });

  it("un offset más allá del final devuelve página vacía con metadatos", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([]);

    const res = await request(
      "GET",
      "/service/operator/facturas?limit=5&offset=40",
      undefined,
      autorizado()
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      facturas: [],
      total: 2,
      limit: 5,
      offset: 40,
      hasMore: false,
      nextOffset: null,
    });
  });

  it.each([
    ["limit=0", "/service/operator/facturas?limit=0"],
    ["limit=201", "/service/operator/facturas?limit=201"],
    ["offset=-1", "/service/operator/facturas?offset=-1"],
    ["parámetro desconocido", "/service/operator/facturas?campos=number"],
  ])("%s → 400 sin consultar la base", async (_nombre, url) => {
    const res = await request("GET", url, undefined, autorizado());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(prismaMock.invoice.findMany).not.toHaveBeenCalled();
    expect(prismaMock.invoice.count).not.toHaveBeenCalled();
  });

  it("deja UNA línea de auditoría de lectura, sin el token", async () => {
    await request("GET", "/service/operator/facturas?limit=5", undefined, autorizado());

    const lineas = asMock(logger.info).mock.calls;
    expect(lineas).toHaveLength(1);
    expect(lineas[0][0]).toMatchObject({
      ruta: "GET /service/operator/facturas",
      limit: "5",
      resultado: "ok",
      statusCode: 200,
    });
    expect(JSON.stringify(lineas)).not.toContain(TOKEN);
  });
});

// ── Lectura: GET /service/operator/presupuestos ──────────────────────────────
describe("GET /service/operator/presupuestos (lectura paginada)", () => {
  const FILA = {
    quoteNumber: "AD-2026-002",
    status: "aceptada",
    createdAt: new Date("2026-03-02T10:00:00Z"),
    totalImpl: 242,
    totalMaint: 24.2,
    clientSnapshot: { name: "Peluquería Sol" },
    tenant: { name: "Sol SL" },
  };

  beforeEach(() => {
    prismaMock.budget.findMany.mockResolvedValue([FILA]);
    prismaMock.budget.count.mockResolvedValue(1);
  });

  it("proyección FIJA: número, estado, total con IVA, cliente y alta", async () => {
    const res = await request("GET", "/service/operator/presupuestos", undefined, autorizado());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      presupuestos: [
        {
          quoteNumber: "AD-2026-002",
          status: "aceptada",
          total: 266.2,
          clientName: "Peluquería Sol",
          createdAt: "2026-03-02T10:00:00.000Z",
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    });
    expect(Object.keys(res.body.presupuestos[0]).sort()).toEqual([
      "clientName",
      "createdAt",
      "quoteNumber",
      "status",
      "total",
    ]);
  });

  it("no filtra ids, snapshots ni líneas", async () => {
    const res = await request("GET", "/service/operator/presupuestos", undefined, autorizado());
    const serializado = JSON.stringify(res.body);
    expect(serializado).not.toContain("clientSnapshot");
    expect(serializado).not.toContain("issuerSnapshot");
    expect(serializado).not.toContain("lines");
    expect(serializado).not.toContain("tenantId");
  });

  it("pagina y ordena igual que el resto de superficies de lectura", async () => {
    prismaMock.budget.count.mockResolvedValue(4);
    prismaMock.budget.findMany.mockResolvedValue([FILA]);

    const res = await request(
      "GET",
      "/service/operator/presupuestos?limit=2&offset=2",
      undefined,
      autorizado()
    );

    expect(res.body).toMatchObject({ total: 4, limit: 2, offset: 2, hasMore: true, nextOffset: 3 });
    const args = asMock(prismaMock.budget.findMany).mock.calls[0][0];
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
    expect(args.skip).toBe(2);
    expect(args.take).toBe(2);
  });

  it("limit fuera de rango → 400", async () => {
    const res = await request("GET", "/service/operator/presupuestos?limit=500", undefined, autorizado());
    expect(res.status).toBe(400);
    expect(prismaMock.budget.findMany).not.toHaveBeenCalled();
  });

  it("deja su propia línea de auditoría de lectura", async () => {
    await request("GET", "/service/operator/presupuestos", undefined, autorizado());
    const lineas = asMock(logger.info).mock.calls;
    expect(lineas).toHaveLength(1);
    expect(lineas[0][0]).toMatchObject({
      ruta: "GET /service/operator/presupuestos",
      resultado: "ok",
      statusCode: 200,
    });
  });
});

// ── POST (escritura) y GET (lectura) sobre el mismo segmento ─────────────────
describe("POST /facturas y GET /facturas conviven sin taparse", () => {
  it("POST /facturas llega a la escritura legacy (202) y NO deja línea de lectura", async () => {
    const res = await request("POST", "/service/operator/facturas", FACTURA, autorizado());

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ pendiente: true, accion: "agencia_crear_factura" });
    // La lectura vive en otro router: la escritura no se audita como lectura.
    expect(logger.info).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GET /facturas llega a la lectura de dominio, no al router legacy", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([]);
    prismaMock.invoice.count.mockResolvedValue(0);

    const res = await request("GET", "/service/operator/facturas", undefined, autorizado());

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      "facturas",
      "hasMore",
      "limit",
      "nextOffset",
      "offset",
      "total",
    ]);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("un POST a la ruta de presupuestos no existe (404 de la superficie)", async () => {
    const res = await request("POST", "/service/operator/presupuestos", {}, autorizado());
    expect(res.status).toBe(404);
  });
});

// ── Paridad con el generador existente de lib/codes.ts ───────────────────────
describe("paridad de numeración con el generador existente", () => {
  it("mismo número que lib/codes.ts para las mismas filas (una sola convención)", async () => {
    vi.setSystemTime(new Date("2026-05-05T10:00:00Z"));
    prismaMock.budget.findMany.mockResolvedValue([
      { quoteNumber: "AD-2026-001" },
      { quoteNumber: "AD-2026-007" },
    ]);

    expect(await nextQuoteNumber(prismaMock, new Date())).toBe("AD-2026-008");
    expect(await nextQuoteNumberLegacy()).toBe("AD-2026-008");
  });
});

// ── PRESERVE: el resto de la superficie del operador no cambia ───────────────
describe("PRESERVE: el resto de la superficie del operador no cambia", () => {
  it("POST /clientes sigue pidiendo confirmación (202) sin escribir", async () => {
    const res = await request("POST", "/service/operator/clientes", { nombre: "Uno más" }, autorizado());
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ pendiente: true, accion: "agencia_crear_cliente" });
    expect(prismaMock.tenant.create).not.toHaveBeenCalled();
  });

  it("GET /clientes sigue devolviendo el ARRAY legacy", async () => {
    prismaMock.tenant.findMany.mockResolvedValue([{ id: "ten_1", name: "Sol" }]);
    const res = await request("GET", "/service/operator/clientes", undefined, autorizado());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "ten_1", name: "Sol" }]);
  });
});
