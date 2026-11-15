/**
 * service-operator-mount-audit.test.ts — T7 B1 (odd/tasks/mcp-plataforma-read-surface, S8.8).
 *
 * Frontera auth/auditoría de la superficie de dominio del operador. Este archivo
 * prueba la COMPOSICIÓN REAL de src/index.ts, no routers aislados:
 *   · las seis rutas de dominio (conocimiento/fuentes, conocimiento/buscar,
 *     landings, landings/:id, canales, canales/:agentId),
 *   · el router legacy serviceOperatorRouter y la superficie de agentes,
 *   · el orden de montaje de producción.
 *
 * Contrato que se fija aquí:
 *   · 401 sin token y 401 con token incorrecto en cada una de las seis rutas, con
 *     EXACTAMENTE una línea de auditoría (el 401 temprano no puede morir en
 *     silencio) y sin ninguna lectura de Prisma ni de embeddings.
 *   · 200 autorizado, 400 rechazado y 500 fallido dejan EXACTAMENTE una línea
 *     final, con la ruta capturada en la entrada de la petición.
 *   · Ninguna línea lleva el token ni el texto de la búsqueda.
 *   · Las rutas legacy (POST /agentes, GET /agenda) siguen llegando a SU handler y
 *     no reciben auditoría nueva.
 *
 * El montaje se comparte con src/index.ts (routes/operator-domain-mounts.ts) para
 * que el orden probado no pueda divergir del de producción. Los mocks de prisma/
 * logger/embeddings evitan cualquier E/S real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => {
  const modelo = () => ({
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  return {
    prisma: {
      tenant: modelo(),
      prospectContact: modelo(),
      platformAppointment: modelo(),
      agent: modelo(),
      landingProject: modelo(),
      channelConnection: modelo(),
      budget: modelo(),
      invoice: modelo(),
      $queryRaw: vi.fn(),
    },
  };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/operator-audit", () => ({ writeOperatorAudit: vi.fn() }));
vi.mock("@/lib/agent/service", () => ({ createAgent: vi.fn() }));
vi.mock("@/lib/integrations/oauth", () => ({ getValidPlatformToken: vi.fn() }));
vi.mock("@/lib/integrations/calendar", () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeOperatorAudit } from "@/lib/operator-audit";
import { searchKnowledge } from "@/lib/embeddings";
import {
  configurarRateLimiterBusqueda,
  resetRateLimiterBusqueda,
} from "@/routes/service-operator-conocimiento";
import { montarSuperficieOperador } from "@/routes/operator-domain-mounts";
import { resetConfirmacionesPendientes } from "@/lib/operator-confirmations";

const TOKEN = "operator-mount-audit-secret-token-123";
const WRONG_TOKEN = "operator-mount-audit-token-que-no-es";
const TEXTO_BUSQUEDA = "secreto-de-negocio-no-loguear";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

// ── Composición REAL: la misma función que usa src/index.ts ───────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  montarSuperficieOperador(app);
  app.use((_req, res) => res.status(404).json({ error: "No encontrado" }));
  return app;
}

/** HTTP helper sin supertest (mismo patrón que el resto de la suite). */
function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
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
          headers: {
            ...headers,
            ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}),
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

const get = (path: string, headers: Record<string, string> = {}) =>
  request(buildApp(), "GET", path, undefined, headers);

/** Líneas de auditoría de lectura (sólo `logger.info`). */
function lineas(): Array<[Record<string, unknown>, string]> {
  return asMock(logger.info).mock.calls as Array<[Record<string, unknown>, string]>;
}

/** Comprueba que NINGÚN modelo ni el SQL crudo recibieron una lectura. */
function sinLecturas() {
  for (const nombre of ["tenant", "prospectContact", "platformAppointment", "agent", "landingProject", "channelConnection"]) {
    const modelo = (prisma as any)[nombre];
    for (const metodo of ["findMany", "count", "findUnique", "create", "update", "delete"]) {
      expect(modelo[metodo], `${nombre}.${metodo}`).not.toHaveBeenCalled();
    }
  }
  expect(prisma.$queryRaw).not.toHaveBeenCalled();
  expect(searchKnowledge).not.toHaveBeenCalled();
}

// ── Las seis rutas de dominio, con la ruta que debe quedar en la auditoría ────
const DOMINIOS = [
  {
    nombre: "conocimiento/fuentes",
    url: "/service/operator/conocimiento/fuentes?agentId=agt_1",
    ruta: "GET /service/operator/conocimiento/fuentes",
    prep: () => {
      asMock(prisma.$queryRaw).mockImplementation(async (sql: unknown) => {
        const cabecera = Array.isArray(sql) ? String((sql as unknown[])[0]) : String(sql);
        return cabecera.includes("COUNT(DISTINCT") ? [{ total: 1 }] : [{ source: "https://a.example", chunks: 2 }];
      });
    },
  },
  {
    nombre: "conocimiento/buscar",
    url: `/service/operator/conocimiento/buscar?agentId=agt_1&query=${TEXTO_BUSQUEDA}`,
    ruta: "GET /service/operator/conocimiento/buscar",
    prep: () => {
      asMock(searchKnowledge).mockResolvedValue([
        { source: "https://a.example", content: "fragmento", distance: 0.2 },
      ]);
    },
  },
  {
    nombre: "landings",
    url: "/service/operator/landings",
    ruta: "GET /service/operator/landings",
    prep: () => {
      asMock(prisma.landingProject.findMany).mockResolvedValue([]);
      asMock(prisma.landingProject.count).mockResolvedValue(0);
    },
  },
  {
    nombre: "landings/:id",
    url: "/service/operator/landings/land_1",
    ruta: "GET /service/operator/landings/land_1",
    prep: () => {
      asMock(prisma.landingProject.findUnique).mockResolvedValue({
        id: "land_1",
        name: "Landing",
        business: null,
        status: "draft",
        dbProvider: "none",
        mobileStack: null,
        qrUrl: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
    },
  },
  {
    nombre: "canales",
    url: "/service/operator/canales",
    ruta: "GET /service/operator/canales",
    prep: () => {
      asMock(prisma.channelConnection.findMany).mockResolvedValue([]);
      asMock(prisma.channelConnection.count).mockResolvedValue(0);
    },
  },
  {
    nombre: "canales/:agentId",
    url: "/service/operator/canales/agt_1",
    ruta: "GET /service/operator/canales/agt_1",
    prep: () => {
      asMock(prisma.channelConnection.findMany).mockResolvedValue([
        {
          id: "conn_1",
          agentId: "agt_1",
          provider: "telegram",
          status: "active",
          statusDetail: null,
          botName: "Bot",
          botUsername: "bot",
          metadata: {},
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ]);
      asMock(prisma.channelConnection.count).mockResolvedValue(1);
    },
  },
  // S17: la LECTURA de facturas vive en su router de dominio y la ESCRITURA
  // (POST /facturas, agencia_crear_factura) sigue en el legacy. Mismo segmento.
  {
    nombre: "facturas",
    url: "/service/operator/facturas",
    ruta: "GET /service/operator/facturas",
    prep: () => {
      asMock(prisma.invoice.findMany).mockResolvedValue([]);
      asMock(prisma.invoice.count).mockResolvedValue(0);
    },
  },
  {
    nombre: "presupuestos",
    url: "/service/operator/presupuestos",
    ruta: "GET /service/operator/presupuestos",
    prep: () => {
      asMock(prisma.budget.findMany).mockResolvedValue([]);
      asMock(prisma.budget.count).mockResolvedValue(0);
    },
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPERATOR_SERVICE_TOKEN = TOKEN;
  // S14: la escritura legacy pide confirmación humana enviando botones por Telegram.
  process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN = "bot-token-de-pruebas";
  process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID = "123456789";
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ ok: true }) })));
  resetConfirmacionesPendientes();
  configurarRateLimiterBusqueda(1000);
  resetRateLimiterBusqueda();
  for (const d of DOMINIOS) d.prep();
});

afterEach(() => {
  delete process.env.OPERATOR_SERVICE_TOKEN;
  delete process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN;
  delete process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID;
  vi.unstubAllGlobals();
  resetConfirmacionesPendientes();
  configurarRateLimiterBusqueda(20);
  resetRateLimiterBusqueda();
});

// ── 401 temprano: una línea, sin lecturas ────────────────────────────────────
describe("401 temprano auditado — sin token", () => {
  it.each(DOMINIOS)("$nombre → 401 con exactamente una línea", async (d) => {
    const res = await get(d.url);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autorizado" });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos] = lineas()[0];
    expect(campos).toMatchObject({ ruta: d.ruta, resultado: "error", statusCode: 401 });
    sinLecturas();
  });
});

describe("401 temprano auditado — token incorrecto", () => {
  it.each(DOMINIOS)("$nombre → 401 con exactamente una línea", async (d) => {
    const res = await get(d.url, { "x-service-token": WRONG_TOKEN });
    expect(res.status).toBe(401);
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos] = lineas()[0];
    expect(campos).toMatchObject({ ruta: d.ruta, resultado: "error", statusCode: 401 });
    sinLecturas();
  });
});

// ── 200 autorizado: una línea final ──────────────────────────────────────────
describe("200 autorizado — exactamente una línea", () => {
  it.each(DOMINIOS)("$nombre → 200 con una línea ok", async (d) => {
    const res = await get(d.url, { "x-service-token": TOKEN });
    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos] = lineas()[0];
    expect(campos).toMatchObject({ ruta: d.ruta, resultado: "ok", statusCode: 200 });
  });
});

// ── 400 y 500: una línea final cada uno ──────────────────────────────────────
describe("400 rechazado — exactamente una línea", () => {
  const CASOS = [
    { nombre: "conocimiento/fuentes", url: "/service/operator/conocimiento/fuentes?agentId=agt_1&limit=0", ruta: "GET /service/operator/conocimiento/fuentes" },
    { nombre: "landings", url: "/service/operator/landings?limit=0", ruta: "GET /service/operator/landings" },
    { nombre: "canales", url: "/service/operator/canales?limit=0", ruta: "GET /service/operator/canales" },
    { nombre: "facturas", url: "/service/operator/facturas?limit=0", ruta: "GET /service/operator/facturas" },
    { nombre: "presupuestos", url: "/service/operator/presupuestos?limit=0", ruta: "GET /service/operator/presupuestos" },
  ] as const;

  it.each(CASOS)("$nombre → 400 con una línea", async (c) => {
    const res = await get(c.url, { "x-service-token": TOKEN });
    expect(res.status).toBe(400);
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos] = lineas()[0];
    expect(campos).toMatchObject({ ruta: c.ruta, resultado: "error", statusCode: 400 });
  });
});

describe("500 fallido — exactamente una línea", () => {
  it("conocimiento/fuentes → 500 con una línea", async () => {
    asMock(prisma.$queryRaw).mockRejectedValue(new Error("db down"));
    const res = await get("/service/operator/conocimiento/fuentes?agentId=agt_1", { "x-service-token": TOKEN });
    expect(res.status).toBe(500);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(lineas()[0][0]).toMatchObject({ ruta: "GET /service/operator/conocimiento/fuentes", resultado: "error", statusCode: 500 });
  });

  it("landings → 500 con una línea", async () => {
    asMock(prisma.landingProject.findMany).mockRejectedValue(new Error("db down"));
    const res = await get("/service/operator/landings", { "x-service-token": TOKEN });
    expect(res.status).toBe(500);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(lineas()[0][0]).toMatchObject({ ruta: "GET /service/operator/landings", resultado: "error", statusCode: 500 });
  });

  it("canales → 500 con una línea", async () => {
    asMock(prisma.channelConnection.findMany).mockRejectedValue(new Error("db down"));
    const res = await get("/service/operator/canales", { "x-service-token": TOKEN });
    expect(res.status).toBe(500);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(lineas()[0][0]).toMatchObject({ ruta: "GET /service/operator/canales", resultado: "error", statusCode: 500 });
  });

  it("facturas → 500 con una línea", async () => {
    asMock(prisma.invoice.findMany).mockRejectedValue(new Error("db down"));
    const res = await get("/service/operator/facturas", { "x-service-token": TOKEN });
    expect(res.status).toBe(500);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(lineas()[0][0]).toMatchObject({ ruta: "GET /service/operator/facturas", resultado: "error", statusCode: 500 });
  });

  it("presupuestos → 500 con una línea", async () => {
    asMock(prisma.budget.findMany).mockRejectedValue(new Error("db down"));
    const res = await get("/service/operator/presupuestos", { "x-service-token": TOKEN });
    expect(res.status).toBe(500);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(lineas()[0][0]).toMatchObject({ ruta: "GET /service/operator/presupuestos", resultado: "error", statusCode: 500 });
  });
});

// ── Rutas legacy intactas y sin auditoría nueva ──────────────────────────────
describe("rutas legacy intactas, sin auditoría nueva", () => {
  it("GET /service/operator/agenda sigue en su handler y no audita", async () => {
    asMock(prisma.platformAppointment.findMany).mockResolvedValue([]);
    const res = await get("/service/operator/agenda", { "x-service-token": TOKEN });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["citas", "desde", "hasta", "total"]);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("POST /service/operator/agentes sigue en su handler y no audita", async () => {
    const res = await request(
      buildApp(),
      "POST",
      "/service/operator/agentes",
      { name: "Agente", sector: "retail", systemPrompt: "Eres útil" },
      { "x-service-token": TOKEN }
    );
    // El 202 con acción pendiente lo produce SÓLO el handler legacy de escritura (S14).
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ pendiente: true, accion: "agencia_crear_agente" });
    expect(writeOperatorAudit).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("la superficie de agentes (T1) sigue montada y auditando su propia ruta", async () => {
    asMock(prisma.agent.findMany).mockResolvedValue([]);
    asMock(prisma.agent.count).mockResolvedValue(0);
    const res = await get("/service/operator/agentes?limit=1", { "x-service-token": TOKEN });
    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(lineas()[0][0]).toMatchObject({ ruta: "GET /service/operator/agentes" });
  });
});

// ── S17: /facturas comparte segmento entre escritura (legacy) y lectura ──────
describe("POST /facturas (escritura legacy) y GET /facturas (lectura) no se tapan", () => {
  it("POST /facturas llega al handler legacy de escritura y no deja línea de lectura", async () => {
    asMock(prisma.tenant.findUnique).mockResolvedValue({
      id: "ten_1",
      name: "Peluquería Sol",
      razonSocial: null,
      nif: null,
      direccion: null,
      email: null,
      phone: null,
      contactPerson: null,
      isActive: true,
    });

    const res = await request(
      buildApp(),
      "POST",
      "/service/operator/facturas",
      {
        clienteId: "ten_1",
        lineas: [{ concepto: "Web", cantidad: 1, precioImplantacion: 100 }],
      },
      { "x-service-token": TOKEN }
    );

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ pendiente: true, accion: "agencia_crear_factura" });
    // Una escritura no es una lectura: la auditoría de lectura no se dispara.
    expect(logger.info).not.toHaveBeenCalled();
    // Nada se escribe antes de confirmar.
    expect(prisma.budget.create).not.toHaveBeenCalled();
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it("GET /facturas lo resuelve el router de dominio (una línea de lectura)", async () => {
    asMock(prisma.invoice.findMany).mockResolvedValue([]);
    asMock(prisma.invoice.count).mockResolvedValue(0);

    const res = await get("/service/operator/facturas", { "x-service-token": TOKEN });

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
    expect(lineas()[0][0]).toMatchObject({ ruta: "GET /service/operator/facturas", resultado: "ok" });
  });

  it("GET /presupuestos lo resuelve su router de dominio (una línea de lectura)", async () => {
    asMock(prisma.budget.findMany).mockResolvedValue([]);
    asMock(prisma.budget.count).mockResolvedValue(0);

    const res = await get("/service/operator/presupuestos", { "x-service-token": TOKEN });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      "hasMore",
      "limit",
      "nextOffset",
      "offset",
      "presupuestos",
      "total",
    ]);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("un POST en la ruta de lectura de presupuestos no existe (404)", async () => {
    const res = await request(buildApp(), "POST", "/service/operator/presupuestos", {}, { "x-service-token": TOKEN });
    expect(res.status).toBe(404);
    expect(logger.info).not.toHaveBeenCalled();
  });
});

// ── Higiene de la línea de auditoría ─────────────────────────────────────────
describe("higiene de la línea de auditoría", () => {
  it("no lleva el token, ni cabeceras, ni el texto de la búsqueda", async () => {
    await get(`/service/operator/conocimiento/buscar?agentId=agt_1&query=${TEXTO_BUSQUEDA}`, {
      "x-service-token": TOKEN,
    });
    await get("/service/operator/canales", { "x-service-token": WRONG_TOKEN });
    const serializado = JSON.stringify(lineas());
    expect(serializado).not.toContain(TOKEN);
    expect(serializado).not.toContain(WRONG_TOKEN);
    expect(serializado).not.toContain("x-service-token");
    expect(serializado).not.toContain(TEXTO_BUSQUEDA);
  });
});
