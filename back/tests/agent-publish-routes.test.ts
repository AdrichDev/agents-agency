/**
 * H3 (aa-agente-ciclo-vida-publicacion) — Acciones de publicación (T3) y el guard de borrado.
 *
 * Publicar tiene endpoint propio y no es un campo del formulario: es el instante en que el
 * agente empieza a atender al público Y a facturar. Antes de este change ese instante era el
 * alta y nadie lo decidía. Se prueba con el router real y `lifecycle.ts` real (prisma
 * mockeado); `agent/service.ts` se mockea porque aquí no se prueba el CRUD.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), count: vi.fn() },
    agentStatusEvent: { create: vi.fn(), findMany: vi.fn() },
    channelConnection: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/agent/service", () => ({
  listAgents: vi.fn(),
  createAgent: vi.fn(),
  getAgentDetail: vi.fn(),
  updateAgent: vi.fn(async (id: string, data: unknown) => ({ id, ...(data as object) })),
  deleteAgent: vi.fn(),
  updateWidgetConfig: vi.fn(),
  updateEcommerceConfig: vi.fn(),
  listAgentLeads: vi.fn(),
  recheckOpenclawProvisioning: vi.fn(),
  setAgentSkills: vi.fn(),
}));
vi.mock("@/lib/integrations/oauth", () => ({ encryptToken: vi.fn(() => "enc") }));
vi.mock("@/lib/channels/telegram-pairing", () => ({ setPairing: vi.fn() }));
vi.mock("@/lib/channels/webhook-shared", () => ({ decryptCreds: vi.fn() }));
vi.mock("@/lib/channels/telegram", () => ({ validateToken: vi.fn() }));

import { prisma } from "@/lib/db";
import { updateAgent, createAgent } from "@/lib/agent/service";
import { agentsRouter } from "@/routes/agents";
import { HttpError } from "@/lib/http";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "u1", email: "op@estudio.com", role: "admin" } as never;
    next();
  });
  app.use("/api/agents", agentsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message });
  });
  return app;
}

function request(
  app: express.Express,
  method: string,
  path: string,
  payload?: unknown
): Promise<{ status: number; body: any }> {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const headers: Record<string, string> = body
    ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }
    : {};
  return new Promise((resolve, reject) => {
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

/** Agente publicable: con tenant y con prompt. */
function publicable(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    status: "draft",
    tenantId: "tenant-1",
    systemPrompt: "Eres útil",
    channel: "widget",
    channelConnections: [] as { provider: string }[],
    publishedAt: null,
    ...over,
  };
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  app = buildApp();
  asMock(prisma.$transaction).mockImplementation((ops: any[]) => Promise.all(ops));
  asMock(prisma.agent.findUnique).mockResolvedValue(publicable());
  asMock(prisma.agent.findUniqueOrThrow).mockResolvedValue({
    id: "a1",
    status: "draft",
    publishedAt: null,
  });
  asMock(prisma.agent.update).mockImplementation(async ({ data }: any) => ({
    id: "a1",
    ...data,
  }));
  asMock(prisma.agentStatusEvent.create).mockResolvedValue({ id: "ev1" });
});

describe("T3.1 — POST /:id/publish", () => {
  it("agente completo ⇒ 200, published y sin avisos", async () => {
    const res = await request(app, "POST", "/api/agents/a1/publish");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, changed: true, status: "published", warnings: [] });
  });

  it("sin tenant ⇒ 400 diciendo qué falta (no un 'faltan datos' a adivinar)", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ tenantId: null }));

    const res = await request(app, "POST", "/api/agents/a1/publish");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cliente/i);
    expect(prisma.agent.update).not.toHaveBeenCalled();
  });

  it("sin prompt ⇒ 400", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ systemPrompt: "  " }));

    const res = await request(app, "POST", "/api/agents/a1/publish");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/prompt/i);
  });

  it("canal whatsapp sin conexión ⇒ 200 CON aviso, y publicado", async () => {
    // T0.1b: 3 de los 6 agentes que servían tráfico en producción están así y funcionan por
    // widget. Bloquearlo habría rechazado la mitad de los agentes vendidos.
    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ channel: "whatsapp" }));

    const res = await request(app, "POST", "/api/agents/a1/publish");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toMatch(/whatsapp/i);
  });

  it("suspended ⇒ 409: el propietario no levanta una suspensión de la plataforma", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ status: "suspended" }));

    const res = await request(app, "POST", "/api/agents/a1/publish");

    expect(res.status).toBe(409);
    expect(prisma.agent.update).not.toHaveBeenCalled();
  });

  it("archived ⇒ 200: publicar ES la restauración, y queda fechada", async () => {
    // Rechazarlo dejaría `archived` sin salida: un agente archivado por error sólo se
    // recuperaría a mano en la base de datos. Las precondiciones se comprueban igual y la
    // transición deja su evento archived→published.
    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ status: "archived" }));
    // `transitionAgentStatus` relee el estado por su cuenta (`findUniqueOrThrow`): si aquí no
    // se declara, el evento diría `from: "draft"` y la prueba no demostraría nada.
    asMock(prisma.agent.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "archived",
      publishedAt: null,
    });

    const res = await request(app, "POST", "/api/agents/a1/publish");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    expect(asMock(prisma.agentStatusEvent.create).mock.calls[0][0].data).toMatchObject({
      from: "archived",
      to: "published",
    });
  });

  it("agente inexistente ⇒ 404", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(null);

    expect((await request(app, "POST", "/api/agents/nope/publish")).status).toBe(404);
  });
});

describe("T3.3 — idempotencia", () => {
  it("publicar ya publicado ⇒ 200 con changed:false, sin escribir ni duplicar evento", async () => {
    const ya = new Date("2026-06-01T10:00:00Z");
    asMock(prisma.agent.findUnique).mockResolvedValue(
      publicable({ status: "published", publishedAt: ya })
    );
    asMock(prisma.agent.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "published",
      publishedAt: ya,
    });

    const res = await request(app, "POST", "/api/agents/a1/publish");

    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
    expect(prisma.agent.update).not.toHaveBeenCalled();
    expect(prisma.agentStatusEvent.create).not.toHaveBeenCalled();
  });
});

describe("T3.2 — POST /:id/unpublish", () => {
  it("published ⇒ draft, con motivo en el evento", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ status: "published" }));
    asMock(prisma.agent.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "published",
      publishedAt: new Date(),
    });

    const res = await request(app, "POST", "/api/agents/a1/unpublish");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, changed: true, status: "draft" });
    expect(asMock(prisma.agentStatusEvent.create).mock.calls[0][0].data).toMatchObject({
      from: "published",
      to: "draft",
      actor: "u1",
      reason: "unpublished by owner",
    });
  });

  it("despublicar NO pasa por suspended: eso es de la plataforma, no del propietario", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ status: "published" }));
    asMock(prisma.agent.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "published",
      publishedAt: new Date(),
    });

    await request(app, "POST", "/api/agents/a1/unpublish");

    expect(asMock(prisma.agent.update).mock.calls[0][0].data.status).toBe("draft");
  });

  it("suspended y archived ⇒ 409 (no se despublica lo que no controla el propietario)", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ status: "suspended" }));
    expect((await request(app, "POST", "/api/agents/a1/unpublish")).status).toBe(409);

    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ status: "archived" }));
    expect((await request(app, "POST", "/api/agents/a1/unpublish")).status).toBe(409);
  });
});

describe("T3.4 — el PATCH general no cambia el estado", () => {
  it("PATCH con status en el body ⇒ 400 en voz alta, y no se toca el agente", async () => {
    // Zod ya lo descartaría en silencio; el silencio es lo peligroso, porque quien llame se
    // queda creyendo que publicó. Y publicar factura.
    const res = await request(app, "PATCH", "/api/agents/a1", {
      name: "Bot",
      status: "published",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/publish/);
    expect(updateAgent).not.toHaveBeenCalled();
    expect(prisma.agent.update).not.toHaveBeenCalled();
  });

  it("PATCH normal sigue funcionando", async () => {
    const res = await request(app, "PATCH", "/api/agents/a1", { name: "Bot" });

    expect(res.status).toBe(200);
    expect(updateAgent).toHaveBeenCalledWith("a1", expect.objectContaining({ name: "Bot" }));
  });
});

describe("T3.5 — historial de estados", () => {
  it("GET /:id/status-events devuelve las transiciones en orden cronológico", async () => {
    // Es lo que permite responder "¿estuvo publicado en junio?", que es LA pregunta de la
    // factura.
    asMock(prisma.agentStatusEvent.findMany).mockResolvedValue([
      { id: "e1", from: "draft", to: "published" },
      { id: "e2", from: "published", to: "draft" },
    ]);

    const res = await request(app, "GET", "/api/agents/a1/status-events");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(asMock(prisma.agentStatusEvent.findMany).mock.calls[0][0]).toMatchObject({
      where: { agentId: "a1" },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("T3.6 — POST /:id/archive", () => {
  it("archiva y deja rastro con el motivo recibido", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ status: "published" }));
    asMock(prisma.agent.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "published",
      publishedAt: new Date(),
    });

    const res = await request(app, "POST", "/api/agents/a1/archive", { reason: "fin de contrato" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");
    expect(asMock(prisma.agentStatusEvent.create).mock.calls[0][0].data).toMatchObject({
      to: "archived",
      reason: "fin de contrato",
    });
  });

  it("suspended ⇒ 409: archivar no puede ser la salida de emergencia de la factura", async () => {
    // Archivar saca al agente de `countBillableAgents`. Sin este corte, un agente suspendido
    // por impago se archiva y deja de figurar como facturable — premiar el impago. El
    // propietario no toca el estado de lo que ha suspendido la plataforma por ninguna de las
    // tres puertas (publish, unpublish, archive).
    asMock(prisma.agent.findUnique).mockResolvedValue(publicable({ status: "suspended" }));

    const res = await request(app, "POST", "/api/agents/a1/archive");

    expect(res.status).toBe(409);
    expect(prisma.agentStatusEvent.create).not.toHaveBeenCalled();
  });
});

/**
 * aa-puesta-en-marcha-agente (T3.5) — El final del wizard.
 *
 * El wizard publica encadenando `POST /api/agents` y `POST /:id/publish`. Lo que estos
 * casos defienden es que esa decisión de diseño no abre un segundo camino de transición:
 * el alta sigue sin poder publicar por su cuenta, y publicar sigue pasando por el mismo
 * endpoint que ya existía. Si alguien "optimiza" el alta metiéndole el estado, aquí se ve.
 */
describe("T3.5 — crear y publicar desde el wizard", () => {
  beforeEach(() => {
    asMock(createAgent).mockResolvedValue({ id: "a1", name: "Bot", status: "draft" });
  });

  it("GWT3 — «Crear como borrador» no publica ni deja evento", async () => {
    const res = await request(app, "POST", "/api/agents", {
      name: "Bot",
      sector: "peluqueria",
      tenantId: "tenant-1",
      systemPrompt: "Eres útil",
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(prisma.agentStatusEvent.create).not.toHaveBeenCalled();
    expect(prisma.agent.update).not.toHaveBeenCalled();
  });

  it("GWT1/AC6 — «Crear y publicar» deja el agente publicado con UN solo evento", async () => {
    const alta = await request(app, "POST", "/api/agents", {
      name: "Bot",
      sector: "peluqueria",
      tenantId: "tenant-1",
      systemPrompt: "Eres útil",
    });
    expect(alta.status).toBe(201);
    // Tras el alta, todavía nada: publicar es la segunda llamada, no un efecto del alta.
    expect(prisma.agentStatusEvent.create).not.toHaveBeenCalled();

    const pub = await request(app, "POST", `/api/agents/${alta.body.id}/publish`);

    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ ok: true, changed: true, status: "published" });
    expect(pub.body.publishedAt).toBeTruthy();
    expect(prisma.agentStatusEvent.create).toHaveBeenCalledTimes(1);
    expect(asMock(prisma.agentStatusEvent.create).mock.calls[0][0].data).toMatchObject({
      from: "draft",
      to: "published",
      actor: "u1",
    });
  });

  it("AC6 — el alta no publica aunque le metan `status` en el cuerpo", async () => {
    // El wizard manda dos llamadas precisamente para esto. Si el alta aceptase el estado,
    // habría dos caminos para facturar y sólo uno dejaría rastro en `AgentStatusEvent`.
    await request(app, "POST", "/api/agents", {
      name: "Bot",
      sector: "peluqueria",
      tenantId: "tenant-1",
      systemPrompt: "Eres útil",
      status: "published",
      publishedAt: new Date().toISOString(),
    });

    const payload = asMock(createAgent).mock.calls[0][0];
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("publishedAt");
    expect(prisma.agentStatusEvent.create).not.toHaveBeenCalled();
  });
});

