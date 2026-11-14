/**
 * service-operator-agentes.test.ts — T1 (odd/tasks/mcp-plataforma-read-surface, S1/S5/S7/S8).
 *
 * Superficie de LECTURA de agentes para el Operator Agent:
 *   GET /service/operator/agentes        (paginado, ordenable, proyección seleccionable)
 *   GET /service/operator/agentes/:id    (detalle)
 *
 * Los 8 candados de S8 se prueban aquí de punta a punta, sobre un app Express real
 * montado con el router nuevo (mismo patrón HTTP que tests/auth-gate.test.ts: sin
 * supertest, `node:http` contra un puerto efímero) y con prisma/logger mockeados:
 *   1. 401 sin token / 401 con token incorrecto / 200 con el válido (requireOperatorToken).
 *   2. Router propio: se monta solo, sin tocar service-operator.ts.
 *   3. `select` fijo server-side, sin `include` y sin columnas del cliente (se inspecciona
 *      el argumento real que recibe prisma.agent.findMany).
 *   4. Validación estricta: parámetros desconocidos, limit, offset y orderBy acotados.
 *   5. Conjunto EXACTO de claves (golden) + ninguna clave sensible en ninguna respuesta.
 *   6. `listAgents()` (el include pesado) no se llama nunca.
 *   8. Una línea de auditoría por lectura, sin token.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const prismaMock: any = {
    agent: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  };
  return { prisma: prismaMock };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// S8.6: el servicio pesado (tenant/integrations/channels/counts) no debe usarse.
vi.mock("@/lib/agent/service", () => ({ listAgents: vi.fn() }));

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listAgents } from "@/lib/agent/service";
import { serviceOperatorAgentesRouter } from "@/routes/service-operator-agentes";

const TOKEN = "operator-agentes-secret-token-123";
const WRONG_TOKEN = "operator-agentes-token-que-no-es";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

// Proyección por defecto del listado (golden: si aparece una clave nueva, este
// test se pone rojo antes de que la columna salga en producción).
const CLAVES_LISTADO_DEFECTO = [
  "createdAt",
  "id",
  "model",
  "name",
  "runtime",
  "sector",
  "status",
  "updatedAt",
];

// Proyección del detalle = allowlist completo del servidor (golden).
const CLAVES_DETALLE = [
  "channel",
  "createdAt",
  "id",
  "model",
  "name",
  "publishedAt",
  "runtime",
  "sector",
  "status",
  "statusChangedAt",
  "tenantId",
  "updatedAt",
];

// Columnas que NUNCA pueden viajar al operador: secretos, prompts, configuración
// de widget, integraciones, cupos y knobs de comportamiento.
const CLAVES_PROHIBIDAS = [
  "systemPrompt",
  "prompt_sistema",
  "widgetTemplateConfig",
  "widgetAvatarBase64",
  "widgetAvatarUrl",
  "widgetPrimaryColor",
  "widgetSecondaryColor",
  "widgetAvatarEmoji",
  "widgetInstalledAt",
  "widgetLastSeenAt",
  "ecommerceConfig",
  "publicKey",
  "tokenQuotaOverride",
  "inboundBufferMs",
  "replyMaxMessages",
  "replySplitPauseMs",
  "temperature",
  "reasoningEffort",
  "integrations",
  "channelConnections",
  "conversations",
  "knowledge",
  "apiKey",
  "secret",
  "password",
  "token",
];

/**
 * Fila de Agent COMPLETA, con las columnas prohibidas incluidas. El mock de prisma
 * proyecta esta fila según el `select` que pida el router, igual que haría la BD:
 * si el router seleccionara una columna prohibida, saldría en la respuesta y los
 * tests golden y de higiene se pondrían rojos.
 */
const AGENTE_FILA = {
  id: "agt_1",
  name: "Peluquería Sol",
  sector: "belleza",
  status: "published",
  runtime: "openai",
  model: "gpt-5.6-luna",
  channel: "widget",
  publishedAt: new Date("2026-01-10T10:05:00.000Z"),
  statusChangedAt: new Date("2026-01-10T10:05:00.000Z"),
  createdAt: new Date("2026-01-10T10:00:00.000Z"),
  updatedAt: new Date("2026-01-11T10:00:00.000Z"),
  tenantId: "ten_1",
  // Columnas que esta superficie no puede devolver nunca.
  systemPrompt: "PROMPT-SECRETO-DEL-AGENTE",
  widgetTemplateConfig: { webhook: "https://interno.example/hook" },
  widgetAvatarBase64: "data:image/png;base64,AAAA",
  widgetAvatarUrl: "https://cdn.example/avatar.png",
  widgetPrimaryColor: "#4f46e5",
  widgetSecondaryColor: "#9333ea",
  widgetAvatarEmoji: "🤖",
  widgetInstalledAt: new Date("2026-01-12T10:00:00.000Z"),
  widgetLastSeenAt: new Date("2026-01-13T10:00:00.000Z"),
  ecommerceConfig: { apiKey: "sk-live-no-debe-salir" },
  publicKey: "clave-publica-del-agente",
  tokenQuotaOverride: 1000,
  inboundBufferMs: 0,
  replyMaxMessages: 1,
  replySplitPauseMs: 0,
  temperature: 0.7,
  reasoningEffort: "low",
};

/** Proyecta la fila según el `select`, como haría Prisma. */
function proyectar(fila: Record<string, unknown>, select: Record<string, true>) {
  const out: Record<string, unknown> = {};
  for (const columna of Object.keys(select)) out[columna] = fila[columna];
  return out;
}

// ── App de prueba: solo el router nuevo, en su prefijo real ────────────────────
function buildApp() {
  const app = express();
  app.use("/service/operator/agentes", serviceOperatorAgentesRouter);
  return app;
}

/** HTTP helper (sin supertest — mismo patrón que tests/auth-gate.test.ts). */
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
            // La línea de auditoría se escribe en `res.on("finish")`: se cede un
            // tick para que el log esté disponible antes de las aserciones.
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
const getAuthed = (path: string) => get(path, { "x-service-token": TOKEN });

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
  asMock(prisma.agent.findMany).mockImplementation(async (args: any) => [proyectar(AGENTE_FILA, args.select)]);
  asMock(prisma.agent.count).mockResolvedValue(1);
  asMock(prisma.agent.findUnique).mockImplementation(async (args: any) =>
    args.where.id === "agt_1" ? proyectar(AGENTE_FILA, args.select) : null
  );
});

afterEach(() => {
  delete process.env.OPERATOR_SERVICE_TOKEN;
});

// ── S8.1 — Auth: sólo el service token del operador ───────────────────────────
describe("GET /service/operator/agentes — autenticación", () => {
  it("401 sin header x-service-token", async () => {
    const res = await get("/service/operator/agentes");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autorizado" });
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("401 con token incorrecto", async () => {
    const res = await get("/service/operator/agentes", { "x-service-token": WRONG_TOKEN });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autorizado" });
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("401 también en el detalle sin token", async () => {
    const res = await get("/service/operator/agentes/agt_1");
    expect(res.status).toBe(401);
    expect(prisma.agent.findUnique).not.toHaveBeenCalled();
  });

  it("200 con el token válido", async () => {
    const res = await getAuthed("/service/operator/agentes");
    expect(res.status).toBe(200);
    expect(res.body.agentes).toHaveLength(1);
  });
});

// ── S8.4 — Validación estricta de la query ────────────────────────────────────
describe("GET /service/operator/agentes — validación de query", () => {
  it("limit por defecto 20 y offset por defecto 0", async () => {
    const res = await getAuthed("/service/operator/agentes");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ limit: 20, offset: 0, total: 1, hasMore: false });
    expect(prisma.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, skip: 0 })
    );
  });

  it("limit=100 (máximo duro) se acepta", async () => {
    const res = await getAuthed("/service/operator/agentes?limit=100");
    expect(res.status).toBe(200);
    expect(prisma.agent.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("limit=0 se rechaza con 400", async () => {
    const res = await getAuthed("/service/operator/agentes?limit=0");
    expect(res.status).toBe(400);
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("limit=101 se rechaza con 400", async () => {
    const res = await getAuthed("/service/operator/agentes?limit=101");
    expect(res.status).toBe(400);
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("limit no entero o negativo se rechaza con 400", async () => {
    expect((await getAuthed("/service/operator/agentes?limit=-1")).status).toBe(400);
    expect((await getAuthed("/service/operator/agentes?limit=2.5")).status).toBe(400);
    expect((await getAuthed("/service/operator/agentes?limit=abc")).status).toBe(400);
  });

  it("offset negativo se rechaza; offset válido se respeta", async () => {
    expect((await getAuthed("/service/operator/agentes?offset=-1")).status).toBe(400);
    const ok = await getAuthed("/service/operator/agentes?offset=40&limit=10");
    expect(ok.status).toBe(200);
    expect(prisma.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 10 })
    );
  });

  it("orderBy sólo admite createdAt", async () => {
    expect((await getAuthed("/service/operator/agentes?orderBy=name")).status).toBe(400);
    expect((await getAuthed("/service/operator/agentes?orderBy=status")).status).toBe(400);
  });

  it("por defecto ordena por createdAt descendente (S5: 'el último agente' en una llamada)", async () => {
    const res = await getAuthed("/service/operator/agentes?limit=1");
    expect(res.status).toBe(200);
    expect(prisma.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" }, take: 1 })
    );
  });

  it("dir=asc se aplica", async () => {
    const res = await getAuthed("/service/operator/agentes?orderBy=createdAt&dir=asc");
    expect(res.status).toBe(200);
    expect(prisma.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "asc" } })
    );
  });

  it("parámetro de query desconocido se rechaza con 400", async () => {
    const res = await getAuthed("/service/operator/agentes?foo=1");
    expect(res.status).toBe(400);
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("un parámetro con nombre de columna del modelo se rechaza, no se usa como filtro", async () => {
    const res = await getAuthed("/service/operator/agentes?systemPrompt=x");
    expect(res.status).toBe(400);
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("intento de inyectar un select por query se rechaza", async () => {
    const res = await getAuthed("/service/operator/agentes?select[systemPrompt]=1");
    expect(res.status).toBe(400);
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("el detalle rechaza cualquier parámetro de query", async () => {
    const res = await getAuthed("/service/operator/agentes/agt_1?campos=name");
    expect(res.status).toBe(400);
    expect(prisma.agent.findUnique).not.toHaveBeenCalled();
  });
});

// ── S8.3 + S8.5 — Proyección fija, sin include, sin columnas del cliente ──────
describe("proyección de la lectura", () => {
  it("el listado devuelve EXACTAMENTE las claves por defecto (golden)", async () => {
    const res = await getAuthed("/service/operator/agentes");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["agentes", "hasMore", "limit", "offset", "total"].sort()
    );
    expect(Object.keys(res.body.agentes[0]).sort()).toEqual([...CLAVES_LISTADO_DEFECTO].sort());
  });

  it("el detalle devuelve EXACTAMENTE el allowlist completo (golden)", async () => {
    const res = await getAuthed("/service/operator/agentes/agt_1");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...CLAVES_DETALLE].sort());
  });

  it("usa select y nunca include; ninguna columna sensible en el select", async () => {
    await getAuthed("/service/operator/agentes");
    const args = asMock(prisma.agent.findMany).mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(args.select).toBeDefined();
    const columnas = Object.keys(args.select);
    expect(columnas).not.toContain("systemPrompt");
    for (const prohibida of CLAVES_PROHIBIDAS) {
      expect(columnas).not.toContain(prohibida);
    }
    // Sólo columnas del allowlist del servidor.
    for (const col of columnas) expect(CLAVES_DETALLE).toContain(col);
  });

  it("campos selecciona un subconjunto exacto del allowlist", async () => {
    const res = await getAuthed("/service/operator/agentes?campos=name,createdAt");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.agentes[0]).sort()).toEqual(["createdAt", "name"]);
    expect(Object.keys(asMock(prisma.agent.findMany).mock.calls[0][0].select).sort()).toEqual([
      "createdAt",
      "name",
    ]);
  });

  it("campos con un valor fuera del enum se rechaza con 400", async () => {
    const res = await getAuthed("/service/operator/agentes?campos=name,systemPrompt");
    expect(res.status).toBe(400);
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("campos vacío se rechaza con 400", async () => {
    const res = await getAuthed("/service/operator/agentes?campos=");
    expect(res.status).toBe(400);
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("S8.6: no se usa el listAgents() pesado", async () => {
    await getAuthed("/service/operator/agentes");
    await getAuthed("/service/operator/agentes/agt_1");
    expect(listAgents).not.toHaveBeenCalled();
  });
});

// ── Paginación ────────────────────────────────────────────────────────────────
describe("paginación", () => {
  it("offset más allá del final devuelve página vacía con metadatos correctos", async () => {
    asMock(prisma.agent.findMany).mockResolvedValue([]);
    asMock(prisma.agent.count).mockResolvedValue(3);

    const res = await getAuthed("/service/operator/agentes?offset=50&limit=20");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ agentes: [], total: 3, limit: 20, offset: 50, hasMore: false });
  });

  it("hasMore=true cuando quedan filas detrás de la página", async () => {
    asMock(prisma.agent.count).mockResolvedValue(45);
    const res = await getAuthed("/service/operator/agentes?offset=0&limit=20");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 45, limit: 20, offset: 0, hasMore: true });
  });

  it("cuenta el total con el mismo where que la página", async () => {
    await getAuthed("/service/operator/agentes");
    expect(prisma.agent.count).toHaveBeenCalledWith({ where: {} });
  });
});

// ── Detalle ───────────────────────────────────────────────────────────────────
describe("GET /service/operator/agentes/:id", () => {
  it("200 con el agente", async () => {
    const res = await getAuthed("/service/operator/agentes/agt_1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("agt_1");
    expect(prisma.agent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "agt_1" } })
    );
    const args = asMock(prisma.agent.findUnique).mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(Object.keys(args.select)).not.toContain("systemPrompt");
  });

  it("404 si el agente no existe", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(null);
    const res = await getAuthed("/service/operator/agentes/no-existe");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Agente no encontrado" });
  });
});

// ── S8.5 (segunda mitad) — Ninguna clave sensible en ninguna respuesta ────────
describe("higiene de la respuesta", () => {
  it("ninguna clave sensible aparece en el listado ni en el detalle", async () => {
    const listado = await getAuthed("/service/operator/agentes");
    const detalle = await getAuthed("/service/operator/agentes/agt_1");

    for (const res of [listado, detalle]) {
      expect(res.status).toBe(200);
      const claves = clavesProfundas(res.body);
      for (const prohibida of CLAVES_PROHIBIDAS) {
        expect(claves.has(prohibida)).toBe(false);
      }
      // Y tampoco el token del servicio ni el prompt del agente.
      expect(res.raw).not.toContain(TOKEN);
      expect(res.raw).not.toContain("PROMPT-SECRETO-DEL-AGENTE");
      expect(res.raw).not.toContain("sk-live-no-debe-salir");
    }
  });
});

// ── Superficie read-only ──────────────────────────────────────────────────────
describe("superficie sólo de lectura", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s /agentes no existe", async (method) => {
    const res = await request(buildApp(), method, "/service/operator/agentes", {
      "x-service-token": TOKEN,
    });
    expect(res.status).toBe(404);
  });
});

// ── Montaje real (src/index.ts) ───────────────────────────────────────────────
// En index.ts el router nuevo se monta DESPUÉS de serviceOperatorRouter, bajo el
// mismo prefijo /service/operator. Este bloque reproduce ese orden para probar que
// la lectura llega al router nuevo y que el POST /agentes existente NO queda tapado.
describe("montaje bajo /service/operator", () => {
  function buildAppComoIndex() {
    const app = express();
    const routerExistente = express.Router();
    // Doble del router del operador: sólo declara la escritura que ya existía.
    routerExistente.post("/agentes", (_req, res) => res.status(202).json({ via: "service-operator" }));
    app.use("/service/operator", routerExistente);
    app.use("/service/operator/agentes", serviceOperatorAgentesRouter);
    return app;
  }

  it("GET /service/operator/agentes llega al router de lectura", async () => {
    const res = await request(buildAppComoIndex(), "GET", "/service/operator/agentes", {
      "x-service-token": TOKEN,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ limit: 20, offset: 0 });
  });

  it("GET /service/operator/agentes/:id llega al router de lectura", async () => {
    const res = await request(buildAppComoIndex(), "GET", "/service/operator/agentes/agt_1", {
      "x-service-token": TOKEN,
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("agt_1");
  });

  it("el router nuevo no tapa el POST /agentes existente", async () => {
    const res = await request(buildAppComoIndex(), "POST", "/service/operator/agentes", {
      "x-service-token": TOKEN,
    });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ via: "service-operator" });
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("sin token, la ruta montada sigue siendo 401", async () => {
    const res = await request(buildAppComoIndex(), "GET", "/service/operator/agentes");
    expect(res.status).toBe(401);
  });
});

// ── S8.8 — Una línea de auditoría por lectura, nunca el token ─────────────────
describe("auditoría de lectura", () => {
  it("una línea por lectura correcta, con ruta, paginación y resultado", async () => {
    await getAuthed("/service/operator/agentes?limit=5&offset=10&orderBy=createdAt&dir=asc");
    expect(logger.info).toHaveBeenCalledTimes(1);

    const [campos, mensaje] = asMock(logger.info).mock.calls[0];
    expect(String(mensaje)).toContain("agentes");
    expect(campos).toMatchObject({
      ruta: "GET /service/operator/agentes",
      limit: "5",
      offset: "10",
      orderBy: "createdAt",
      dir: "asc",
      resultado: "ok",
      statusCode: 200,
    });
  });

  it("una línea por lectura rechazada, con resultado de error", async () => {
    await getAuthed("/service/operator/agentes?limit=101");
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos] = asMock(logger.info).mock.calls[0];
    expect(campos).toMatchObject({ resultado: "error", statusCode: 400 });
  });

  it("el 401 también deja su línea (ruta + resultado), sin el token", async () => {
    await get("/service/operator/agentes", { "x-service-token": WRONG_TOKEN });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [campos] = asMock(logger.info).mock.calls[0];
    expect(campos).toMatchObject({ ruta: "GET /service/operator/agentes", resultado: "error", statusCode: 401 });
  });

  it("ninguna línea de auditoría contiene el token ni cabeceras", async () => {
    await getAuthed("/service/operator/agentes?campos=name");
    await get("/service/operator/agentes", { "x-service-token": WRONG_TOKEN });
    const lineas = lineasAuditoria();
    expect(lineas).toHaveLength(2);
    for (const linea of lineas) {
      expect(linea).not.toContain(TOKEN);
      expect(linea).not.toContain(WRONG_TOKEN);
      expect(linea).not.toContain("x-service-token");
    }
  });
});
