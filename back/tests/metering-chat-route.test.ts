/**
 * H1 (aa-metering-fail-closed) — Contrato de `POST /api/chat` frente al metering.
 *
 * Dos cosas que este endpoint hacía mal:
 *  1. devolvía 500 ante cualquier fallo, así que un corte por cupo (402) llegaba al widget
 *     como "error interno" y parecía una caída del servicio;
 *  2. `test: true` exime del gate de saldo, y esta ruta está en la allowlist PÚBLICA
 *     (`public-routes.ts`) → sin filtro, cualquiera enviaría `{publicKey, test: true}` y
 *     consumiría sin cupo ni kill switch. El flag sólo vale con sesión de operador.
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

import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { aiRouter } from "@/routes/ai";
import { isPublic } from "@/lib/public-routes";
import { HttpError } from "@/lib/http";

const mockFindAgent = prisma.agent.findUnique as ReturnType<typeof vi.fn>;
const mockChat = chatWithAgent as ReturnType<typeof vi.fn>;

/**
 * Monta el router imitando al gate global de `index.ts`: en rutas públicas también resuelve
 * `req.user` si llega un Bearer válido, que es justo de lo que depende la exención de test.
 */
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

describe("T3.1 — el widget recibe el status real, no 500", () => {
  it("402 del metering llega como 402 con su motivo", async () => {
    mockChat.mockRejectedValue(
      new HttpError(402, "Límite de uso del asistente excedido. Contacta con el administrador.")
    );

    const res = await rawRequest(buildApp(), "POST", "/api/chat", {
      publicKey: "pk-1",
      message: "hola",
    });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/límite de uso/i);
  });

  it("un fallo no-HttpError sigue siendo 500", async () => {
    mockChat.mockRejectedValue(new Error("openai down"));

    const res = await rawRequest(buildApp(), "POST", "/api/chat", {
      publicKey: "pk-1",
      message: "hola",
    });

    expect(res.status).toBe(500);
  });

  it("agente inexistente → 404 sin llamar al motor", async () => {
    mockFindAgent.mockResolvedValue(null);

    const res = await rawRequest(buildApp(), "POST", "/api/chat", {
      publicKey: "desconocida",
      message: "hola",
    });

    expect(res.status).toBe(404);
    expect(mockChat).not.toHaveBeenCalled();
  });
});

describe("seguridad — `test: true` no es un bypass del gate en la ruta pública", () => {
  it("POST /api/chat sigue siendo público (premisa del riesgo)", () => {
    expect(isPublic("POST", "/api/chat")).toBe(true);
  });

  it("sin sesión, `test: true` se ignora → isTest=false llega al motor", async () => {
    await rawRequest(buildApp(), "POST", "/api/chat", {
      publicKey: "pk-1",
      message: "hola",
      test: true,
    });

    // 6º argumento = isTest. Debe ser false pese al flag del cuerpo.
    expect(mockChat).toHaveBeenCalledWith("a1", "hola", undefined, "widget", undefined, false);
  });

  it("con sesión de operador, `test: true` sí se honra", async () => {
    await rawRequest(buildApp({ authenticated: true }), "POST", "/api/chat", {
      agentId: "a1",
      message: "hola",
      test: true,
    });

    expect(mockChat).toHaveBeenCalledWith("a1", "hola", undefined, "widget", undefined, true);
  });

  it("no se propaga el clientId del cuerpo: el tenant lo resuelve el motor", async () => {
    await rawRequest(buildApp(), "POST", "/api/chat", {
      publicKey: "pk-1",
      message: "hola",
    });

    // 5º argumento (clientId, deprecado) siempre undefined.
    expect(mockChat.mock.calls[0][4]).toBeUndefined();
  });
});
