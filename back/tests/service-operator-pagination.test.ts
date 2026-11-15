/**
 * service-operator-pagination.test.ts — T5 (odd/tasks/mcp-plataforma-read-surface, S2/S13).
 *
 * Paginación en SERVIDOR de los tres listados de lectura del Operator Agent:
 *   GET /service/operator/clientes
 *   GET /service/operator/contactos
 *   GET /service/operator/agenda
 *
 * Contrato que se prueba aquí:
 *   · Sin `limit` ni `offset` la respuesta es EXACTAMENTE la de siempre (array
 *     para clientes/contactos, { desde, hasta, total, citas } para agenda) y los
 *     parámetros desconocidos se siguen ignorando.
 *   · Con cualquiera de los dos parámetros: `limit` entero 1..200 (defecto 20),
 *     `offset` entero >= 0 (defecto 0), skip/take + count EN LA BASE DE DATOS, y
 *     sobre { clientes|contactos|citas, total, limit, offset, hasMore, nextOffset }.
 *   · El offset pedido se devuelve tal cual (nunca se recorta) y una página vacía
 *     cierra la paginación (hasMore=false, nextOffset=null).
 *   · Orden determinista con desempate por id SOLO en la ruta paginada.
 *   · Entradas inválidas → 400 sin ninguna lectura ni escritura.
 *
 * Se prueba sobre un app Express REAL con los routers montados en su prefijo de
 * producción (mismo patrón que service-operator-agentes.test.ts y
 * auth-gate.test.ts: `node:http` contra un puerto efímero, sin supertest) y con
 * prisma/logger/auditoría mockeados: el 401 del middleware sale del router real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const modelo = () => ({
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  });
  return {
    prisma: { tenant: modelo(), prospectContact: modelo(), platformAppointment: modelo() },
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

import { prisma } from "@/lib/db";
import { writeOperatorAudit } from "@/lib/operator-audit";
import { serviceOperatorRouter } from "@/routes/service-operator";
import { contactsRouter } from "@/routes/contacts";

const TOKEN = "operator-paginacion-secret-token-123";
const WRONG_TOKEN = "operator-paginacion-token-que-no-es";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** App real: el router del operador y el del panel (que NO debe cambiar). */
function buildApp() {
  const app = express();
  app.use("/service/operator", serviceOperatorRouter);
  app.use("/api/contacts", contactsRouter);
  return app;
}

/** HTTP helper sin supertest (mismo patrón que auth-gate/service-operator-agentes). */
function request(
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const server = buildApp().listen(0, () => {
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
            resolve({ status: res.statusCode ?? 0, body, raw: data });
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

const get = (path: string, headers: Record<string, string> = {}) => request("GET", path, headers);
const getAuth = (path: string) => get(path, { "x-service-token": TOKEN });

/** Respuesta esperada tal como llega por HTTP (las fechas viajan como ISO). */
const json = <T>(valor: T): any => JSON.parse(JSON.stringify(valor));

// ── Base de datos falsa: aplica orden, skip/take y proyección como Prisma ──────
type Fila = Record<string, any>;

function proyectar(fila: Fila, select: Fila): Fila {
  const out: Fila = {};
  for (const [clave, valor] of Object.entries(select)) {
    if (valor === true) out[clave] = fila[clave];
    else if (valor && typeof valor === "object" && valor.select)
      out[clave] = fila[clave] == null ? null : proyectar(fila[clave], valor.select);
  }
  return out;
}

function ordenar(filas: Fila[], orderBy: any): Fila[] {
  const criterios = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...filas].sort((a, b) => {
    for (const criterio of criterios) {
      const [campo, dir] = Object.entries(criterio)[0] as [string, "asc" | "desc"];
      const va = a[campo] instanceof Date ? a[campo].getTime() : a[campo];
      const vb = b[campo] instanceof Date ? b[campo].getTime() : b[campo];
      if (va === vb) continue;
      const comparacion = va < vb ? -1 : 1;
      return dir === "desc" ? -comparacion : comparacion;
    }
    return 0;
  });
}

/** Implementación de findMany sobre un conjunto fijo de filas. */
function fakeFindMany(filas: Fila[]) {
  return async (args: any) => {
    const ordenadas = ordenar(filas, args.orderBy);
    const inicio = args.skip ?? 0;
    const fin = args.take === undefined ? ordenadas.length : inicio + args.take;
    const pagina = ordenadas.slice(inicio, fin);
    return args.select ? pagina.map((f) => proyectar(f, args.select)) : pagina;
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const PLAN = { codigo: "starter", nombre: "Starter", tokenQuotaPerAgent: 1000 };

function tenant(id: string, createdAt: string) {
  return {
    id,
    codigo: `cli-${id}`,
    name: `Cliente ${id}`,
    razonSocial: null,
    nif: null,
    email: `${id}@ejemplo.com`,
    phone: null,
    contactPerson: null,
    website: null,
    sector: "belleza",
    direccion: null,
    tokenBalance: null,
    tokensUsed: 0,
    tokensUsedPeriod: 0,
    periodStart: new Date("2026-01-01T00:00:00"),
    plan: PLAN,
    isActive: true,
    createdAt: new Date(createdAt),
  };
}

// Dos clientes con la MISMA fecha (desempate por id) y uno más nuevo.
const TENANTS = [
  tenant("ten_b", "2026-01-02T10:00:00"),
  tenant("ten_a", "2026-01-02T10:00:00"),
  tenant("ten_c", "2026-01-03T10:00:00"),
];

function contacto(id: string, extra: Fila = {}) {
  return {
    id,
    codigo: `pc-${id}`,
    name: `Contacto ${id}`,
    phone: "600111222",
    email: `${id}@ejemplo.com`,
    type: "prospecto",
    sector: "hosteleria",
    direccion: "Calle 1",
    peticion: "quiere info",
    contactado: "no",
    contactedAt: null,
    tenantId: null,
    tenant: null,
    createdAt: new Date("2026-02-02T10:00:00"),
    // Columna real que NUNCA debe salir en el listado paginado (soft delete).
    deletedAt: null,
    ...extra,
  };
}

const CONTACTOS = [contacto("pc_b"), contacto("pc_a"), contacto("pc_c", { createdAt: new Date("2026-02-03T10:00:00") })];

function cita(id: string, inicio: string, extra: Fila = {}) {
  const startAt = new Date(inicio);
  return {
    id,
    startAt,
    endAt: new Date(startAt.getTime() + 30 * 60_000),
    client: `Cliente ${id}`,
    service: "Corte",
    status: "Confirmada",
    notes: null,
    gcalEventId: null,
    createdAt: new Date("2026-07-01T10:00:00"),
    ...extra,
  };
}

// Dos citas a la MISMA hora (desempate por id) y una posterior.
const CITAS = [
  cita("cit_b", "2026-07-07T17:00:00"),
  cita("cit_a", "2026-07-07T17:00:00"),
  cita("cit_c", "2026-07-07T18:00:00"),
];

// ── Endpoints bajo prueba (con su modelo Prisma) ───────────────────────────────
const ENDPOINTS = [
  { nombre: "clientes", modelo: "tenant", url: (q = "") => `/service/operator/clientes${q}` },
  { nombre: "contactos", modelo: "prospectContact", url: (q = "") => `/service/operator/contactos${q}` },
  { nombre: "agenda", modelo: "platformAppointment", url: (q = "") => `/service/operator/agenda${q}` },
] as const;

const modeloDe = (nombre: string) => (prisma as any)[nombre];
const noLeyoNiEscribio = (nombre: string) => {
  const modelo = modeloDe(nombre);
  for (const metodo of ["findMany", "count", "create", "update", "updateMany", "delete"]) {
    expect(modelo[metodo], `${nombre}.${metodo}`).not.toHaveBeenCalled();
  }
};

const CUERPO_INVALIDO = (detalle: Record<string, string>) => ({
  error: { code: "VALIDATION_ERROR", message: "Parámetros de paginación no válidos", detalle },
});
const LIMITE_ERR = { limit: "limit debe ser un entero entre 1 y 200" };
const OFFSET_ERR = { offset: "offset debe ser un entero >= 0" };

beforeEach(() => {
  vi.resetAllMocks();
  process.env.OPERATOR_SERVICE_TOKEN = TOKEN;
  for (const ep of ENDPOINTS) {
    asMock(modeloDe(ep.modelo).findMany).mockResolvedValue([]);
    asMock(modeloDe(ep.modelo).count).mockResolvedValue(0);
  }
});

afterEach(() => {
  delete process.env.OPERATOR_SERVICE_TOKEN;
});

// ── Auth: el router público montado, no el handler suelto ──────────────────────
describe("router montado — autenticación por service token", () => {
  for (const ep of ENDPOINTS) {
    it(`401 sin x-service-token en ${ep.nombre}`, async () => {
      const res = await get(ep.url());
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "No autorizado" });
      noLeyoNiEscribio(ep.modelo);
    });

    it(`401 con token incorrecto en ${ep.nombre}`, async () => {
      const res = await get(ep.url(), { "x-service-token": WRONG_TOKEN });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "No autorizado" });
      noLeyoNiEscribio(ep.modelo);
    });
  }
});

// ── Entradas inválidas de paginación: 400 y ninguna lectura/escritura ─────────
describe("entradas inválidas → 400 sin leer ni escribir", () => {
  const CASOS: Array<{ nombre: string; query: string; detalle: Record<string, string> }> = [
    { nombre: "limit=0", query: "?limit=0", detalle: LIMITE_ERR },
    { nombre: "limit=201", query: "?limit=201", detalle: LIMITE_ERR },
    { nombre: "limit=abc", query: "?limit=abc", detalle: LIMITE_ERR },
    { nombre: "limit=1.5", query: "?limit=1.5", detalle: LIMITE_ERR },
    { nombre: "limit vacío", query: "?limit=", detalle: LIMITE_ERR },
    { nombre: "limit duplicado", query: "?limit=5&limit=6", detalle: LIMITE_ERR },
    { nombre: "offset=-1", query: "?offset=-1", detalle: OFFSET_ERR },
    { nombre: "offset=1e3", query: "?offset=1e3", detalle: OFFSET_ERR },
  ];

  for (const ep of ENDPOINTS) {
    for (const caso of CASOS) {
      it(`${ep.nombre} ${caso.nombre}`, async () => {
        const res = await getAuth(ep.url(caso.query));
        expect(res.status).toBe(400);
        expect(res.body).toEqual(CUERPO_INVALIDO(caso.detalle));
        noLeyoNiEscribio(ep.modelo);
        expect(writeOperatorAudit).not.toHaveBeenCalled();
      });
    }
  }
});

// ── /clientes ─────────────────────────────────────────────────────────────────
describe("GET /service/operator/clientes", () => {
  const RUTA = "/service/operator/clientes";

  it("sin paginación devuelve el array legacy, sin skip/take ni count", async () => {
    asMock(prisma.tenant.findMany).mockResolvedValue(TENANTS);
    const res = await getAuth(RUTA);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(json(TENANTS));
    expect(Array.isArray(res.body)).toBe(true);
    const args = asMock(prisma.tenant.findMany).mock.calls[0][0];
    expect(args.where).toEqual({ isActive: true });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
    expect(prisma.tenant.count).not.toHaveBeenCalled();
  });

  it("sin paginación sigue ignorando parámetros desconocidos (comportamiento legacy)", async () => {
    asMock(prisma.tenant.findMany).mockResolvedValue(TENANTS);
    const res = await getAuth(`${RUTA}?foo=bar&campos=nada`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(json(TENANTS));
    expect(prisma.tenant.count).not.toHaveBeenCalled();
  });

  it("con limit/offset pagina en BD con desempate por id y devuelve metadatos exactos", async () => {
    asMock(prisma.tenant.findMany).mockImplementation(fakeFindMany(TENANTS) as any);
    asMock(prisma.tenant.count).mockResolvedValue(3);
    const res = await getAuth(`${RUTA}?limit=2&offset=1`);

    expect(res.status).toBe(200);
    // createdAt desc + id asc → ten_c, ten_a, ten_b; la página 2 (offset 1) es ten_a, ten_b.
    expect(res.body).toEqual({
      clientes: json([TENANTS[1], TENANTS[0]]),
      total: 3,
      limit: 2,
      offset: 1,
      hasMore: false,
      nextOffset: null,
    });
    expect(Object.keys(res.body).sort()).toEqual([
      "clientes",
      "hasMore",
      "limit",
      "nextOffset",
      "offset",
      "total",
    ]);

    const args = asMock(prisma.tenant.findMany).mock.calls[0][0];
    expect(args.skip).toBe(1);
    expect(args.take).toBe(2);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
    expect(args.where).toEqual({ isActive: true });
    expect(asMock(prisma.tenant.count).mock.calls[0][0]).toEqual({ where: { isActive: true } });
  });

  it("ordena createdAt desc y desempata por id asc (sólo en la ruta paginada)", async () => {
    asMock(prisma.tenant.findMany).mockImplementation(fakeFindMany(TENANTS) as any);
    asMock(prisma.tenant.count).mockResolvedValue(3);
    const res = await getAuth(`${RUTA}?limit=3`);
    expect(res.body.clientes.map((c: Fila) => c.id)).toEqual(["ten_c", "ten_a", "ten_b"]);
  });

  it("hasMore/nextOffset señalan la página siguiente", async () => {
    asMock(prisma.tenant.findMany).mockImplementation(fakeFindMany(TENANTS) as any);
    asMock(prisma.tenant.count).mockResolvedValue(3);
    const res = await getAuth(`${RUTA}?limit=1&offset=0`);

    expect(res.body).toMatchObject({ total: 3, limit: 1, offset: 0, hasMore: true, nextOffset: 1 });
    expect(res.body.clientes.map((c: Fila) => c.id)).toEqual(["ten_c"]);
  });

  it("un solo parámetro nuevo ya activa la página con los defectos 20/0", async () => {
    asMock(prisma.tenant.findMany).mockImplementation(fakeFindMany(TENANTS) as any);
    asMock(prisma.tenant.count).mockResolvedValue(3);
    const res = await getAuth(`${RUTA}?offset=0`);

    expect(res.body).toMatchObject({ total: 3, limit: 20, offset: 0, hasMore: false, nextOffset: null });
    const args = asMock(prisma.tenant.findMany).mock.calls[0][0];
    expect(args.take).toBe(20);
    expect(args.skip).toBe(0);
  });

  it("total 0 devuelve página vacía con metadatos", async () => {
    const res = await getAuth(`${RUTA}?limit=10`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clientes: [], total: 0, limit: 10, offset: 0, hasMore: false, nextOffset: null });
  });

  it("offset más allá del total se devuelve tal cual, con página vacía", async () => {
    asMock(prisma.tenant.findMany).mockImplementation(fakeFindMany(TENANTS) as any);
    asMock(prisma.tenant.count).mockResolvedValue(3);
    const res = await getAuth(`${RUTA}?limit=10&offset=500`);

    expect(res.body).toEqual({
      clientes: [],
      total: 3,
      limit: 10,
      offset: 500,
      hasMore: false,
      nextOffset: null,
    });
    expect(asMock(prisma.tenant.findMany).mock.calls[0][0].skip).toBe(500);
  });
});

// ── /contactos ────────────────────────────────────────────────────────────────
describe("GET /service/operator/contactos", () => {
  const RUTA = "/service/operator/contactos";

  it("sin paginación delega en el listado compartido: array legacy con tenant incluido", async () => {
    asMock(prisma.prospectContact.findMany).mockResolvedValue(CONTACTOS);
    const res = await getAuth(RUTA);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(json(CONTACTOS));
    const args = asMock(prisma.prospectContact.findMany).mock.calls[0][0];
    expect(args.include).toEqual({ tenant: { select: { id: true, name: true, codigo: true } } });
    expect(args.select).toBeUndefined();
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
    expect(prisma.prospectContact.count).not.toHaveBeenCalled();
  });

  it("sin paginación mantiene el panel /api/contacts intacto (misma respuesta)", async () => {
    asMock(prisma.prospectContact.findMany).mockResolvedValue(CONTACTOS);
    const operador = await getAuth(RUTA);
    const panel = await get("/api/contacts");

    expect(panel.status).toBe(200);
    expect(panel.body).toEqual(operador.body);
    expect(panel.body).toEqual(json(CONTACTOS));
    expect(asMock(prisma.prospectContact.findMany).mock.calls[1][0].include).toEqual({
      tenant: { select: { id: true, name: true, codigo: true } },
    });
  });

  it("sin paginación conserva los filtros existentes (type/contactado) y su 400", async () => {
    asMock(prisma.prospectContact.findMany).mockResolvedValue([CONTACTOS[1]]);
    const ok = await getAuth(`${RUTA}?type=prospecto&contactado=no`);
    expect(ok.status).toBe(200);
    expect(asMock(prisma.prospectContact.findMany).mock.calls[0][0].where).toEqual({
      deletedAt: null,
      type: "prospecto",
      contactado: "no",
    });

    vi.resetAllMocks();
    const malo = await getAuth(`${RUTA}?type=inventado`);
    expect(malo.status).toBe(400);
    expect(prisma.prospectContact.findMany).not.toHaveBeenCalled();
  });

  it("con paginación usa select fijo (sin include), skip/take, count y filtros", async () => {
    const leads = [CONTACTOS[1]];
    asMock(prisma.prospectContact.findMany).mockImplementation(fakeFindMany(leads) as any);
    asMock(prisma.prospectContact.count).mockResolvedValue(1);
    const res = await getAuth(`${RUTA}?limit=5&offset=0&type=prospecto&contactado=no`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(json({
      contactos: [
        {
          id: "pc_a",
          codigo: "pc-pc_a",
          name: "Contacto pc_a",
          phone: "600111222",
          email: "pc_a@ejemplo.com",
          type: "prospecto",
          sector: "hosteleria",
          direccion: "Calle 1",
          peticion: "quiere info",
          contactado: "no",
          contactedAt: null,
          tenantId: null,
          tenant: null,
          createdAt: new Date("2026-02-02T10:00:00"),
        },
      ],
      total: 1,
      limit: 5,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    }));

    const args = asMock(prisma.prospectContact.findMany).mock.calls[0][0];
    expect(args.include).toBeUndefined();
    // Proyección fija = contrato de campos del MCP, sin soft-delete ni columnas libres.
    expect(Object.keys(args.select).sort()).toEqual([
      "codigo",
      "contactado",
      "contactedAt",
      "createdAt",
      "direccion",
      "email",
      "id",
      "name",
      "peticion",
      "phone",
      "sector",
      "tenant",
      "tenantId",
      "type",
    ]);
    expect(args.select.tenant).toEqual({ select: { id: true, name: true, codigo: true } });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(5);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
    expect(args.where).toEqual({ deletedAt: null, type: "prospecto", contactado: "no" });
    expect(asMock(prisma.prospectContact.count).mock.calls[0][0]).toEqual({
      where: { deletedAt: null, type: "prospecto", contactado: "no" },
    });
  });

  it("con paginación desempata por id y pagina de verdad", async () => {
    asMock(prisma.prospectContact.findMany).mockImplementation(fakeFindMany(CONTACTOS) as any);
    asMock(prisma.prospectContact.count).mockResolvedValue(3);
    const primera = await getAuth(`${RUTA}?limit=2`);
    expect(primera.body.contactos.map((c: Fila) => c.id)).toEqual(["pc_c", "pc_a"]);
    expect(primera.body).toMatchObject({ total: 3, limit: 2, offset: 0, hasMore: true, nextOffset: 2 });

    const segunda = await getAuth(`${RUTA}?limit=2&offset=2`);
    expect(segunda.body.contactos.map((c: Fila) => c.id)).toEqual(["pc_b"]);
    expect(segunda.body).toMatchObject({ total: 3, limit: 2, offset: 2, hasMore: false, nextOffset: null });
  });

  it("offset más allá del total: página vacía y offset pedido intacto", async () => {
    asMock(prisma.prospectContact.count).mockResolvedValue(3);
    const res = await getAuth(`${RUTA}?limit=2&offset=99`);
    expect(res.body).toEqual({
      contactos: [],
      total: 3,
      limit: 2,
      offset: 99,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("con paginación un filtro inválido sigue siendo 400 sin leer", async () => {
    const res = await getAuth(`${RUTA}?limit=5&type=inventado`);
    expect(res.status).toBe(400);
    expect(prisma.prospectContact.findMany).not.toHaveBeenCalled();
    expect(prisma.prospectContact.count).not.toHaveBeenCalled();
  });
});

// ── /agenda ───────────────────────────────────────────────────────────────────
describe("GET /service/operator/agenda", () => {
  const RUTA = "/service/operator/agenda";
  const RANGO = "desde=2026-07-07&hasta=2026-07-07";

  it("sin paginación devuelve el objeto legacy { desde, hasta, total, citas }", async () => {
    asMock(prisma.platformAppointment.findMany).mockResolvedValue(CITAS);
    const res = await getAuth(`${RUTA}?${RANGO}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["citas", "desde", "hasta", "total"]);
    expect(res.body).toMatchObject({ desde: "2026-07-07", hasta: "2026-07-07", total: 3 });
    expect(res.body.citas).toHaveLength(3);

    const args = asMock(prisma.platformAppointment.findMany).mock.calls[0][0];
    expect(args.where).toEqual({
      startAt: { gte: new Date("2026-07-07T00:00:00"), lte: new Date("2026-07-07T23:59:59.999") },
      status: { not: "Cancelada" },
    });
    expect(args.orderBy).toEqual({ startAt: "asc" });
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
    expect(prisma.platformAppointment.count).not.toHaveBeenCalled();
  });

  it("sin paginación sigue ignorando parámetros desconocidos", async () => {
    asMock(prisma.platformAppointment.findMany).mockResolvedValue(CITAS);
    const res = await getAuth(`${RUTA}?${RANGO}&foo=bar`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["citas", "desde", "hasta", "total"]);
    expect(prisma.platformAppointment.count).not.toHaveBeenCalled();
  });

  it("con paginación conserva desde/hasta y filtros, pagina en BD y añade metadatos", async () => {
    asMock(prisma.platformAppointment.findMany).mockImplementation(fakeFindMany(CITAS) as any);
    asMock(prisma.platformAppointment.count).mockResolvedValue(3);
    const res = await getAuth(`${RUTA}?${RANGO}&limit=2&offset=1`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      "citas",
      "desde",
      "hasMore",
      "hasta",
      "limit",
      "nextOffset",
      "offset",
      "total",
    ]);
    expect(res.body).toEqual({
      desde: "2026-07-07",
      hasta: "2026-07-07",
      total: 3,
      limit: 2,
      offset: 1,
      hasMore: false,
      nextOffset: null,
      citas: [
        { id: "cit_b", fecha: "2026-07-07", hora: "17:00", cliente: "Cliente cit_b", servicio: "Corte", estado: "Confirmada" },
        { id: "cit_c", fecha: "2026-07-07", hora: "18:00", cliente: "Cliente cit_c", servicio: "Corte", estado: "Confirmada" },
      ],
    });

    const args = asMock(prisma.platformAppointment.findMany).mock.calls[0][0];
    expect(args.skip).toBe(1);
    expect(args.take).toBe(2);
    expect(args.orderBy).toEqual([{ startAt: "asc" }, { id: "asc" }]);
    // Proyección fija: sólo las columnas que alimentan el DTO de la cita.
    expect(Object.keys(args.select).sort()).toEqual(["client", "id", "service", "startAt", "status"]);
    const where = {
      startAt: { gte: new Date("2026-07-07T00:00:00"), lte: new Date("2026-07-07T23:59:59.999") },
      status: { not: "Cancelada" },
    };
    expect(args.where).toEqual(where);
    expect(asMock(prisma.platformAppointment.count).mock.calls[0][0]).toEqual({ where });
  });

  it("con paginación ordena startAt asc y desempata por id asc", async () => {
    asMock(prisma.platformAppointment.findMany).mockImplementation(fakeFindMany(CITAS) as any);
    asMock(prisma.platformAppointment.count).mockResolvedValue(3);
    const res = await getAuth(`${RUTA}?${RANGO}&limit=3`);
    expect(res.body.citas.map((c: Fila) => c.id)).toEqual(["cit_a", "cit_b", "cit_c"]);
    expect(res.body).toMatchObject({ total: 3, limit: 3, offset: 0, hasMore: false, nextOffset: null });
  });

  it("con paginación: total 0 y offset fuera de rango devuelven citas vacías con metadatos", async () => {
    const vacia = await getAuth(`${RUTA}?${RANGO}&limit=10`);
    expect(vacia.body).toEqual({
      desde: "2026-07-07",
      hasta: "2026-07-07",
      total: 0,
      limit: 10,
      offset: 0,
      hasMore: false,
      nextOffset: null,
      citas: [],
    });

    asMock(prisma.platformAppointment.count).mockResolvedValue(3);
    const fuera = await getAuth(`${RUTA}?${RANGO}&limit=10&offset=40`);
    expect(fuera.body).toMatchObject({ total: 3, limit: 10, offset: 40, hasMore: false, nextOffset: null, citas: [] });
  });

  it("un rango inválido sigue siendo 400 aunque venga paginación", async () => {
    const res = await getAuth(`${RUTA}?desde=07-2026&limit=5`);
    expect(res.status).toBe(400);
    expect(prisma.platformAppointment.findMany).not.toHaveBeenCalled();
    expect(prisma.platformAppointment.count).not.toHaveBeenCalled();
  });

  it("/agenda/huecos no cambia y no pagina", async () => {
    asMock(prisma.platformAppointment.findMany).mockResolvedValue([CITAS[0]]);
    const res = await getAuth(`${RUTA}/huecos?${RANGO}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["desde", "dias", "hasta"]);
    expect(prisma.platformAppointment.count).not.toHaveBeenCalled();
  });
});
