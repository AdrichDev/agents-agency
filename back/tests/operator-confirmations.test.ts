/**
 * operator-confirmations.test.ts — T8b (odd/tasks/mcp-plataforma-read-surface, S4/S14).
 *
 * Confirma que las DOCE escrituras del Operator Agent están atadas a una persona:
 *   · la primera llamada NO ejecuta nada: registra una acción pendiente y
 *     responde 202 { pendiente, accion, resumen, expiraEn } SIN el token;
 *   · `confirmado:true` / `confirmar` en el body ya no ejecutan nada (el modelo
 *     no puede auto-confirmarse; sustituye el 409 confirmation_required y el
 *     400 confirmar_requerido del borrado de agenda);
 *   · el resumen y los botones Confirmar/Cancelar los envía el BACKEND a Telegram
 *     (nunca el modelo), con callback_data <= 64 bytes que lleva el token;
 *   · POST /service/operator/confirmaciones/:token/confirmar ejecuta la acción
 *     guardada con SU lógica de negocio (una sola vez) y deja la auditoría de
 *     escritura; /cancelar la descarta;
 *   · token desconocido/usado → 404, caducado → 410, sin ejecutar;
 *   · sin Telegram configurado o con el envío fallido → 503 y NINGUNA acción
 *     pendiente viva (nadie podría confirmarla); tope de pendientes → 429.
 *
 * Se monta la composición REAL de producción (routes/operator-domain-mounts.ts)
 * y se habla HTTP con node:http, igual que service-operator-mount-audit.test.ts.
 * Prisma, logger, auditoría, códigos, servicios de agente y fetch de Telegram van
 * mockeados: aquí no hay base de datos ni red reales.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
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
  const prismaMock: any = {
    tenant: modelo(),
    lead: modelo(),
    prospectContact: modelo(),
    platformAppointment: modelo(),
    platformIntegration: modelo(),
    agent: modelo(),
    operatorAudit: modelo(),
  };
  prismaMock.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/operator-audit", () => ({ writeOperatorAudit: vi.fn() }));
vi.mock("@/lib/codes", () => ({
  nextClientCode: vi.fn().mockResolvedValue("cli-07"),
  nextContactCode: vi.fn().mockResolvedValue("pc-07"),
  withCodeRetry: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock("@/lib/agent/service", () => ({ createAgent: vi.fn() }));
vi.mock("@/lib/integrations/oauth", () => ({ getValidPlatformToken: vi.fn() }));
vi.mock("@/lib/integrations/calendar", () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeOperatorAudit } from "@/lib/operator-audit";
import { createAgent } from "@/lib/agent/service";
import { montarSuperficieOperador } from "@/routes/operator-domain-mounts";
import { accionDeEscritura } from "@/routes/service-operator";
import { confirmarAccionHandler } from "@/routes/service-operator-confirmaciones";
import {
  CONFIRMACION_MAX_PENDIENTES,
  CONFIRMACION_TTL_MS,
  PROGRESO_MAX_PASOS,
  configurarCapPendientes,
  resetConfirmacionesPendientes,
  tamanoPendientes,
} from "@/lib/operator-confirmations";

const TOKEN = "operator-confirmaciones-secret-token-123";
const TG_BOT_TOKEN = "123456:bot-token-de-pruebas";
const TG_CHAT_ID = "987654321";
const TG_API = "https://api.telegram.org";

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

/** Última llamada saliente a la Bot API de Telegram. */
function ultimoEnvioTelegram(): { url: string; payload: any } {
  const llamada = fetchMock.mock.calls.at(-1);
  expect(llamada, "no se llamó al fetch de Telegram").toBeTruthy();
  return {
    url: String(llamada![0]),
    payload: JSON.parse(String((llamada![1] as { body?: unknown })?.body ?? "{}")),
  };
}

/** Token de confirmación que viaja en los botones (nunca en la respuesta HTTP). */
function tokenDelTeclado(payload: any): string {
  const datos = payload?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
  expect(typeof datos).toBe("string");
  return datos.replace(/^confirmar:/, "");
}

/** Llamadas salientes a la Bot API de Telegram, ya parseadas (método + payload). */
function llamadasTelegram(): Array<{ metodo: string; payload: any }> {
  return fetchMock.mock.calls.map(([url, init]) => ({
    metodo: String(url).split("/").at(-1) ?? "",
    payload: JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? "{}")),
  }));
}

/** Sólo las ediciones del mensaje (S15). */
function ediciones(): Array<{ metodo: string; payload: any }> {
  return llamadasTelegram().filter((l) => l.metodo === "editMessageText");
}

/**
 * Telegram responde por método: sendMessage devuelve el message_id indicado
 * (`null` = respuesta sin message_id) y las ediciones responden ok.
 */
function telegramResponde(messageId: number | null = 77) {
  fetchMock.mockImplementation(async (url: unknown) => {
    if (String(url).endsWith("/sendMessage")) {
      return { json: async () => ({ ok: true, result: messageId === null ? {} : { message_id: messageId } }) };
    }
    return { json: async () => ({ ok: true, result: {} }) };
  });
}

/** Petición de escritura → 202 pendiente; devuelve el token de los botones. */
async function pedirConfirmacion(caso: { metodo: string; ruta: string; body?: unknown }): Promise<string> {
  const alta = await request(caso.metodo, caso.ruta, caso.body, autorizado());
  expect(alta.status).toBe(202);
  return tokenDelTeclado(ultimoEnvioTelegram().payload);
}

/** `res` mínima para invocar el handler de confirmación sin servidor HTTP. */
function resFalsa() {
  const res: any = {
    statusCode: 200,
    headersSent: false,
    locals: {},
    body: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

/** Ninguna escritura de negocio ha ocurrido. */
function sinEscrituras() {
  for (const nombre of ["tenant", "lead", "prospectContact", "platformAppointment"]) {
    const modelo = (prisma as any)[nombre];
    for (const metodo of ["create", "update", "updateMany", "delete", "upsert"]) {
      expect(modelo[metodo], `${nombre}.${metodo}`).not.toHaveBeenCalled();
    }
  }
  expect(createAgent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetConfirmacionesPendientes();
  process.env.OPERATOR_SERVICE_TOKEN = TOKEN;
  process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN = TG_BOT_TOKEN;
  process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID = TG_CHAT_ID;
  fetchMock.mockResolvedValue({ json: async () => ({ ok: true, result: { message_id: 1 } }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env.OPERATOR_SERVICE_TOKEN;
  delete process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN;
  delete process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetConfirmacionesPendientes();
});

// ── Las DOCE escrituras: primera llamada = 202 pendiente, sin escribir ────────
const ESCRITURAS = [
  {
    nombre: "crear cliente",
    accion: "agencia_crear_cliente",
    metodo: "POST",
    ruta: "/service/operator/clientes",
    body: { nombre: "Peluquería Sol" },
    resumenContiene: "Peluquería Sol",
    preparar: () => {},
  },
  {
    nombre: "convertir lead",
    accion: "agencia_convertir_lead",
    metodo: "POST",
    ruta: "/service/operator/leads/lead_1/convertir",
    body: {},
    resumenContiene: "lead_1",
    preparar: () => {},
  },
  {
    nombre: "crear agente",
    accion: "agencia_crear_agente",
    metodo: "POST",
    ruta: "/service/operator/agentes",
    body: { name: "Bot", sector: "retail", systemPrompt: "Eres útil" },
    resumenContiene: "Bot",
    preparar: () => {},
  },
  {
    nombre: "editar cliente",
    accion: "agencia_editar_cliente",
    metodo: "PATCH",
    ruta: "/service/operator/clientes/ten_1",
    body: { nombre: "Nuevo" },
    resumenContiene: "ten_1",
    preparar: () => {},
  },
  {
    nombre: "borrar cliente",
    accion: "agencia_borrar_cliente",
    metodo: "DELETE",
    ruta: "/service/operator/clientes/ten_1",
    body: undefined,
    resumenContiene: "ten_1",
    preparar: () => {},
  },
  {
    nombre: "crear contacto",
    accion: "agencia_crear_contacto",
    metodo: "POST",
    ruta: "/service/operator/contactos",
    body: { name: "Bar Pepe" },
    resumenContiene: "Bar Pepe",
    preparar: () => {},
  },
  {
    nombre: "editar contacto",
    accion: "agencia_editar_contacto",
    metodo: "PATCH",
    ruta: "/service/operator/contactos/pc_1",
    body: { name: "Bar Nuevo" },
    resumenContiene: "pc_1",
    preparar: () => {},
  },
  {
    nombre: "borrar contacto",
    accion: "agencia_borrar_contacto",
    metodo: "DELETE",
    ruta: "/service/operator/contactos/pc_1",
    body: undefined,
    resumenContiene: "pc_1",
    preparar: () => {},
  },
  {
    nombre: "convertir contacto",
    accion: "agencia_convertir_contacto",
    metodo: "POST",
    ruta: "/service/operator/contactos/pc_1/convertir",
    body: {},
    resumenContiene: "pc_1",
    preparar: () => {},
  },
  {
    nombre: "crear cita",
    accion: "agencia_crear_cita",
    metodo: "POST",
    ruta: "/service/operator/agenda",
    body: { fecha: "2026-07-10", hora: "16:00", cliente: "Ana" },
    resumenContiene: "Ana",
    preparar: () => {},
  },
  {
    nombre: "editar cita",
    accion: "agencia_editar_cita",
    metodo: "PATCH",
    ruta: "/service/operator/agenda/cita_1",
    body: { hora: "11:00" },
    resumenContiene: "Ana",
    preparar: () => {
      asMock(prisma.platformAppointment.findUnique).mockResolvedValue({
        id: "cita_1",
        startAt: new Date("2026-07-10T16:00:00"),
        endAt: new Date("2026-07-10T16:30:00"),
        client: "Ana",
        service: "Corte",
        status: "Confirmada",
        notes: null,
        gcalEventId: null,
      });
    },
  },
  {
    nombre: "borrar cita",
    accion: "agencia_borrar_cita",
    metodo: "DELETE",
    ruta: "/service/operator/agenda/cita_1",
    body: undefined,
    resumenContiene: "Ana",
    preparar: () => {
      asMock(prisma.platformAppointment.findUnique).mockResolvedValue({
        id: "cita_1",
        startAt: new Date("2026-07-10T16:00:00"),
        endAt: new Date("2026-07-10T16:30:00"),
        client: "Ana",
        service: "Corte",
        status: "Confirmada",
        notes: null,
        gcalEventId: null,
      });
    },
  },
] as const;

describe("las doce escrituras piden confirmación humana (202) y no escriben", () => {
  it.each(ESCRITURAS)("$nombre → 202 pendiente, SIN token y sin escrituras", async (caso) => {
    caso.preparar();
    const res = await request(caso.metodo, caso.ruta, caso.body, autorizado());

    expect(res.status).toBe(202);
    // Contrato exacto: pendiente/accion/resumen/expiraEn y NADA más (jamás el token).
    expect(Object.keys(res.body).sort()).toEqual(["accion", "expiraEn", "pendiente", "resumen"]);
    expect(res.body.pendiente).toBe(true);
    expect(res.body.accion).toBe(caso.accion);
    expect(res.body.resumen).toEqual(expect.stringContaining(caso.resumenContiene));

    const expira = Date.parse(res.body.expiraEn);
    expect(Number.isNaN(expira)).toBe(false);
    expect(expira - Date.now()).toBeGreaterThan(CONFIRMACION_TTL_MS - 60_000);
    expect(expira - Date.now()).toBeLessThanOrEqual(CONFIRMACION_TTL_MS);

    sinEscrituras();
    // La auditoría de escritura se escribe al EJECUTAR, no al pedir confirmación.
    expect(writeOperatorAudit).not.toHaveBeenCalled();
    expect(tamanoPendientes()).toBe(1);
  });
});

// ── El modelo ya no puede auto-confirmarse ────────────────────────────────────
describe("confirmado/confirmar en el body ya no ejecutan nada", () => {
  it("POST /clientes con confirmado:true → 202 pendiente y ningún alta", async () => {
    const res = await request("POST", "/service/operator/clientes", { nombre: "Peluquería Sol", confirmado: true }, autorizado());
    expect(res.status).toBe(202);
    expect(res.body.pendiente).toBe(true);
    sinEscrituras();
  });

  it("POST /clientes con confirmar:\"true\" → 202 pendiente y ningún alta", async () => {
    const res = await request("POST", "/service/operator/clientes", { nombre: "Peluquería Sol", confirmar: "true" }, autorizado());
    expect(res.status).toBe(202);
    sinEscrituras();
  });

  it("DELETE /agenda/:id con confirmar=true (query y body) → 202 pendiente y no borra", async () => {
    ESCRITURAS[11].preparar();
    const res = await request(
      "DELETE",
      "/service/operator/agenda/cita_1?confirmar=true",
      { confirmar: true },
      autorizado()
    );
    expect(res.status).toBe(202);
    expect(res.body.accion).toBe("agencia_borrar_cita");
    expect(prisma.platformAppointment.delete).not.toHaveBeenCalled();
  });

  it("POST /contactos/:id/convertir con confirmado:true → 202 y no convierte", async () => {
    const res = await request(
      "POST",
      "/service/operator/contactos/pc_1/convertir",
      { confirmado: true },
      autorizado()
    );
    expect(res.status).toBe(202);
    sinEscrituras();
  });
});

// ── El backend envía el resumen y los botones (nunca el modelo) ───────────────
describe("aviso de confirmación por Telegram", () => {
  it("un solo envío al chat del operador con resumen y botones de callback_data corto", async () => {
    const res = await request("POST", "/service/operator/clientes", { nombre: "Peluquería Sol" }, autorizado());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const envio = ultimoEnvioTelegram();
    expect(envio.url).toBe(`${TG_API}/bot${TG_BOT_TOKEN}/sendMessage`);
    expect(envio.payload.chat_id).toBe(Number(TG_CHAT_ID));
    expect(envio.payload.text).toEqual(expect.stringContaining("Peluquería Sol"));
    expect(envio.payload.text).toEqual(expect.stringContaining("agencia_crear_cliente"));
    expect(envio.payload.text).toEqual(expect.stringContaining("10 minutos"));

    const botones = envio.payload.reply_markup.inline_keyboard[0];
    expect(botones).toHaveLength(2);
    expect(botones[0].text).toMatch(/confirmar/i);
    expect(botones[1].text).toMatch(/cancelar/i);
    expect(botones[0].callback_data).toMatch(/^confirmar:/);
    expect(botones[1].callback_data).toMatch(/^cancelar:/);
    // Límite duro de Telegram: callback_data <= 64 bytes.
    for (const boton of botones) {
      expect(Buffer.byteLength(boton.callback_data, "utf8")).toBeLessThanOrEqual(64);
    }

    const token = tokenDelTeclado(envio.payload);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22,}$/); // url-safe, >= 16 bytes de entropía
    expect(botones[1].callback_data).toBe(`cancelar:${token}`);

    // El token NUNCA viaja en la respuesta HTTP ni en los logs del proceso.
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(JSON.stringify(asMock(logger.info).mock.calls)).not.toContain(token);
    expect(JSON.stringify(asMock(logger.error).mock.calls)).not.toContain(token);
    expect(JSON.stringify(asMock(logger.warn).mock.calls)).not.toContain(token);
  });

  it.each([
    ["falta OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN", "OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN"],
    ["falta OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID", "OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID"],
  ])("%s → 503, sin envío, sin pendiente y sin escritura", async (_nombre, variable) => {
    delete process.env[variable];
    const res = await request("POST", "/service/operator/clientes", { nombre: "Peluquería Sol" }, autorizado());

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("confirmacion_no_disponible");
    expect(res.body.error.message).toEqual(expect.stringContaining("no se ha ejecutado"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tamanoPendientes()).toBe(0);
    sinEscrituras();
  });

  it("si Telegram falla → 503, sin pendiente y sin escritura", async () => {
    // sendMessage reintenta en texto plano: los dos intentos fallan.
    fetchMock.mockResolvedValue({ json: async () => ({ ok: false, description: "Bad Request: chat not found" }) });
    const res = await request("POST", "/service/operator/clientes", { nombre: "Peluquería Sol" }, autorizado());

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("confirmacion_no_disponible");
    expect(res.body.error.message).toEqual(expect.stringContaining("no se ha ejecutado"));
    expect(fetchMock).toHaveBeenCalled();
    expect(tamanoPendientes()).toBe(0);
    sinEscrituras();
  });
});

// ── Confirmar ejecuta la lógica de negocio, una sola vez ─────────────────────
describe("POST /confirmaciones/:token/confirmar", () => {
  it("ejecuta la acción con el payload original, deja auditoría y responde el éxito normal", async () => {
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });

    const alta = await request(
      "POST",
      "/service/operator/clientes",
      { nombre: "Bar Pepe", razonSocial: "Pepe SL" },
      autorizado()
    );
    expect(alta.status).toBe(202);
    const token = tokenDelTeclado(ultimoEnvioTelegram().payload);
    expect(prisma.tenant.create).not.toHaveBeenCalled();

    const confirmacion = await request("POST", `/service/operator/confirmaciones/${token}/confirmar`, undefined, autorizado());

    expect(confirmacion.status).toBe(201);
    expect(confirmacion.body).toEqual({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });

    expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
    const data = asMock(prisma.tenant.create).mock.calls[0][0].data;
    expect(data).toMatchObject({ name: "Bar Pepe", razonSocial: "Pepe SL", codigo: "cli-07" });
    expect(data).not.toHaveProperty("confirmado");

    expect(writeOperatorAudit).toHaveBeenCalledTimes(1);
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_crear_cliente", resultado: "ok", detalle: "ten_7" })
    );
  });

  it("el token es de un solo uso: reenviarlo → 404 y no ejecuta dos veces", async () => {
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });
    await request("POST", "/service/operator/clientes", { nombre: "Bar Pepe" }, autorizado());
    const token = tokenDelTeclado(ultimoEnvioTelegram().payload);

    const primera = await request("POST", `/service/operator/confirmaciones/${token}/confirmar`, undefined, autorizado());
    expect(primera.status).toBe(201);
    const replay = await request("POST", `/service/operator/confirmaciones/${token}/confirmar`, undefined, autorizado());

    expect(replay.status).toBe(404);
    expect(replay.body.error.code).toBe("confirmacion_no_encontrada");
    expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
  });

  it("confirmar una cita crea la cita guardada (misma lógica que el handler)", async () => {
    asMock(prisma.platformAppointment.create).mockResolvedValue({
      id: "cita_9",
      startAt: new Date("2026-07-10T16:00:00"),
      endAt: new Date("2026-07-10T16:30:00"),
      client: "Ana",
      service: "Corte",
      status: "Confirmada",
      notes: null,
      gcalEventId: null,
    });
    const alta = await request(
      "POST",
      "/service/operator/agenda",
      { fecha: "2026-07-10", hora: "16:00", cliente: "Ana", servicio: "Corte" },
      autorizado()
    );
    expect(alta.status).toBe(202);
    const token = tokenDelTeclado(ultimoEnvioTelegram().payload);

    const confirmacion = await request("POST", `/service/operator/confirmaciones/${token}/confirmar`, undefined, autorizado());

    expect(confirmacion.status).toBe(201);
    expect(confirmacion.body).toMatchObject({ ok: true, cita: { cliente: "Ana", hora: "16:00" } });
    expect(prisma.platformAppointment.create).toHaveBeenCalledTimes(1);
    expect(asMock(prisma.platformAppointment.create).mock.calls[0][0].data).toMatchObject({
      client: "Ana",
      service: "Corte",
    });
  });
});

// ── Cancelar descarta ────────────────────────────────────────────────────────
describe("POST /confirmaciones/:token/cancelar", () => {
  it("descarta la acción pendiente y luego ya no se puede confirmar", async () => {
    await request("POST", "/service/operator/clientes", { nombre: "Bar Pepe" }, autorizado());
    const token = tokenDelTeclado(ultimoEnvioTelegram().payload);

    const cancelacion = await request("POST", `/service/operator/confirmaciones/${token}/cancelar`, undefined, autorizado());
    expect(cancelacion.status).toBe(200);
    expect(cancelacion.body).toEqual({ cancelada: true });

    const confirmacion = await request("POST", `/service/operator/confirmaciones/${token}/confirmar`, undefined, autorizado());
    expect(confirmacion.status).toBe(404);
    sinEscrituras();
    expect(tamanoPendientes()).toBe(0);
  });
});

// ── Caducidad (10 minutos) ───────────────────────────────────────────────────
describe("caducidad de la acción pendiente", () => {
  it("confirmar después de 10 minutos → 410 y no ejecuta", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const alta = await request("POST", "/service/operator/clientes", { nombre: "Bar Pepe" }, autorizado());
    expect(alta.status).toBe(202);
    const token = tokenDelTeclado(ultimoEnvioTelegram().payload);

    vi.setSystemTime(new Date(Date.now() + CONFIRMACION_TTL_MS + 1_000));
    const confirmacion = await request("POST", `/service/operator/confirmaciones/${token}/confirmar`, undefined, autorizado());

    expect(confirmacion.status).toBe(410);
    expect(confirmacion.body.error.code).toBe("confirmacion_caducada");
    sinEscrituras();
    expect(tamanoPendientes()).toBe(0);
  });

  it("cancelar después de 10 minutos → 410 (ya no hay nada que cancelar) y no ejecuta", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await request("POST", "/service/operator/clientes", { nombre: "Bar Pepe" }, autorizado());
    const token = tokenDelTeclado(ultimoEnvioTelegram().payload);

    vi.setSystemTime(new Date(Date.now() + CONFIRMACION_TTL_MS + 1_000));
    const cancelacion = await request("POST", `/service/operator/confirmaciones/${token}/cancelar`, undefined, autorizado());

    expect(cancelacion.status).toBe(410);
    expect(cancelacion.body.error.code).toBe("confirmacion_caducada");
    sinEscrituras();
  });
});

// ── Tope de pendientes ───────────────────────────────────────────────────────
describe("tope de acciones pendientes", () => {
  it("al llegar al tope la siguiente petición → 429 y no ejecuta", async () => {
    configurarCapPendientes(2);
    expect(await request("POST", "/service/operator/clientes", { nombre: "Uno" }, autorizado())).toMatchObject({ status: 202 });
    expect(await request("POST", "/service/operator/clientes", { nombre: "Dos" }, autorizado())).toMatchObject({ status: 202 });

    const tercera = await request("POST", "/service/operator/clientes", { nombre: "Tres" }, autorizado());

    expect(tercera.status).toBe(429);
    expect(tercera.body.error.code).toBe("confirmaciones_llenas");
    expect(tamanoPendientes()).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    sinEscrituras();
  });

  it("purga las caducadas antes de aplicar el tope", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    configurarCapPendientes(1);
    expect(await request("POST", "/service/operator/clientes", { nombre: "Uno" }, autorizado())).toMatchObject({ status: 202 });
    expect(await request("POST", "/service/operator/clientes", { nombre: "Dos" }, autorizado())).toMatchObject({ status: 429 });

    vi.setSystemTime(new Date(Date.now() + CONFIRMACION_TTL_MS + 1_000));
    expect(await request("POST", "/service/operator/clientes", { nombre: "Tres" }, autorizado())).toMatchObject({ status: 202 });
    expect(tamanoPendientes()).toBe(1);
  });

  it("el tope por defecto es pequeño y acotado", () => {
    expect(CONFIRMACION_MAX_PENDIENTES).toBeGreaterThan(0);
    expect(CONFIRMACION_MAX_PENDIENTES).toBeLessThanOrEqual(50);
  });
});

// ── Autorización sin cambios ────────────────────────────────────────────────
describe("el service token sigue siendo la única autorización", () => {
  it.each([
    ["confirmar", "confirmar"],
    ["cancelar", "cancelar"],
  ])("POST /confirmaciones/:token/%s sin token → 401 y no ejecuta ni consume", async (_nombre, sufijo) => {
    await request("POST", "/service/operator/clientes", { nombre: "Bar Pepe" }, autorizado());
    const token = tokenDelTeclado(ultimoEnvioTelegram().payload);

    const sinToken = await request("POST", `/service/operator/confirmaciones/${token}/${sufijo}`);
    expect(sinToken.status).toBe(401);
    expect(sinToken.body).toEqual({ error: "No autorizado" });
    sinEscrituras();
    expect(tamanoPendientes()).toBe(1); // el 401 no consume la acción pendiente

    const conTokenIncorrecto = await request("POST", `/service/operator/confirmaciones/${token}/${sufijo}`, undefined, {
      "x-service-token": "token-que-no-es",
    });
    expect(conTokenIncorrecto.status).toBe(401);
    expect(tamanoPendientes()).toBe(1);
  });

  it("token desconocido → 404 sin ejecutar", async () => {
    const res = await request("POST", "/service/operator/confirmaciones/token-inventado/confirmar", undefined, autorizado());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("confirmacion_no_encontrada");
    sinEscrituras();
  });
});

// ── Auditoría de la ruta: una línea por petición, nunca el token ────────────
describe("auditoría de la ruta de confirmaciones", () => {
  it("una línea por petición, con la ruta enmascarada y sin el token", async () => {
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });
    await request("POST", "/service/operator/clientes", { nombre: "Bar Pepe" }, autorizado());
    const token = tokenDelTeclado(ultimoEnvioTelegram().payload);

    await request("POST", `/service/operator/confirmaciones/${token}/confirmar`, undefined, autorizado());

    const lineas = asMock(logger.info).mock.calls;
    expect(lineas).toHaveLength(1);
    expect(lineas[0][0]).toMatchObject({
      ruta: "POST /service/operator/confirmaciones/:token/confirmar",
      accion: "agencia_crear_cliente",
      resultado: "ok",
      statusCode: 201,
    });
    expect(JSON.stringify(lineas)).not.toContain(token);
    expect(JSON.stringify(lineas)).not.toContain(TOKEN);
  });

  it("el 404 de un token inválido también deja su línea", async () => {
    const res = await request("POST", "/service/operator/confirmaciones/token-inventado/cancelar", undefined, autorizado());
    expect(res.status).toBe(404);
    const lineas = asMock(logger.info).mock.calls;
    expect(lineas).toHaveLength(1);
    expect(lineas[0][0]).toMatchObject({
      ruta: "POST /service/operator/confirmaciones/:token/cancelar",
      resultado: "error",
      statusCode: 404,
    });
    expect(JSON.stringify(lineas)).not.toContain("token-inventado");
  });
});

// ── PRESERVE: las lecturas no cambian ──────────────────────────────────────
describe("las lecturas del operador no cambian", () => {
  beforeEach(() => {
    asMock(prisma.tenant.count).mockResolvedValue(7);
    asMock(prisma.agent.groupBy).mockResolvedValue([{ runtime: "openai", _count: { _all: 3 } }]);
    asMock(prisma.lead.count).mockResolvedValue(2);
    asMock(prisma.tenant.findMany).mockResolvedValue([{ id: "ten_1", name: "Sol" }]);
    asMock(prisma.platformAppointment.findMany).mockResolvedValue([]);
  });

  it("GET /estado sin auditoría de escritura", async () => {
    const res = await request("GET", "/service/operator/estado", undefined, autorizado());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      tenantsActivos: 7,
      agentes: [{ runtime: "openai", total: 3 }],
      leadsPendientes: 2,
    });
    expect(writeOperatorAudit).not.toHaveBeenCalled();
  });

  it("GET /clientes sigue devolviendo el ARRAY legacy", async () => {
    const res = await request("GET", "/service/operator/clientes", undefined, autorizado());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "ten_1", name: "Sol" }]);
  });

  it("GET /agenda sigue devolviendo { desde, hasta, total, citas }", async () => {
    const res = await request("GET", "/service/operator/agenda?desde=2026-07-07&hasta=2026-07-07", undefined, autorizado());
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["citas", "desde", "hasta", "total"]);
  });

  it("GET /contactos sigue delegando en el listado compartido", async () => {
    asMock(prisma.prospectContact.findMany).mockResolvedValue([{ id: "pc_1" }]);
    const res = await request("GET", "/service/operator/contactos", undefined, autorizado());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "pc_1" }]);
  });
});


// ── S15 (T8b): el mensaje de botones se reescribe con el progreso y el resultado
// (petición textual del dueño, L28): al confirmar desaparecen los botones y el
// MISMO mensaje pasa a "⏳ Creando contacto…", mueve los puntos mientras la acción
// tarda, y termina en "✅ Contacto creado" sin ids ni detalle técnico.

describe("S15: se captura el message_id y se edita ESE mensaje", () => {
  it("el primer edit reescribe el mensaje de los botones, sin teclado", async () => {
    telegramResponde(4321);
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });
    const token = await pedirConfirmacion({
      metodo: "POST",
      ruta: "/service/operator/clientes",
      body: { nombre: "Bar Pepe" },
    });

    const confirmacion = await request(
      "POST",
      `/service/operator/confirmaciones/${token}/confirmar`,
      undefined,
      autorizado()
    );
    expect(confirmacion.status).toBe(201);

    const ed = ediciones();
    // Acción rápida: primero el progreso, después el resultado. Nada más.
    expect(ed).toHaveLength(2);
    expect(ed[0].payload).toEqual({
      chat_id: Number(TG_CHAT_ID),
      message_id: 4321,
      text: "⏳ Creando cliente…",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });
    expect(ed.at(-1)!.payload.text).toBe("✅ Cliente creado");
    expect(ed.at(-1)!.payload.message_id).toBe(4321);
  });

  it("si Telegram no devuelve message_id, la acción se ejecuta igual y no se edita nada", async () => {
    telegramResponde(null);
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });
    const token = await pedirConfirmacion({
      metodo: "POST",
      ruta: "/service/operator/clientes",
      body: { nombre: "Bar Pepe" },
    });

    const confirmacion = await request(
      "POST",
      `/service/operator/confirmaciones/${token}/confirmar`,
      undefined,
      autorizado()
    );

    expect(confirmacion.status).toBe(201);
    expect(confirmacion.body).toEqual({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });
    expect(ediciones()).toHaveLength(0);
  });
});

describe("S15: textos exactos de progreso y resultado", () => {
  const TEXTOS_EXACTOS = [
    {
      nombre: "crear contacto",
      metodo: "POST",
      ruta: "/service/operator/contactos",
      body: { name: "Bar Pepe" },
      preparar: () => asMock(prisma.prospectContact.create).mockResolvedValue({ id: "pc_9", name: "Bar Pepe" }),
      status: 201,
      progreso: "⏳ Creando contacto…",
      completado: "✅ Contacto creado",
      sinDetalle: "pc_9",
    },
    {
      nombre: "borrar cliente",
      metodo: "DELETE",
      ruta: "/service/operator/clientes/ten_1",
      body: undefined,
      preparar: () => asMock(prisma.tenant.updateMany).mockResolvedValue({ count: 1 }),
      status: 200,
      progreso: "⏳ Borrando cliente…",
      completado: "✅ Cliente borrado",
      sinDetalle: "ten_1",
    },
  ] as const;

  it.each(TEXTOS_EXACTOS)("$nombre → progreso y después resultado", async (caso) => {
    telegramResponde(88);
    caso.preparar();
    const token = await pedirConfirmacion({ metodo: caso.metodo, ruta: caso.ruta, body: caso.body });

    const confirmacion = await request(
      "POST",
      `/service/operator/confirmaciones/${token}/confirmar`,
      undefined,
      autorizado()
    );

    expect(confirmacion.status).toBe(caso.status);
    const textos = ediciones().map((e) => e.payload.text);
    expect(textos).toEqual([caso.progreso, caso.completado]);
    // Sin ids ni detalle técnico en lo que lee el humano.
    for (const texto of textos) {
      expect(texto).not.toContain(caso.sinDetalle);
      expect(texto).not.toContain("agencia_");
      expect(texto).not.toMatch(/\d/);
    }
  });
});

describe("S15: frases por acción en el registro de las doce escrituras", () => {
  it.each(ESCRITURAS)("$accion tiene progresivo, completado y fallo, sin ids ni detalle técnico", (caso) => {
    const frases = accionDeEscritura(caso.accion)?.frases;
    expect(frases, caso.accion).toBeTruthy();
    for (const texto of [frases!.progresivo, frases!.completado, frases!.fallo]) {
      expect(typeof texto).toBe("string");
      expect(texto.trim()).toBe(texto);
      expect(texto.length).toBeGreaterThan(0);
      expect(texto).not.toMatch(/\d/);
      expect(texto).not.toMatch(/_/);
      expect(texto.toLowerCase()).not.toContain("agencia");
    }
    expect(frases!.progresivo).toMatch(/^(Creando|Editando|Borrando|Convirtiendo) /);
  });
});

describe("S15: acción lenta → los puntos se mueven, acotados", () => {
  it("ciclea '.', '..', '...' sin pasar del tope de ediciones y termina en ✅", async () => {
    telegramResponde(99);
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });
    const token = await pedirConfirmacion({
      metodo: "POST",
      ruta: "/service/operator/clientes",
      body: { nombre: "Bar Pepe" },
    });

    // Temporizadores falsos SÓLO para la animación: el HTTP de arriba ya terminó.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let liberar: (valor: unknown) => void = () => {};
    asMock(prisma.tenant.create).mockImplementation(() => new Promise((resolve) => (liberar = resolve)));

    const res = resFalsa();
    const ejecucion = confirmarAccionHandler({ params: { token } } as any, res);

    await vi.advanceTimersByTimeAsync(0); // primer edit: "⏳ Creando cliente…"
    await vi.advanceTimersByTimeAsync(10_000); // 12 intervalos: la animación se corta sola

    const animacion = ediciones()
      .slice(1)
      .map((e) => e.payload.text);
    expect(animacion.length).toBeGreaterThan(0);
    expect(animacion.length).toBeLessThanOrEqual(PROGRESO_MAX_PASOS);
    expect(animacion[0]).toBe("⏳ Creando cliente.");
    expect(animacion[1]).toBe("⏳ Creando cliente..");
    expect(animacion[2]).toBe("⏳ Creando cliente...");
    // Sigue en curso: no se ha anunciado ningún resultado todavía.
    expect(ediciones().at(-1)!.payload.text).not.toContain("✅");

    liberar({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });
    await ejecucion;

    expect(res.statusCode).toBe(201);
    expect(ediciones().at(-1)!.payload.text).toBe("✅ Cliente creado");
  });
});

describe("S15: fallo de negocio, cancelación y caducidad se cuentan al humano", () => {
  it("fallo de negocio → aviso honesto sin detalle técnico y respuesta HTTP intacta", async () => {
    telegramResponde(12);
    asMock(prisma.prospectContact.create).mockRejectedValue(new Error("relation does not exist"));
    const token = await pedirConfirmacion({
      metodo: "POST",
      ruta: "/service/operator/contactos",
      body: { name: "Bar Pepe" },
    });

    const confirmacion = await request(
      "POST",
      `/service/operator/confirmaciones/${token}/confirmar`,
      undefined,
      autorizado()
    );

    // Mismo contrato de siempre para el MCP: la acción responde lo suyo.
    expect(confirmacion.status).toBe(500);
    expect(confirmacion.body).toEqual({ error: "No se pudo crear el contacto" });

    const ultimo = ediciones().at(-1)!.payload.text;
    expect(ultimo).toBe("⚠️ No se pudo completar: crear el contacto");
    expect(ultimo).not.toContain("relation does not exist");
  });

  it("cancelar → el mensaje pasa a cancelada y la respuesta sigue siendo { cancelada: true }", async () => {
    telegramResponde(7);
    const token = await pedirConfirmacion({
      metodo: "POST",
      ruta: "/service/operator/clientes",
      body: { nombre: "Bar Pepe" },
    });

    const cancelacion = await request(
      "POST",
      `/service/operator/confirmaciones/${token}/cancelar`,
      undefined,
      autorizado()
    );

    expect(cancelacion.status).toBe(200);
    expect(cancelacion.body).toEqual({ cancelada: true });
    const ed = ediciones();
    expect(ed).toHaveLength(1);
    expect(ed[0].payload).toEqual({
      chat_id: Number(TG_CHAT_ID),
      message_id: 7,
      text: "❌ Acción cancelada",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });
  });
});

describe("S15: caducidad, fallo de Telegram y fuga de tokens", () => {
  it.each([
    ["confirmar", "confirmar"],
    ["cancelar", "cancelar"],
  ])("token caducado al %s → 410 y el mensaje avisa de la caducidad", async (_nombre, sufijo) => {
    telegramResponde(31);
    vi.useFakeTimers({ toFake: ["Date"] });
    const token = await pedirConfirmacion({
      metodo: "POST",
      ruta: "/service/operator/clientes",
      body: { nombre: "Bar Pepe" },
    });

    vi.setSystemTime(new Date(Date.now() + CONFIRMACION_TTL_MS + 1_000));
    const res = await request(
      "POST",
      `/service/operator/confirmaciones/${token}/${sufijo}`,
      undefined,
      autorizado()
    );

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("confirmacion_caducada");
    const ed = ediciones();
    expect(ed).toHaveLength(1);
    expect(ed[0].payload.text).toBe("⌛ La confirmación caducó, pedí la acción de nuevo");
    expect(ed[0].payload.message_id).toBe(31);
    sinEscrituras();
  });

  it("si Telegram no deja editar, la acción se ejecuta igual y la respuesta HTTP no cambia", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).endsWith("/sendMessage")) {
        return { json: async () => ({ ok: true, result: { message_id: 5 } }) };
      }
      return { json: async () => ({ ok: false, description: "Bad Request: message can't be edited" }) };
    });
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });
    const token = await pedirConfirmacion({
      metodo: "POST",
      ruta: "/service/operator/clientes",
      body: { nombre: "Bar Pepe" },
    });

    const confirmacion = await request(
      "POST",
      `/service/operator/confirmaciones/${token}/confirmar`,
      undefined,
      autorizado()
    );

    expect(confirmacion.status).toBe(201);
    expect(confirmacion.body).toEqual({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });
    expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
    // El fallo de edición se registra SIN el token del bot ni el de confirmación.
    const registros = JSON.stringify([...asMock(logger.warn).mock.calls, ...asMock(logger.error).mock.calls]);
    expect(registros).not.toContain(TG_BOT_TOKEN);
    expect(registros).not.toContain(token);
  });

  it("ninguna edición lleva el token de confirmación ni el del bot, siempre al chat del operador", async () => {
    telegramResponde(21);
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_7", codigo: "cli-07", name: "Bar Pepe" });
    const token = await pedirConfirmacion({
      metodo: "POST",
      ruta: "/service/operator/clientes",
      body: { nombre: "Bar Pepe" },
    });

    await request("POST", `/service/operator/confirmaciones/${token}/confirmar`, undefined, autorizado());

    const ed = ediciones();
    expect(ed.length).toBeGreaterThan(0);
    for (const llamada of ed) {
      const texto = JSON.stringify(llamada.payload);
      expect(texto).not.toContain(token);
      expect(texto).not.toContain(TOKEN);
      expect(texto).not.toContain(TG_BOT_TOKEN);
      expect(llamada.payload.chat_id).toBe(Number(TG_CHAT_ID));
    }
  });
});
