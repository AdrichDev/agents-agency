/**
 * service-operator-landings.test.ts — T7 (odd/tasks/mcp-plataforma-read-surface, S1/S8/S11).
 *
 * Superficie de LECTURA de landings para el Operator Agent:
 *   GET /service/operator/landings       (paginado, ordenable, proyección seleccionable)
 *   GET /service/operator/landings/:id   (detalle con allowlist completa + qrUrl)
 *
 * Mismo patrón de test que service-operator-agentes.test.ts: app Express real montado
 * en el prefijo de producción, `node:http` contra un puerto efímero, prisma/logger
 * mockeados, fila completa "envenenada" (files, mobileFiles, answers, chatMessages,
 * generationPrompt, tenant) para que el golden de claves demuestre que no puede
 * filtrarse ninguna columna prohibida.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const prismaMock: any = {
    landingProject: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  };
  return { prisma: prismaMock };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { serviceOperatorLandingsRouter } from "@/routes/service-operator-landings";

const TOKEN = "operator-landings-secret-token-123";
const WRONG_TOKEN = "operator-landings-token-que-no-es";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────
const CLAVES_LISTA_DEFECTO = ["business", "id", "name", "status", "updatedAt"];
const CLAVES_DETALLE = [
  "business",
  "createdAt",
  "dbProvider",
  "id",
  "mobileStack",
  "name",
  "qrUrl",
  "status",
  "updatedAt",
];

const CLAVES_PROHIBIDAS = [
  "files",
  "mobileFiles",
  "answers",
  "chatMessages",
  "generationPrompt",
  "tenant",
  "prompt",
  "credenciales",
  "secret",
];

// Fila COMPLETA de LandingProject con todas las columnas prohibidas presentes.
const LANDING_FILA = {
  id: "land_1",
  name: "Landing Peluquería",
  business: "ten_1",
  status: "draft",
  dbProvider: "none",
  mobileStack: "expo",
  qrUrl: "https://qr.example/land_1",
  createdAt: new Date("2026-01-01T10:00:00.000Z"),
  updatedAt: new Date("2026-01-02T10:00:00.000Z"),
  files: { "index.html": "CONTENIDO-ARCHIVO-SECRETO" },
  mobileFiles: { "App.tsx": "CONTENIDO-MOVIL-SECRETO" },
  answers: { businessName: "Negocio Secreto" },
  chatMessages: [{ role: "user", content: "mensaje secreto" }],
  generationPrompt: "PROMPT-GENERACION-SECRETO",
  tenant: { id: "ten_1", name: "Tenant Secreto", codigo: "cli-secreto" },
};

/** Proyecta la fila según el `select`, como haría Prisma. */
function proyectar(fila: Record<string, unknown>, select: Record<string, true>) {
  const out: Record<string, unknown> = {};
  for (const columna of Object.keys(select)) out[columna] = fila[columna];
  return out;
}

function buildApp() {
  const app = express();
  app.use("/service/operator/landings", serviceOperatorLandingsRouter);
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
  asMock(prisma.landingProject.findMany).mockImplementation(async (args: any) => [
    proyectar(LANDING_FILA, args.select),
  ]);
  asMock(prisma.landingProject.findUnique).mockImplementation(async (args: any) =>
    args.where.id === "land_1" ? proyectar(LANDING_FILA, args.select) : null
  );
  asMock(prisma.landingProject.count).mockResolvedValue(1);
});

afterEach(() => {
  delete process.env.OPERATOR_SERVICE_TOKEN;
});

// ── S8.1 — Auth ───────────────────────────────────────────────────────────────
describe("GET /service/operator/landings — autenticación", () => {
  it("401 sin header x-service-token", async () => {
    const res = await get("/service/operator/landings");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autorizado" });
    expect(prisma.landingProject.findMany).not.toHaveBeenCalled();
  });

  it("401 con token incorrecto (detalle)", async () => {
    const res = await get("/service/operator/landings/land_1", { "x-service-token": WRONG_TOKEN });
    expect(res.status).toBe(401);
    expect(prisma.landingProject.findUnique).not.toHaveBeenCalled();
  });

  it("200 con el token válido", async () => {
    const res = await getAuth("/service/operator/landings");
    expect(res.status).toBe(200);
    expect(res.body.landings).toHaveLength(1);
  });
});

// ── Validación estricta ───────────────────────────────────────────────────────
describe("GET /service/operator/landings — validación de query", () => {
  it("por defecto limit 20 / offset 0, orderBy updatedAt desc", async () => {
    const res = await getAuth("/service/operator/landings");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, limit: 20, offset: 0, hasMore: false, nextOffset: null });
    const args = asMock(prisma.landingProject.findMany).mock.calls[0][0];
    expect(args.take).toBe(20);
    expect(args.skip).toBe(0);
    expect(args.orderBy).toEqual([{ updatedAt: "desc" }, { id: "asc" }]);
  });

  it.each(["limit=0", "limit=201", "offset=-1"])("%s se rechaza con 400", async (q) => {
    const res = await getAuth(`/service/operator/landings?${q}`);
    expect(res.status).toBe(400);
    expect(prisma.landingProject.findMany).not.toHaveBeenCalled();
  });

  it("parámetro desconocido se rechaza (strict)", async () => {
    const res = await getAuth("/service/operator/landings?foo=1");
    expect(res.status).toBe(400);
    expect(prisma.landingProject.findMany).not.toHaveBeenCalled();
  });

  it("orderBy fuera del enum se rechaza", async () => {
    expect((await getAuth("/service/operator/landings?orderBy=name")).status).toBe(400);
    expect(prisma.landingProject.findMany).not.toHaveBeenCalled();
  });

  it("orderBy=createdAt y dir=asc se aplican", async () => {
    const res = await getAuth("/service/operator/landings?orderBy=createdAt&dir=asc");
    expect(res.status).toBe(200);
    expect(asMock(prisma.landingProject.findMany).mock.calls[0][0].orderBy).toEqual([
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("dir fuera del enum se rechaza", async () => {
    expect((await getAuth("/service/operator/landings?dir=sideways")).status).toBe(400);
    expect(prisma.landingProject.findMany).not.toHaveBeenCalled();
  });

  it("campos vacío se rechaza", async () => {
    expect((await getAuth("/service/operator/landings?campos=")).status).toBe(400);
    expect(prisma.landingProject.findMany).not.toHaveBeenCalled();
  });

  it("campos con una columna prohibida se rechaza", async () => {
    expect((await getAuth("/service/operator/landings?campos=name,files")).status).toBe(400);
    expect(prisma.landingProject.findMany).not.toHaveBeenCalled();
  });

  it("campos con un valor desconocido se rechaza", async () => {
    expect((await getAuth("/service/operator/landings?campos=name,inventado")).status).toBe(400);
    expect(prisma.landingProject.findMany).not.toHaveBeenCalled();
  });
});

// ── Proyección ────────────────────────────────────────────────────────────────
describe("GET /service/operator/landings — proyección", () => {
  it("golden: proyección compacta por defecto", async () => {
    const res = await getAuth("/service/operator/landings");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["hasMore", "landings", "limit", "nextOffset", "offset", "total"].sort()
    );
    expect(Object.keys(res.body.landings[0]).sort()).toEqual([...CLAVES_LISTA_DEFECTO].sort());
  });

  it("campos selecciona un subconjunto exacto del allowlist", async () => {
    const res = await getAuth("/service/operator/landings?campos=name,createdAt");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.landings[0]).sort()).toEqual(["createdAt", "name"]);
    expect(Object.keys(asMock(prisma.landingProject.findMany).mock.calls[0][0].select).sort()).toEqual([
      "createdAt",
      "name",
    ]);
  });

  it("usa select y nunca include; ninguna columna prohibida en el select", async () => {
    await getAuth("/service/operator/landings");
    const args = asMock(prisma.landingProject.findMany).mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(args.select).toBeDefined();
    const columnas = Object.keys(args.select);
    for (const prohibida of ["files", "mobileFiles", "answers", "chatMessages", "generationPrompt", "tenant"]) {
      expect(columnas).not.toContain(prohibida);
    }
  });
});

// ── Paginación ────────────────────────────────────────────────────────────────
describe("GET /service/operator/landings — paginación", () => {
  it("offset más allá del final devuelve página vacía con metadatos exactos", async () => {
    asMock(prisma.landingProject.findMany).mockResolvedValue([]);
    asMock(prisma.landingProject.count).mockResolvedValue(3);
    const res = await getAuth("/service/operator/landings?offset=50&limit=20");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ landings: [], total: 3, limit: 20, offset: 50, hasMore: false, nextOffset: null });
  });

  it("hasMore/nextOffset señalan la página siguiente", async () => {
    asMock(prisma.landingProject.findMany).mockImplementation(async (args: any) =>
      Array.from({ length: 20 }, () => proyectar(LANDING_FILA, args.select))
    );
    asMock(prisma.landingProject.count).mockResolvedValue(45);
    const res = await getAuth("/service/operator/landings?offset=0&limit=20");
    expect(res.body).toMatchObject({ total: 45, limit: 20, offset: 0, hasMore: true, nextOffset: 20 });
  });
});

// ── Detalle ───────────────────────────────────────────────────────────────────
describe("GET /service/operator/landings/:id", () => {
  it("200 con allowlist completa (incluye qrUrl)", async () => {
    const res = await getAuth("/service/operator/landings/land_1");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...CLAVES_DETALLE].sort());
    expect(res.body.id).toBe("land_1");
    const args = asMock(prisma.landingProject.findUnique).mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(Object.keys(args.select).sort()).toEqual([...CLAVES_DETALLE].sort());
  });

  it("404 si la landing no existe", async () => {
    asMock(prisma.landingProject.findUnique).mockResolvedValue(null);
    const res = await getAuth("/service/operator/landings/no-existe");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Landing no encontrada" });
  });

  it("cualquier parámetro de query se rechaza con 400", async () => {
    const res = await getAuth("/service/operator/landings/land_1?campos=name");
    expect(res.status).toBe(400);
    expect(prisma.landingProject.findUnique).not.toHaveBeenCalled();
  });
});

// ── Higiene de respuesta ──────────────────────────────────────────────────────
describe("higiene de la respuesta", () => {
  it("ninguna clave sensible aparece en listado ni detalle", async () => {
    const listado = await getAuth("/service/operator/landings");
    const detalle = await getAuth("/service/operator/landings/land_1");

    for (const res of [listado, detalle]) {
      expect(res.status).toBe(200);
      const claves = clavesProfundas(res.body);
      for (const prohibida of CLAVES_PROHIBIDAS) {
        expect(claves.has(prohibida)).toBe(false);
      }
      expect(res.raw).not.toContain("CONTENIDO-ARCHIVO-SECRETO");
      expect(res.raw).not.toContain("CONTENIDO-MOVIL-SECRETO");
      expect(res.raw).not.toContain("PROMPT-GENERACION-SECRETO");
      expect(res.raw).not.toContain("Tenant Secreto");
    }
  });
});

// ── Superficie read-only ──────────────────────────────────────────────────────
describe("superficie sólo de lectura", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s /landings no existe", async (method) => {
    const res = await request(buildApp(), method, "/service/operator/landings", {
      "x-service-token": TOKEN,
    });
    expect(res.status).toBe(404);
  });
});

// ── S8.8 — Auditoría ──────────────────────────────────────────────────────────
describe("auditoría de lectura", () => {
  it("una línea por lectura correcta, con ruta, paginación y resultado", async () => {
    await getAuth("/service/operator/landings?limit=5&offset=10&orderBy=updatedAt&dir=asc");
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos, mensaje] = asMock(logger.info).mock.calls[0];
    expect(String(mensaje)).toContain("landings");
    expect(campos).toMatchObject({
      ruta: "GET /service/operator/landings",
      limit: "5",
      offset: "10",
      orderBy: "updatedAt",
      dir: "asc",
      resultado: "ok",
      statusCode: 200,
    });
  });

  it("el 401 también deja su línea, sin el token", async () => {
    await get("/service/operator/landings", { "x-service-token": WRONG_TOKEN });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos] = asMock(logger.info).mock.calls[0];
    expect(campos).toMatchObject({ ruta: "GET /service/operator/landings", resultado: "error", statusCode: 401 });
  });

  it("ninguna línea de auditoría contiene el token", async () => {
    await getAuth("/service/operator/landings");
    await get("/service/operator/landings", { "x-service-token": WRONG_TOKEN });
    const lineas = lineasAuditoria();
    expect(lineas).toHaveLength(2);
    for (const linea of lineas) {
      expect(linea).not.toContain(TOKEN);
      expect(linea).not.toContain(WRONG_TOKEN);
      expect(linea).not.toContain("x-service-token");
    }
  });
});
