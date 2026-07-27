/**
 * H5 (aa-portal-cliente, T3.6) — El portal sólo devuelve lo del tenant de la sesión.
 *
 * Estos tests miran el WHERE que llega a Prisma, no sólo el status. Un test que se conforma con un 200
 * no distingue entre "filtró bien" y "no filtró nada": la consulta sin `tenantId` también devuelve 200,
 * con los datos del vecino dentro. Aquí se asierta que el filtro va en la consulta, que es el único
 * sitio donde de verdad aísla.
 *
 * El otro caso que se prueba es el `tenantId` inyectado por el cliente (query y body): tiene que ser
 * ignorado por completo. Si el portal lo mirara, cambiar de cliente sería editar la URL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// El logger NO se dobla: `observability.ts` lo pasa a `pino-http`, que espera un pino de verdad
// (`child`, `levels.values`). Mismo criterio que `calendar-route.test.ts`, que ya monta este
// errorHandler con el logger real.
vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn() },
    agent: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    conversation: { findMany: vi.fn(), findFirst: vi.fn() },
    message: { findMany: vi.fn() },
    tokenUsage: { aggregate: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { portalRouter } from "@/routes/portal";
// El mismo errorHandler que monta `index.ts`: sin él, un `throw HttpError(404)` acabaría en 500 y el
// test de "404 y no 403" comprobaría el envelope de otro middleware, no el de la app real.
import { errorHandler } from "@/lib/observability";
import { DEFAULT_TOKEN_QUOTA_PER_AGENT } from "@/lib/quota";
import type { SessionUser } from "@/lib/auth";

const mTenant = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mAgentMany = prisma.agent.findMany as ReturnType<typeof vi.fn>;
const mAgentFirst = prisma.agent.findFirst as ReturnType<typeof vi.fn>;
const mAgentCount = prisma.agent.count as ReturnType<typeof vi.fn>;
const mConvMany = prisma.conversation.findMany as ReturnType<typeof vi.fn>;
const mConvFirst = prisma.conversation.findFirst as ReturnType<typeof vi.fn>;
const mMsgMany = prisma.message.findMany as ReturnType<typeof vi.fn>;
const mUsage = prisma.tokenUsage.aggregate as ReturnType<typeof vi.fn>;

const cliente: SessionUser = {
  id: "u-cli",
  firstName: "Ana",
  lastName: "Cliente",
  email: "ana@negocio.es",
  role: "client",
  tenantId: "t1",
};

const TENANT_BASE = {
  id: "t1",
  name: "Negocio de Ana",
  isActive: true,
  credentialMode: "platform",
  tokenBalance: null,
  tokensUsedPeriod: 0,
  periodStart: new Date("2026-07-01T00:00:00.000Z"),
  periodAnchorDay: 1,
  plan: null,
};

function call(
  method: string,
  path: string,
  user: SessionUser | undefined = cliente,
  payload?: unknown
): Promise<{ status: number; body: any }> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use("/api/portal", portalRouter);
  app.use(errorHandler);

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      const headers: Record<string, string> = {};
      if (body) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(body));
      }
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null });
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
  mTenant.mockResolvedValue(TENANT_BASE);
  mAgentCount.mockResolvedValue(1);
  mAgentMany.mockResolvedValue([]);
  mConvMany.mockResolvedValue([]);
  mMsgMany.mockResolvedValue([]);
  mUsage.mockResolvedValue({ _sum: { tokens: 0 } });
});

describe("T3.2 — /me: lo contratado y lo gastado, con el cupo del gate", () => {
  it("consulta el tenant de la SESIÓN", async () => {
    await call("GET", "/api/portal/me");

    expect(mTenant.mock.calls[0][0].where).toEqual({ id: "t1" });
  });

  it("sin plan devuelve el cupo por defecto de la plataforma, no cero (H7)", async () => {
    const { status, body } = await call("GET", "/api/portal/me");

    expect(status).toBe(200);
    expect(body.plan).toBeNull();
    expect(body.usage.tokenQuota).toBe(DEFAULT_TOKEN_QUOTA_PER_AGENT);
    expect(body.usage.quotaSource).toBe("default");
    expect(body.usage.remaining).toBe(DEFAULT_TOKEN_QUOTA_PER_AGENT);
    expect(body.usage.warning).toBe("ok");
  });

  it("el aviso coincide con el punto en el que corta el gate (E5)", async () => {
    mTenant.mockResolvedValue({
      ...TENANT_BASE,
      tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT * 0.9,
    });

    const { body } = await call("GET", "/api/portal/me");

    expect(body.usage.warning).toBe("warn90");
  });

  it("freno de mano (`tokenBalance = 0`): cupo cero y restante cero", async () => {
    mTenant.mockResolvedValue({ ...TENANT_BASE, tokenBalance: 0 });

    const { body } = await call("GET", "/api/portal/me");

    expect(body.usage.tokenQuota).toBe(0);
    expect(body.usage.remaining).toBe(0);
    expect(body.usage.warning).toBe("exhausted");
  });

  it("byok: sin aviso, porque el cupo no se le aplica", async () => {
    mTenant.mockResolvedValue({
      ...TENANT_BASE,
      credentialMode: "byok",
      tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT,
    });

    const { body } = await call("GET", "/api/portal/me");

    expect(body.usage.warning).toBeNull();
  });

  it("AC9: ni un importe en la respuesta", async () => {
    mTenant.mockResolvedValue({
      ...TENANT_BASE,
      plan: { codigo: "chatbot", nombre: "Chatbot", tokenQuotaPerAgent: 10_000_000 },
    });

    const { body } = await call("GET", "/api/portal/me");

    const texto = JSON.stringify(body);
    expect(texto).not.toMatch(/price|precio|amount|importe|eur|€/i);
    // El plan viaja con `codigo` para que el front cruce su tarifa, y nada más.
    expect(body.plan).toEqual({ codigo: "chatbot", nombre: "Chatbot" });
  });

  it("sin tenant en la sesión: 403, no una consulta sin filtro", async () => {
    const { status } = await call("GET", "/api/portal/me", { ...cliente, tenantId: null });

    expect(status).toBe(403);
    expect(mTenant).not.toHaveBeenCalled();
  });

  it("tenant borrado con sesión viva: 404, no 500", async () => {
    mTenant.mockResolvedValue(null);

    const { status } = await call("GET", "/api/portal/me");

    expect(status).toBe(404);
  });
});

describe("T3.3 — /agents: sólo los suyos y sólo los vivos", () => {
  it("filtra por tenant de la sesión y por estados visibles", async () => {
    await call("GET", "/api/portal/agents");

    const where = mAgentMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe("t1");
    expect(where.status.in).toEqual(expect.arrayContaining(["published", "suspended"]));
    expect(where.status.in).not.toContain("draft");
    expect(where.status.in).not.toContain("archived");
  });

  it("no expone los secretos del agente: ni prompt, ni clave pública, ni modelo", async () => {
    await call("GET", "/api/portal/agents");

    const select = mAgentMany.mock.calls[0][0].select;
    expect(select.systemPrompt).toBeUndefined();
    expect(select.publicKey).toBeUndefined();
    expect(select.model).toBeUndefined();
  });

  it("adjunta el consumo del periodo por agente", async () => {
    mAgentMany.mockResolvedValue([{ id: "a1", name: "DorsIA", status: "published" }]);
    mUsage.mockResolvedValue({ _sum: { tokens: 4_200 } });

    const { body } = await call("GET", "/api/portal/agents");

    expect(body[0].tokensUsedPeriod).toBe(4_200);
  });

  it("sin tenant: 403 sin tocar la tabla de agentes", async () => {
    const { status } = await call("GET", "/api/portal/agents", { ...cliente, tenantId: null });

    expect(status).toBe(403);
    expect(mAgentMany).not.toHaveBeenCalled();
  });
});

describe("T3.4 / T3.5 — conversaciones: join por tenant y 404 en lo ajeno", () => {
  it("comprueba la propiedad del agente en el WHERE, no después de leerlo", async () => {
    mAgentFirst.mockResolvedValue({ id: "a1", name: "DorsIA" });

    await call("GET", "/api/portal/agents/a1/conversations");

    expect(mAgentFirst.mock.calls[0][0].where).toMatchObject({ id: "a1", tenantId: "t1" });
  });

  it("E1: agente de OTRO tenant ⇒ 404 y cuerpo sin datos", async () => {
    mAgentFirst.mockResolvedValue(null); // el where con tenantId no lo encuentra

    const { status, body } = await call("GET", "/api/portal/agents/a-ajeno/conversations");

    expect(status).toBe(404);
    expect(body).toEqual({ error: "Agente no encontrado" });
    // Y no se llegó a listar nada.
    expect(mConvMany).not.toHaveBeenCalled();
  });

  it("excluye las conversaciones de la consola de pruebas (AC8)", async () => {
    mAgentFirst.mockResolvedValue({ id: "a1", name: "DorsIA" });

    await call("GET", "/api/portal/agents/a1/conversations");

    expect(mConvMany.mock.calls[0][0].where).toEqual({ agentId: "a1", isTest: false });
  });

  it("pagina: pide un elemento más que el límite y devuelve cursor", async () => {
    mAgentFirst.mockResolvedValue({ id: "a1", name: "DorsIA" });
    mConvMany.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) => ({
        id: `c${i}`,
        channel: "widget",
        createdAt: new Date("2026-07-10T10:00:00.000Z"),
        _count: { messages: 2 },
      }))
    );

    const { body } = await call("GET", "/api/portal/agents/a1/conversations?limit=2");

    expect(mConvMany.mock.calls[0][0].take).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBe("c1");
  });

  it("sin más páginas, `nextCursor` es null y no se adivina por la longitud", async () => {
    mAgentFirst.mockResolvedValue({ id: "a1", name: "DorsIA" });
    mConvMany.mockResolvedValue([
      { id: "c0", channel: "widget", createdAt: new Date(), _count: { messages: 1 } },
    ]);

    const { body } = await call("GET", "/api/portal/agents/a1/conversations?limit=20");

    expect(body.nextCursor).toBeNull();
  });

  it("un `limit` desmedido se rechaza: leer no es descargar la base entera", async () => {
    mAgentFirst.mockResolvedValue({ id: "a1", name: "DorsIA" });

    const { status } = await call("GET", "/api/portal/agents/a1/conversations?limit=100000");

    expect(status).toBe(400);
  });
});

describe("T3.4 — mensajes: el join a Agent es lo único que aísla", () => {
  it("el WHERE exige que el agente de la conversación sea del tenant de la sesión", async () => {
    mConvFirst.mockResolvedValue({
      id: "c1",
      channel: "widget",
      createdAt: new Date(),
      agentId: "a1",
    });

    await call("GET", "/api/portal/conversations/c1/messages");

    expect(mConvFirst.mock.calls[0][0].where).toMatchObject({
      id: "c1",
      isTest: false,
      agent: { tenantId: "t1", status: { in: expect.anything() } },
    });
  });

  it("conversación de otro tenant ⇒ 404 sin leer mensajes", async () => {
    mConvFirst.mockResolvedValue(null);

    const { status, body } = await call("GET", "/api/portal/conversations/c-ajena/messages");

    expect(status).toBe(404);
    expect(body).toEqual({ error: "Conversación no encontrada" });
    expect(mMsgMany).not.toHaveBeenCalled();
  });

  it("no expone `toolCalls`: es la mecánica del agente, no la conversación", async () => {
    mConvFirst.mockResolvedValue({
      id: "c1",
      channel: "widget",
      createdAt: new Date(),
      agentId: "a1",
    });

    await call("GET", "/api/portal/conversations/c1/messages");

    expect(mMsgMany.mock.calls[0][0].select.toolCalls).toBeUndefined();
  });
});

describe("AC4 — el tenant de la petición se ignora", () => {
  it("`?tenantId=` de otro cliente no cambia la consulta", async () => {
    await call("GET", "/api/portal/me?tenantId=t-ajeno");

    expect(mTenant.mock.calls[0][0].where).toEqual({ id: "t1" });
  });

  it("un `tenantId` en el body tampoco: el portal no lo lee de ninguna parte", async () => {
    await call("GET", "/api/portal/me", cliente, { tenantId: "t-ajeno" });

    expect(mTenant.mock.calls[0][0].where).toEqual({ id: "t1" });
  });

  it("en el listado de agentes, el filtro sigue siendo el de la sesión", async () => {
    await call("GET", "/api/portal/agents?tenantId=t-ajeno");

    expect(mAgentMany.mock.calls[0][0].where.tenantId).toBe("t1");
  });
});
