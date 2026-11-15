/**
 * service-operator-conocimiento.test.ts — T7 (odd/tasks/mcp-plataforma-read-surface, S1/S8/S11).
 *
 * Superficie de LECTURA de conocimiento para el Operator Agent:
 *   GET /service/operator/conocimiento/fuentes  (fuentes paginadas de un agente, con nº de chunks)
 *   GET /service/operator/conocimiento/buscar    (búsqueda semántica acotada, reusa searchKnowledge)
 *
 * Mismo patrón de test que service-operator-agentes.test.ts: app Express real montado
 * en el prefijo de producción, `node:http` contra un puerto efímero, prisma/logger/
 * embeddings mockeados, fila completa "envenenada" (embedding + contenido completo) para
 * que el golden de claves demuestre que ninguna columna sensible puede filtrarse.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const prismaMock: any = {
    $queryRaw: vi.fn(),
    knowledgeChunk: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  };
  return { prisma: prismaMock };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// searchKnowledge se mockea para no llamar a la API de embeddings real.
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { searchKnowledge } from "@/lib/embeddings";
import {
  serviceOperatorConocimientoRouter,
  configurarRateLimiterBusqueda,
  resetRateLimiterBusqueda,
} from "@/routes/service-operator-conocimiento";

const TOKEN = "operator-conocimiento-secret-token-123";
const WRONG_TOKEN = "operator-conocimiento-token-que-no-es";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────
const FUENTES_FILAS = [
  { source: "https://a.example/docs", chunks: 3, contenido: "CONTENIDO-SECRETO-A", embedding: [0.1, 0.2] },
  { source: "https://b.example/docs", chunks: 1, contenido: "CONTENIDO-SECRETO-B", embedding: [0.3, 0.4] },
];
const TOTAL_FUENTES = 2;

const CONTENIDO_LARGO = "x".repeat(250);
const BUSQUEDA_FILA = {
  source: "https://a.example/docs",
  content: CONTENIDO_LARGO,
  distance: 0.2,
  embedding: [0.1, 0.2],
};

/** $queryRaw fake: distingue la consulta de conteo de la de página por su cabecera. */
function fakeQueryRaw() {
  return async (sql: unknown, ...params: unknown[]) => {
    const cabecera = Array.isArray(sql) ? String((sql as unknown[])[0]) : String(sql);
    if (cabecera.includes("COUNT(DISTINCT")) return [{ total: TOTAL_FUENTES }];
    // La página devuelve filas "envenenadas" con contenido/embedding: el router debe
    // mapear a { source, chunks } y descartar el resto.
    return FUENTES_FILAS.map((f) => ({ source: f.source, chunks: f.chunks, contenido: f.contenido, embedding: f.embedding }));
  };
}

// ── App de prueba: sólo el router nuevo, en su prefijo real ────────────────────
function buildApp() {
  const app = express();
  app.use("/service/operator/conocimiento", serviceOperatorConocimientoRouter);
  return app;
}

/** HTTP helper sin supertest (mismo patrón que service-operator-agentes.test.ts). */
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

/** Nombres de clave presentes en cualquier profundidad del cuerpo. */
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

/** Todas las líneas de auditoría con sus argumentos serializados. */
function lineasAuditoria(): string[] {
  return asMock(logger.info).mock.calls.map((c) => JSON.stringify(c));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPERATOR_SERVICE_TOKEN = TOKEN;
  asMock(prisma.$queryRaw).mockImplementation(fakeQueryRaw() as any);
  asMock(searchKnowledge).mockResolvedValue([BUSQUEDA_FILA]);
  configurarRateLimiterBusqueda(1000);
  resetRateLimiterBusqueda();
});

afterEach(() => {
  delete process.env.OPERATOR_SERVICE_TOKEN;
  configurarRateLimiterBusqueda(20);
  resetRateLimiterBusqueda();
});

// ── S8.1 — Auth ───────────────────────────────────────────────────────────────
describe("GET /service/operator/conocimiento — autenticación", () => {
  it("401 sin header x-service-token (fuentes)", async () => {
    const res = await get("/service/operator/conocimiento/fuentes?agentId=agt_1");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autorizado" });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("401 con token incorrecto (buscar)", async () => {
    const res = await get("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola", {
      "x-service-token": WRONG_TOKEN,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autorizado" });
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it("200 con el token válido", async () => {
    const res = await getAuth("/service/operator/conocimiento/fuentes?agentId=agt_1");
    expect(res.status).toBe(200);
    expect(res.body.fuentes).toHaveLength(TOTAL_FUENTES);
  });
});

// ── /fuentes — validación estricta ────────────────────────────────────────────
describe("GET /service/operator/conocimiento/fuentes — validación", () => {
  it("agentId requerido", async () => {
    const res = await getAuth("/service/operator/conocimiento/fuentes");
    expect(res.status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("agentId vacío se rechaza", async () => {
    const res = await getAuth("/service/operator/conocimiento/fuentes?agentId=");
    expect(res.status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("parámetro desconocido se rechaza (strict)", async () => {
    const res = await getAuth("/service/operator/conocimiento/fuentes?agentId=agt_1&foo=1");
    expect(res.status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("orderBy fuera del enum se rechaza", async () => {
    const res = await getAuth("/service/operator/conocimiento/fuentes?agentId=agt_1&orderBy=name");
    expect(res.status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(["limit=0", "limit=201", "offset=-1"])("%s se rechaza con 400", async (q) => {
    const res = await getAuth(`/service/operator/conocimiento/fuentes?agentId=agt_1&${q}`);
    expect(res.status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("por defecto pagina con limit 20 / offset 0 y ordena por source", async () => {
    const res = await getAuth("/service/operator/conocimiento/fuentes?agentId=agt_1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, limit: 20, offset: 0, hasMore: false, nextOffset: null });
    const llamadas = asMock(prisma.$queryRaw).mock.calls;
    // La página recibe agentId, limit y offset como parámetros interpolados.
    const pagina = llamadas.find((c) => !String((c[0] as unknown[])[0]).includes("COUNT(DISTINCT"));
    expect(pagina).toBeDefined();
    expect(pagina!.slice(1)).toEqual(["agt_1", 20, 0]);
  });
});

// ── /fuentes — paginación y proyección ────────────────────────────────────────
describe("GET /service/operator/conocimiento/fuentes — respuesta", () => {
  it("golden: claves exactas del sobre y de cada fuente", async () => {
    const res = await getAuth("/service/operator/conocimiento/fuentes?agentId=agt_1");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["fuentes", "hasMore", "limit", "nextOffset", "offset", "total"].sort()
    );
    expect(Object.keys(res.body.fuentes[0]).sort()).toEqual(["chunks", "source"]);
  });

  it("nunca filtra contenido ni embedding (filas envenenadas)", async () => {
    const res = await getAuth("/service/operator/conocimiento/fuentes?agentId=agt_1");
    const claves = clavesProfundas(res.body);
    expect(claves.has("embedding")).toBe(false);
    expect(claves.has("contenido")).toBe(false);
    expect(res.raw).not.toContain("CONTENIDO-SECRETO-A");
    expect(res.raw).not.toContain("[0.1,0.2]");
  });

  it("offset más allá del final devuelve página vacía con metadatos exactos", async () => {
    asMock(prisma.$queryRaw).mockImplementation(async (sql: unknown) => {
      const cabecera = Array.isArray(sql) ? String((sql as unknown[])[0]) : String(sql);
      if (cabecera.includes("COUNT(DISTINCT")) return [{ total: 2 }];
      return [];
    });
    const res = await getAuth("/service/operator/conocimiento/fuentes?agentId=agt_1&limit=10&offset=50");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fuentes: [], total: 2, limit: 10, offset: 50, hasMore: false, nextOffset: null });
  });

  it("total 0 devuelve página vacía con metadatos", async () => {
    asMock(prisma.$queryRaw).mockImplementation(async (sql: unknown) => {
      const cabecera = Array.isArray(sql) ? String((sql as unknown[])[0]) : String(sql);
      if (cabecera.includes("COUNT(DISTINCT")) return [{ total: 0 }];
      return [];
    });
    const res = await getAuth("/service/operator/conocimiento/fuentes?agentId=agt_1&limit=10");
    expect(res.body).toEqual({ fuentes: [], total: 0, limit: 10, offset: 0, hasMore: false, nextOffset: null });
  });
});

// ── /buscar — validación estricta ─────────────────────────────────────────────
describe("GET /service/operator/conocimiento/buscar — validación", () => {
  it("agentId requerido", async () => {
    const res = await getAuth("/service/operator/conocimiento/buscar?query=hola");
    expect(res.status).toBe(400);
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it("query requerido", async () => {
    const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1");
    expect(res.status).toBe(400);
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it("query vacío se rechaza", async () => {
    const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=");
    expect(res.status).toBe(400);
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it("query > 2000 caracteres se rechaza", async () => {
    const res = await getAuth(`/service/operator/conocimiento/buscar?agentId=agt_1&query=${"y".repeat(2001)}`);
    expect(res.status).toBe(400);
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it.each(["k=0", "k=21"])("%s se rechaza con 400", async (q) => {
    const res = await getAuth(`/service/operator/conocimiento/buscar?agentId=agt_1&query=hola&${q}`);
    expect(res.status).toBe(400);
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it("parámetro desconocido se rechaza (strict)", async () => {
    const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola&foo=1");
    expect(res.status).toBe(400);
    expect(searchKnowledge).not.toHaveBeenCalled();
  });
});

// ── /buscar — proyección y reuso de searchKnowledge ───────────────────────────
describe("GET /service/operator/conocimiento/buscar — respuesta", () => {
  it("reusa searchKnowledge con los argumentos correctos y k por defecto 5", async () => {
    const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola");
    expect(res.status).toBe(200);
    expect(searchKnowledge).toHaveBeenCalledWith("agt_1", "hola", 5);
  });

  it("k se respeta dentro de 1..20", async () => {
    const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola&k=3");
    expect(res.status).toBe(200);
    expect(searchKnowledge).toHaveBeenCalledWith("agt_1", "hola", 3);
  });

  it("golden: respuesta exacta { total, resultados } con proyección fija", async () => {
    const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["resultados", "total"]);
    expect(Object.keys(res.body.resultados[0]).sort()).toEqual(["similarity", "snippet", "source"]);
  });

  it("snippet <= 200 y similarity = round((1-distance)*100)", async () => {
    const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola");
    const resultado = res.body.resultados[0];
    expect(resultado.snippet).toBe("x".repeat(200));
    expect(resultado.similarity).toBe(80);
    expect(resultado.source).toBe("https://a.example/docs");
  });

  it("nunca expone el embedding ni el contenido completo", async () => {
    const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola");
    const claves = clavesProfundas(res.body);
    expect(claves.has("embedding")).toBe(false);
    expect(claves.has("content")).toBe(false);
    expect(claves.has("distance")).toBe(false);
    expect(res.raw).not.toContain("x".repeat(250));
  });

  it("total es la longitud devuelta, sin fabricar hasta k", async () => {
    asMock(searchKnowledge).mockResolvedValue([
      { source: "https://a.example", content: "contenido a", distance: 0.1 },
      { source: "https://b.example", content: "contenido b", distance: 0.3 },
    ]);
    const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola&k=5");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.resultados).toHaveLength(2);
  });
});

// ── Rate limiter local (S11: apiLimiter no cubre /service/*) ──────────────────
describe("GET /service/operator/conocimiento/buscar — rate limiter", () => {
  it("rechaza con 429 por encima del límite sin llamar a embeddings", async () => {
    configurarRateLimiterBusqueda(3);
    resetRateLimiterBusqueda();

    for (let i = 0; i < 3; i++) {
      const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola");
      expect(res.status).toBe(200);
    }
    expect(searchKnowledge).toHaveBeenCalledTimes(3);

    const res = await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola");
    expect(res.status).toBe(429);
    expect(searchKnowledge).toHaveBeenCalledTimes(3);
  });
});

// ── Superficie read-only ──────────────────────────────────────────────────────
describe("superficie sólo de lectura", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s /fuentes no existe", async (method) => {
    const res = await request(buildApp(), method, "/service/operator/conocimiento/fuentes", {
      "x-service-token": TOKEN,
    });
    expect(res.status).toBe(404);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s /buscar no existe", async (method) => {
    const res = await request(buildApp(), method, "/service/operator/conocimiento/buscar", {
      "x-service-token": TOKEN,
    });
    expect(res.status).toBe(404);
  });
});

// ── S8.8 — Auditoría ──────────────────────────────────────────────────────────
describe("auditoría de lectura", () => {
  it("una línea por lectura correcta, con ruta, paginación y resultado", async () => {
    await getAuth("/service/operator/conocimiento/fuentes?agentId=agt_1&limit=5&offset=10&orderBy=source");
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos, mensaje] = asMock(logger.info).mock.calls[0];
    expect(String(mensaje)).toContain("conocimiento");
    expect(campos).toMatchObject({
      ruta: "GET /service/operator/conocimiento/fuentes",
      limit: "5",
      offset: "10",
      orderBy: "source",
      resultado: "ok",
      statusCode: 200,
    });
  });

  it("el 401 también deja su línea, sin el token", async () => {
    await get("/service/operator/conocimiento/fuentes", { "x-service-token": WRONG_TOKEN });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos] = asMock(logger.info).mock.calls[0];
    expect(campos).toMatchObject({
      ruta: "GET /service/operator/conocimiento/fuentes",
      resultado: "error",
      statusCode: 401,
    });
  });

  it("ninguna línea de auditoría contiene el token", async () => {
    await getAuth("/service/operator/conocimiento/buscar?agentId=agt_1&query=hola&k=3");
    await get("/service/operator/conocimiento/fuentes", { "x-service-token": WRONG_TOKEN });
    const lineas = lineasAuditoria();
    expect(lineas).toHaveLength(2);
    for (const linea of lineas) {
      expect(linea).not.toContain(TOKEN);
      expect(linea).not.toContain(WRONG_TOKEN);
      expect(linea).not.toContain("x-service-token");
    }
  });
});
