/**
 * H3 (aa-agente-ciclo-vida-publicacion) — `POST /service/telegram/send`, el respondedor
 * manual del CRM, también respeta el estado del agente.
 *
 * Hueco encontrado en la verificación del change, no en la spec: T2.5 cerró las vías sin LLM
 * que METEN datos (reservar, slots, lead) y se dejó una que SACA mensajes. Esta ruta manda un
 * Telegram real a una persona en nombre del agente y no leía `status`, así que un agente
 * suspendido por impago seguía teniendo voz.
 *
 * Se usa la MISMA exención acotada que la consola del operador (`isTest`), porque detrás hay
 * un humano del CRM escribiendo, no el agente atendiendo solo:
 *   - `draft` pasa: responder a mano a alguien que ya escribió es atención al cliente.
 *   - `suspended` y `archived` no pasan: si el respondedor manual sirviera de vía, el kill
 *     switch de la plataforma no apagaría nada. Mismo criterio que ya se aplicó a la consola.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findUnique: vi.fn() },
    agent: { findUnique: vi.fn() },
    channelConnection: { findUnique: vi.fn() },
    message: { create: vi.fn(async () => ({ id: "m1" })), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/channels/telegram", () => ({ sendMessage: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/channels/webhook-shared", () => ({
  decryptCreds: vi.fn(() => ({ token: "tok" })),
}));
vi.mock("@/lib/channels/crm-telegram-fanout", () => ({ fanOutTelegramToCrm: vi.fn() }));
vi.mock("@/lib/operator-token", () => ({
  // El token de servicio no es lo que se prueba aquí: se da por válido para que lo único que
  // pueda cortar sea el estado del agente. Es una FACTORÍA de middleware (`requireOperatorToken()`
  // en el `router.use`), no el middleware en sí.
  requireOperatorToken: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next()
  ),
}));

import { prisma } from "@/lib/db";
import { sendMessage as tgSendMessage } from "@/lib/channels/telegram";
import { serviceTelegramRouter } from "@/routes/service-telegram";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/service/telegram", serviceTelegramRouter);
  return app;
}

function request(
  app: express.Express,
  path: string,
  payload: unknown
): Promise<{ status: number; body: any }> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(body)),
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
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      req.write(body);
      req.end();
    });
  });
}

const PAYLOAD = {
  businessId: "biz-1",
  conversationId: "c1",
  text: "Le confirmo la cita del jueves.",
};

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  app = buildApp();
  asMock(prisma.conversation.findUnique).mockResolvedValue({
    id: "c1",
    agentId: "a1",
    metadata: { telegramChatId: "999" },
  });
  asMock(prisma.channelConnection.findUnique).mockResolvedValue({
    credentials: "enc:v1:x",
    status: "connected",
  });
});

describe("POST /service/telegram/send — gate de publicación", () => {
  it("published ⇒ envía", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue({ status: "published" });

    const res = await request(app, "/service/telegram/send", PAYLOAD);

    expect(res.status).toBe(200);
    expect(tgSendMessage).toHaveBeenCalled();
  });

  it("draft ⇒ envía: detrás hay un operador humano, como en la consola", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue({ status: "draft" });

    const res = await request(app, "/service/telegram/send", PAYLOAD);

    expect(res.status).toBe(200);
    expect(tgSendMessage).toHaveBeenCalled();
  });

  it("suspended ⇒ 402 y NO manda el mensaje", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue({ status: "suspended" });

    const res = await request(app, "/service/telegram/send", PAYLOAD);

    expect(res.status).toBe(402);
    expect(tgSendMessage).not.toHaveBeenCalled();
  });

  it("archived ⇒ 403 y NO manda el mensaje", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue({ status: "archived" });

    const res = await request(app, "/service/telegram/send", PAYLOAD);

    expect(res.status).toBe(403);
    expect(tgSendMessage).not.toHaveBeenCalled();
  });

  it("el corte por estado NO se presenta como 500", async () => {
    // El `catch` de la ruta era genérico: convertía cualquier throw en 500 "No se pudo enviar
    // el mensaje". Quien llama (el CRM) habría buscado un fallo de red en vez de leer que el
    // agente está suspendido. Mismo criterio que el 402 de H1 en /api/chat.
    asMock(prisma.agent.findUnique).mockResolvedValue({ status: "suspended" });

    const res = await request(app, "/service/telegram/send", PAYLOAD);

    expect(res.status).not.toBe(500);
    expect(String(res.body?.error ?? "")).not.toMatch(/No se pudo enviar/);
  });

  it("estado desconocido ⇒ no envía (fail-closed)", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue({ status: "vete-a-saber" });

    const res = await request(app, "/service/telegram/send", PAYLOAD);

    expect(res.status).toBe(403);
    expect(tgSendMessage).not.toHaveBeenCalled();
  });
});
