/**
 * aa-widget-error-visitante — Qué puede leer un visitante ANÓNIMO cuando el chat falla.
 *
 * `POST /api/chat` es pública y su respuesta se pinta literalmente en la web de un cliente. En
 * producción se vio el texto crudo de OpenAI ("429 You exceeded your current quota…") delante de un
 * visitante; y el catálogo de 402 incluye la condición de pago del cliente, que es peor.
 *
 * Dos cosas se prueban aquí, y son distintas:
 *  1. que el visitante no lea nada del error original (E1-E3, E5, E7);
 *  2. que el operador con sesión SÍ lo lea (E4) — sin esto habríamos cegado la consola, que es de
 *     donde el dueño del agente saca qué arreglar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/agent/engine", () => ({ chatWithAgent: vi.fn() }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn(), initSentry: vi.fn() }));

import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { captureError } from "@/lib/sentry";
import { aiRouter } from "@/routes/ai";
import { HttpError } from "@/lib/http";
import { visitorError, textosDeVisitante, TERMINOS_PROHIBIDOS } from "@/lib/agent/visitor-error";

const mockFindAgent = prisma.agent.findUnique as ReturnType<typeof vi.fn>;
const mockChat = chatWithAgent as ReturnType<typeof vi.fn>;
const mockCapture = captureError as ReturnType<typeof vi.fn>;

/** Mensajes reales del código, copiados para que la prueba falle si alguien los relaja. */
const MSG_IMPAGO =
  "El servicio está suspendido porque hay un pago pendiente. Regulariza la suscripción para reactivarlo.";
const MSG_PROVEEDOR =
  "429 You exceeded your current quota, please check your plan and billing details. " +
  "https://platform.openai.com/docs/guides/error-codes/api-errors";

function buildApp(opts: { authenticated?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  if (opts.authenticated) {
    app.use((req, _res, next) => {
      req.user = { id: "u1", email: "op@estudio.com", role: "admin" } as never;
      next();
    });
  }
  app.use("/api", aiRouter);
  return app;
}

function rawRequest(
  app: express.Express,
  method: string,
  path: string,
  payload?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers: Record<string, string> = {};
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
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
      });
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (body) req.write(body);
      req.end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindAgent.mockResolvedValue({ id: "a1", publicKey: "pk-1", tenantId: "tenant-1" });
  mockChat.mockResolvedValue({ conversationId: "conv-1", text: "Hola", toolCalls: [] });
});

describe("E1-E3, E5 — el visitante no lee nuestros errores", () => {
  it("E1 — el error del proveedor LLM no llega al visitante", async () => {
    mockChat.mockRejectedValue(new Error(MSG_PROVEEDOR));

    const res = await rawRequest(buildApp(), "POST", "/api/chat", {
      publicKey: "pk-1",
      message: "hola",
    });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL");
    // Lo que de verdad importa: nada del texto original sobrevive.
    for (const fuga of ["quota", "openai", "billing", "429", "platform."]) {
      expect(res.body.error.toLowerCase()).not.toContain(fuga);
    }
  });

  it("E2 — la condición de pago del cliente no se le cuenta a su visitante", async () => {
    mockChat.mockRejectedValue(new HttpError(402, MSG_IMPAGO));

    const res = await rawRequest(buildApp(), "POST", "/api/chat", {
      publicKey: "pk-1",
      message: "hola",
    });

    // El status se conserva: `webhook-shared` corta por 402 y H1 lo protege.
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SERVICE_LIMIT");
    for (const fuga of ["pago", "suscripción", "regulariza", "suspendido"]) {
      expect(res.body.error.toLowerCase()).not.toContain(fuga);
    }
  });

  it("E3 — el estado del agente tampoco se filtra", async () => {
    mockChat.mockRejectedValue(
      new HttpError(403, "Este asistente todavía no está publicado. Contacta con el administrador.")
    );

    const res = await rawRequest(buildApp(), "POST", "/api/chat", {
      publicKey: "pk-1",
      message: "hola",
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AGENT_UNAVAILABLE");
    expect(res.body.error.toLowerCase()).not.toContain("publicado");
  });

  it("E5 — agente inexistente: 404 genérico, no 'Agente no encontrado'", async () => {
    mockFindAgent.mockResolvedValue(null);

    const res = await rawRequest(buildApp(), "POST", "/api/chat", {
      publicKey: "desconocida",
      message: "hola",
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("AGENT_NOT_FOUND");
    expect(res.body.error.toLowerCase()).not.toContain("agente no encontrado");
    expect(mockChat).not.toHaveBeenCalled();
  });
});

describe("E4 — el operador con sesión sigue viendo el motivo real", () => {
  /**
   * Red de seguridad de R1. `ChatTester.tsx` recibe este texto por la excepción de `api<>`; si se
   * genériza también aquí, el dueño del agente deja de saber si le falta cupo o publicar.
   */
  it("con sesión, el mensaje llega palabra por palabra", async () => {
    mockChat.mockRejectedValue(new HttpError(402, MSG_IMPAGO));

    const res = await rawRequest(buildApp({ authenticated: true }), "POST", "/api/chat", {
      agentId: "a1",
      message: "hola",
    });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe(MSG_IMPAGO);
  });

  it("con sesión, un fallo interno también se ve entero", async () => {
    mockChat.mockRejectedValue(new Error(MSG_PROVEEDOR));

    const res = await rawRequest(buildApp({ authenticated: true }), "POST", "/api/chat", {
      agentId: "a1",
      message: "hola",
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe(MSG_PROVEEDOR);
  });
});

describe("E6 — los 5xx se registran, los 4xx no", () => {
  it("un fallo interno llama a captureError con agentId", async () => {
    mockChat.mockRejectedValue(new Error("boom"));

    await rawRequest(buildApp(), "POST", "/api/chat", { publicKey: "pk-1", message: "hola" });

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][1]).toMatchObject({ agentId: "a1" });
  });

  it("un 402 de cupo NO va a Sentry: es estado de servicio, no avería", async () => {
    mockChat.mockRejectedValue(new HttpError(402, MSG_IMPAGO));

    await rawRequest(buildApp(), "POST", "/api/chat", { publicKey: "pk-1", message: "hola" });

    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe("E7 — invariante de la tabla", () => {
  /**
   * Prueba la POLÍTICA, no una llamada: una fila nueva mal redactada tiene que ponerse roja sola,
   * sin que nadie se acuerde de añadirle un caso.
   */
  it("ninguna fila menciona proveedor, cupo, pago ni credenciales", () => {
    for (const texto of textosDeVisitante()) {
      for (const prohibido of TERMINOS_PROHIBIDOS) {
        expect(texto.toLowerCase()).not.toContain(prohibido);
      }
    }
  });

  it("el mensaje de entrada nunca se copia a la salida", () => {
    const SECRETO = "sk-proj-XyZ-secreto-del-cliente";
    for (const status of [400, 402, 403, 404, 429, 451, 500, 503]) {
      const salida = visitorError(new HttpError(status, SECRETO));
      expect(salida.error).not.toContain(SECRETO);
      expect(salida.status).toBe(status);
    }
    expect(visitorError(new Error(SECRETO)).error).not.toContain(SECRETO);
  });

  it("un error sin status es 500, no se cuela como 4xx", () => {
    expect(visitorError(new Error("x")).status).toBe(500);
    expect(visitorError("no es un Error").status).toBe(500);
    expect(visitorError(undefined).status).toBe(500);
  });

  it("el 429 del proveedor no se reenvía como 429 al visitante", () => {
    // Un `APIError` del SDK trae `.status = 429`, pero es el ritmo del PROVEEDOR, no del visitante.
    const errorSdk = Object.assign(new Error("rate limited"), { status: 429 });
    expect(visitorError(errorSdk).status).toBe(500);
  });
});
