/**
 * service-operator-canales.test.ts — T7 (odd/tasks/mcp-plataforma-read-surface, S1/S8/S11).
 *
 * Superficie de LECTURA de canales para el Operator Agent:
 *   GET /service/operator/canales            (lista cross-agent paginada)
 *   GET /service/operator/canales/:agentId   (mismas filas filtradas por agente)
 *
 * Mismo patrón de test que service-operator-agentes.test.ts: app Express real montado
 * en el prefijo de producción, `node:http` contra un puerto efímero, prisma/logger
 * mockeados, fila completa "envenenada" (credentials, webhookSecret, metadata) para
 * que el golden de claves demuestre que ninguna credencial puede filtrarse y que nada
 * se descifra en este camino.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const prismaMock: any = {
    channelConnection: { findMany: vi.fn(), count: vi.fn() },
  };
  return { prisma: prismaMock };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { serviceOperatorCanalesRouter } from "@/routes/service-operator-canales";

const TOKEN = "operator-canales-secret-token-123";
const WRONG_TOKEN = "operator-canales-token-que-no-es";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────
const CLAVES_CANAL = [
  "agentId",
  "botName",
  "botUsername",
  "createdAt",
  "id",
  "managedBy",
  "provider",
  "status",
  "statusDetail",
  "updatedAt",
];

const CLAVES_PROHIBIDAS = [
  "credentials",
  "webhookSecret",
  "metadata",
  "phoneNumberIdMasked",
  "webhookUrl",
  "token",
  "iv",
  "authTag",
];

// Fila COMPLETA de ChannelConnection con credenciales cifradas y metadata presentes.
const CANAL_FILA = {
  id: "conn_1",
  agentId: "agt_1",
  provider: "telegram",
  status: "active",
  statusDetail: "x".repeat(150),
  botName: "Bot Nombre",
  botUsername: "bot_username",
  createdAt: new Date("2026-02-01T10:00:00.000Z"),
  updatedAt: new Date("2026-02-02T10:00:00.000Z"),
  credentials: { iv: "iv-secreto", data: "cipher-secreto", authTag: "tag-secreto" },
  webhookSecret: "webhook-secret-que-no-debe-salir",
  metadata: { managedBy: "openclaw", otraClaveSecreta: "no-debe-salir" },
};

/** Proyecta la fila según el `select`, como haría Prisma. */
function proyectar(fila: Record<string, unknown>, select: Record<string, true>) {
  const out: Record<string, unknown> = {};
  for (const columna of Object.keys(select)) out[columna] = fila[columna];
  return out;
}

function buildApp() {
  const app = express();
  app.use("/service/operator/canales", serviceOperatorCanalesRouter);
  return app;
}

function request(
  app: express.Express,
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        { host: "127.0.0.1", port, method, path, headers },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            let body: any = null;
            try {
              body = data ? JSON.parse(data) : null;
            } catch {
              body = data;
            }
            setImmediate(() => resolve({ status: res.statusCode ?? 0, body, raw: data }));
          });
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      req.end();
    });
  });
}

const get = (path: string, headers: Record<string, string> = {}) =>
  request(buildApp(), "GET", path, headers);
const getAuth = (path: string) => get(path, { "x-service-token": TOKEN });

function clavesProfundas(value: any, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) clavesProfundas(v, acc);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      clavesProfundas(v, acc);
    }
  }
  return acc;
}

function lineasAuditoria(): string[] {
  return asMock(logger.info).mock.calls.map((c) => JSON.stringify(c));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPERATOR_SERVICE_TOKEN = TOKEN;
  asMock(prisma.channelConnection.findMany).mockImplementation(async (args: any) => [
    proyectar(CANAL_FILA, args.select),
  ]);
  asMock(prisma.channelConnection.count).mockResolvedValue(1);
});

afterEach(() => {
  delete process.env.OPERATOR_SERVICE_TOKEN;
});

// ── S8.1 — Auth ───────────────────────────────────────────────────────────────
describe("GET /service/operator/canales — autenticación", () => {
  it("401 sin header x-service-token", async () => {
    const res = await get("/service/operator/canales");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autorizado" });
    expect(prisma.channelConnection.findMany).not.toHaveBeenCalled();
  });

  it("401 con token incorrecto (por agente)", async () => {
    const res = await get("/service/operator/canales/agt_1", { "x-service-token": WRONG_TOKEN });
    expect(res.status).toBe(401);
    expect(prisma.channelConnection.findMany).not.toHaveBeenCalled();
  });

  it("200 con el token válido", async () => {
    const res = await getAuth("/service/operator/canales");
    expect(res.status).toBe(200);
    expect(res.body.canales).toHaveLength(1);
  });
});

// ── Validación estricta ───────────────────────────────────────────────────────
describe("GET /service/operator/canales — validación de query", () => {
  it("por defecto limit 20 / offset 0", async () => {
    const res = await getAuth("/service/operator/canales");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, limit: 20, offset: 0, hasMore: false, nextOffset: null });
    const args = asMock(prisma.channelConnection.findMany).mock.calls[0][0];
    expect(args.take).toBe(20);
    expect(args.skip).toBe(0);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
  });

  it.each(["limit=0", "limit=201", "offset=-1"])("%s se rechaza con 400", async (q) => {
    const res = await getAuth(`/service/operator/canales?${q}`);
    expect(res.status).toBe(400);
    expect(prisma.channelConnection.findMany).not.toHaveBeenCalled();
  });

  it("parámetro desconocido se rechaza (strict)", async () => {
    const res = await getAuth("/service/operator/canales?foo=1");
    expect(res.status).toBe(400);
    expect(prisma.channelConnection.findMany).not.toHaveBeenCalled();
  });

  it("orderBy no es un parámetro aceptado (strict)", async () => {
    const res = await getAuth("/service/operator/canales?orderBy=createdAt");
    expect(res.status).toBe(400);
    expect(prisma.channelConnection.findMany).not.toHaveBeenCalled();
  });
});

// ── Proyección fija ───────────────────────────────────────────────────────────
describe("GET /service/operator/canales — proyección", () => {
  it("golden: claves exactas del sobre y de cada canal", async () => {
    const res = await getAuth("/service/operator/canales");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["canales", "hasMore", "limit", "nextOffset", "offset", "total"].sort()
    );
    expect(Object.keys(res.body.canales[0]).sort()).toEqual([...CLAVES_CANAL].sort());
  });

  it("statusDetail se trunca a 120 caracteres", async () => {
    const res = await getAuth("/service/operator/canales");
    expect(res.body.canales[0].statusDetail).toBe("x".repeat(120));
  });

  it("managedBy se deriva de metadata sin exponer el objeto", async () => {
    const res = await getAuth("/service/operator/canales");
    expect(res.body.canales[0].managedBy).toBe("openclaw");
    expect(clavesProfundas(res.body).has("metadata")).toBe(false);
  });

  it("nunca selecciona credentials ni webhookSecret", async () => {
    await getAuth("/service/operator/canales");
    const args = asMock(prisma.channelConnection.findMany).mock.calls[0][0];
    expect(args.include).toBeUndefined();
    const columnas = Object.keys(args.select);
    expect(columnas).not.toContain("credentials");
    expect(columnas).not.toContain("webhookSecret");
  });

  it("nunca filtra credenciales ni metadata (fila envenenada)", async () => {
    const res = await getAuth("/service/operator/canales");
    const claves = clavesProfundas(res.body);
    for (const prohibida of CLAVES_PROHIBIDAS) {
      expect(claves.has(prohibida)).toBe(false);
    }
    expect(res.raw).not.toContain("iv-secreto");
    expect(res.raw).not.toContain("cipher-secreto");
    expect(res.raw).not.toContain("webhook-secret-que-no-debe-salir");
    expect(res.raw).not.toContain("no-debe-salir");
  });
});

// ── Paginación ────────────────────────────────────────────────────────────────
describe("GET /service/operator/canales — paginación", () => {
  it("offset más allá del final devuelve página vacía con metadatos exactos", async () => {
    asMock(prisma.channelConnection.findMany).mockResolvedValue([]);
    asMock(prisma.channelConnection.count).mockResolvedValue(3);
    const res = await getAuth("/service/operator/canales?offset=50&limit=20");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ canales: [], total: 3, limit: 20, offset: 50, hasMore: false, nextOffset: null });
  });

  it("cuenta el total con el mismo where que la página", async () => {
    await getAuth("/service/operator/canales");
    expect(asMock(prisma.channelConnection.count).mock.calls[0][0]).toEqual({ where: {} });
  });
});

// ── Por agente ────────────────────────────────────────────────────────────────
describe("GET /service/operator/canales/:agentId", () => {
  it("200 con las filas del agente y el sobre de paginación", async () => {
    const res = await getAuth("/service/operator/canales/agt_1");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["canales", "hasMore", "limit", "nextOffset", "offset", "total"].sort()
    );
    expect(res.body.canales[0].agentId).toBe("agt_1");
    expect(asMock(prisma.channelConnection.findMany).mock.calls[0][0].where).toEqual({ agentId: "agt_1" });
    expect(asMock(prisma.channelConnection.count).mock.calls[0][0]).toEqual({ where: { agentId: "agt_1" } });
  });

  it("404 cuando el agente no tiene conexiones", async () => {
    asMock(prisma.channelConnection.findMany).mockResolvedValue([]);
    asMock(prisma.channelConnection.count).mockResolvedValue(0);
    const res = await getAuth("/service/operator/canales/agt_sin_canales");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "El agente no tiene canales conectados" });
  });

  it("parámetro de query desconocido se rechaza con 400", async () => {
    const res = await getAuth("/service/operator/canales/agt_1?foo=1");
    expect(res.status).toBe(400);
    expect(prisma.channelConnection.findMany).not.toHaveBeenCalled();
  });
});

// ── Superficie read-only ──────────────────────────────────────────────────────
describe("superficie sólo de lectura", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s /canales no existe", async (method) => {
    const res = await request(buildApp(), method, "/service/operator/canales", {
      "x-service-token": TOKEN,
    });
    expect(res.status).toBe(404);
  });
});

// ── S8.8 — Auditoría ──────────────────────────────────────────────────────────
describe("auditoría de lectura", () => {
  it("una línea por lectura correcta, con ruta, paginación y resultado", async () => {
    await getAuth("/service/operator/canales?limit=5&offset=10");
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos, mensaje] = asMock(logger.info).mock.calls[0];
    expect(String(mensaje)).toContain("canales");
    expect(campos).toMatchObject({
      ruta: "GET /service/operator/canales",
      limit: "5",
      offset: "10",
      resultado: "ok",
      statusCode: 200,
    });
  });

  it("el 401 también deja su línea, sin el token", async () => {
    await get("/service/operator/canales", { "x-service-token": WRONG_TOKEN });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos] = asMock(logger.info).mock.calls[0];
    expect(campos).toMatchObject({ ruta: "GET /service/operator/canales", resultado: "error", statusCode: 401 });
  });

  it("ninguna línea de auditoría contiene el token", async () => {
    await getAuth("/service/operator/canales/agt_1");
    await get("/service/operator/canales", { "x-service-token": WRONG_TOKEN });
    const lineas = lineasAuditoria();
    expect(lineas).toHaveLength(2);
    for (const linea of lineas) {
      expect(linea).not.toContain(TOKEN);
      expect(linea).not.toContain(WRONG_TOKEN);
      expect(linea).not.toContain("x-service-token");
    }
  });
});
