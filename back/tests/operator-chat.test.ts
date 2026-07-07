/**
 * Tests del proxy del chat del operador (5.5a aa-centro-mando-agenda-telegram):
 * GET /api/operator-chat/history y POST /api/operator-chat/send contra el
 * gateway de OpenClaw.
 *
 * Contrato real de lib/openclaw/admin-rpc.ts (post-refactor F2, ver spike.md):
 * - chatHistory NO usa el admin RPC (el gateway no expone chat.history) — lee
 *   el JSONL de sesión vía `docker exec` (mockeado aquí con node:child_process).
 * - chatSend SÍ usa fetch, pero contra el endpoint OpenAI-compat
 *   `${OPENCLAW_BASE_URL||OPENCLAW_ADMIN_URL+"/v1"}/chat/completions`, no
 *   `/api/v1/admin/rpc`.
 *
 * El gate de auth se espeja con un middleware mínimo (patrón de
 * tests/auth-gate.test.ts) y además se asegura que las rutas NO están en la
 * allowlist pública real (lib/public-routes.ts) — la garantía de que el gate
 * central de index.ts las protege.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isPublic } from "@/lib/public-routes";

const ORIGINAL_ENV = { ...process.env };

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => (execFileMock as any)(...args),
}));

const tgSendMessageMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/channels/telegram", () => ({
  sendMessage: (...args: unknown[]) => (tgSendMessageMock as any)(...args),
}));

/** Configura el mock de `docker exec` para devolver estas entradas JSONL crudas. */
function stubDockerEntries(entries: unknown[]) {
  execFileMock.mockImplementation((_file, _args, _opts, cb) => {
    cb(null, { stdout: JSON.stringify(entries) });
  });
}

function stubDockerFailure(message: string) {
  execFileMock.mockImplementation((_file, _args, _opts, cb) => {
    cb(new Error(message));
  });
}

function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
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
          headers: payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {},
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
      if (payload) req.write(payload);
      req.end();
    });
  });
}

/**
 * App mínima que espeja el montaje real: gate de /api (401 sin usuario, como
 * el gate central de index.ts) + router + mapeo de HttpError a status.
 */
async function buildApp(opts: { authenticated: boolean }): Promise<express.Express> {
  const { operatorChatRouter } = await import("@/routes/operator-chat");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, res, next) => {
    if (opts.authenticated) {
      (req as any).user = { id: "u-1", email: "admin@test.com", role: "admin" };
    }
    if (!(req as any).user) return res.status(401).json({ error: "No autenticado" });
    next();
  });
  app.use("/api/operator-chat", operatorChatRouter);
  // Mapea HttpError a status (equivalente al errorHandler central de index.ts)
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

function stubFetchOk(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Transcripción mixta con las formas defensivas documentadas en
 * routes/operator-chat.ts: turnos user/assistant, espejo de entrega
 * (delivery-mirror), entrada de herramienta, assistant sin texto visible y
 * entrada envuelta en formato JSONL de sesión — tal como las devuelve el
 * script `docker exec` de historyFromDocker (siempre envueltas en
 * `{ type: "message", message: {...} }`, ver readJsonlEntries).
 */
const T1 = "2026-07-06T08:20:00.000Z";
const T6 = "2026-07-06T08:22:00.000Z";

const MIXED_ENTRIES = [
  // Epoch en MILISEGUNDOS → debe normalizarse a ISO.
  { type: "message", message: { id: "m1", role: "user", content: "hola", timestamp: new Date(T1).getTime() } },
  {
    type: "message",
    message: {
      id: "m2",
      role: "assistant",
      content: [
        { type: "text", text: "buenas, ¿en qué ayudo?" },
        { type: "tool_use", name: "calendar" },
      ],
      timestamp: "2026-07-06T10:00:05.000Z",
    },
  },
  // Espejo de entrega hacia Telegram (forma heurística): duplicado del turno → filtrado.
  {
    type: "message",
    message: { id: "m3", role: "assistant", content: "buenas, ¿en qué ayudo?", type: "delivery", deliveredTo: "telegram:123" },
  },
  // Espejo de entrega con la forma REAL confirmada en vivo
  // (openclawDeliveryMirror + model:"delivery-mirror") → filtrado.
  {
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "De nada, Adri." }],
      provider: "openclaw",
      model: "delivery-mirror",
      timestamp: 1783285544120,
      openclawDeliveryMirror: { kind: "channel-final", sourceMessageId: "telegram-final:agent:main:main:1293809129:389:0" },
      idempotencyKey: "telegram-final:agent:main:main:1293809129:389:0",
    },
  },
  // Entrada de herramienta: role no pintable → filtrada.
  { type: "message", message: { id: "m4", role: "toolResult", content: "raw tool output" } },
  // Assistant solo con tool_use, sin texto visible → filtrado.
  { type: "message", message: { id: "m5", role: "assistant", content: [{ type: "tool_use", name: "browser" }] } },
  // Epoch en SEGUNDOS → se normaliza a ISO.
  { type: "message", message: { id: "m6", role: "user", content: "segundo mensaje", timestamp: new Date(T6).getTime() / 1000 } },
];

beforeEach(() => {
  process.env.OPENCLAW_ADMIN_URL = "http://localhost:18791";
  process.env.OPENCLAW_GATEWAY_TOKEN = "secret-gw-token";
  delete process.env.OPENCLAW_OPERATOR_SESSION_KEY;
  delete process.env.OPENCLAW_OPERATOR_TRANSCRIPT_FILE;
  delete process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN;
  delete process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID;
  // Sondeo del espejo mínimo en test: 1 intento, sin espera (evita timers colgados).
  process.env.OPENCLAW_OPERATOR_MIRROR_ATTEMPTS = "1";
  process.env.OPENCLAW_OPERATOR_MIRROR_DELAY_MS = "0";
  execFileMock.mockReset();
  tgSendMessageMock.mockReset().mockResolvedValue(undefined);
  stubDockerEntries([]);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("gate de auth — /api/operator-chat", () => {
  it("las rutas NO están en la allowlist pública (el gate central las protege)", () => {
    expect(isPublic("GET", "/api/operator-chat/history")).toBe(false);
    expect(isPublic("POST", "/api/operator-chat/send")).toBe(false);
  });

  it("401 en GET /history sin sesión, sin tocar el gateway", async () => {
    stubDockerEntries(MIXED_ENTRIES);
    const app = await buildApp({ authenticated: false });
    const res = await request(app, "GET", "/api/operator-chat/history");
    expect(res.status).toBe(401);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("401 en POST /send sin sesión, sin tocar el gateway", async () => {
    const fetchMock = stubFetchOk({});
    const app = await buildApp({ authenticated: false });
    const res = await request(app, "POST", "/api/operator-chat/send", {
      text: "hola",
      clientMessageId: "c1",
    });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/operator-chat/history", () => {
  it("happy path: normaliza la transcripción mixta al DTO estable y filtra espejos/herramientas", async () => {
    stubDockerEntries(MIXED_ENTRIES);
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "GET", "/api/operator-chat/history");

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([
      { id: "m1", role: "user", text: "hola", createdAt: T1 },
      {
        id: "m2",
        role: "assistant",
        text: "buenas, ¿en qué ayudo?",
        createdAt: "2026-07-06T10:00:05.000Z",
      },
      { id: "m6", role: "user", text: "segundo mensaje", createdAt: T6 },
    ]);

    // docker exec correcto: sessionKey por defecto y limit=50 pasados como argv.
    const call = execFileMock.mock.calls[0];
    expect(call[0]).toBe("docker");
    expect(call[1]).toEqual(["exec", "OpenClaw_Agents_3A", "node", "-e", expect.any(String), "agent:main:main", "50"]);
  });

  it("respeta ?limit= y OPENCLAW_OPERATOR_SESSION_KEY", async () => {
    process.env.OPENCLAW_OPERATOR_SESSION_KEY = "agent:operator:main";
    stubDockerEntries([]);
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "GET", "/api/operator-chat/history?limit=10");

    expect(res.status).toBe(200);
    const call = execFileMock.mock.calls[0];
    expect(call[1]).toEqual(["exec", "OpenClaw_Agents_3A", "node", "-e", expect.any(String), "agent:operator:main", "10"]);
  });

  it("sin entradas tipo 'message' → messages: [] (defensivo, no rompe)", async () => {
    stubDockerEntries([]);
    const app = await buildApp({ authenticated: true });
    const res = await request(app, "GET", "/api/operator-chat/history");
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });

  it("503 con gateway sin configurar, sin invocar docker", async () => {
    delete process.env.OPENCLAW_ADMIN_URL;
    delete process.env.OPENCLAW_BASE_URL;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "GET", "/api/operator-chat/history");

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("OPENCLAW_UNCONFIGURED");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("502 si la lectura del historial falla", async () => {
    stubDockerFailure("docker exec boom");
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "GET", "/api/operator-chat/history");

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("OPENCLAW_RPC_FAILED");
  });
});

describe("POST /api/operator-chat/send", () => {
  it("happy path: 202 accepted y POST a /chat/completions con headers de sesión", async () => {
    const fetchMock = stubFetchOk({});
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "POST", "/api/operator-chat/send", {
      text: "revisa la agenda de mañana",
      clientMessageId: "web-uuid-1",
    });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, clientMessageId: "web-uuid-1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:18791/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer secret-gw-token");
    expect(init.headers["x-openclaw-session-key"]).toBe("agent:main:main");
    expect(init.headers["x-openclaw-agent-id"]).toBe("main");
    expect(init.headers["Idempotency-Key"]).toBe("web-uuid-1");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: "openclaw",
      messages: [{ role: "user", content: "revisa la agenda de mañana" }],
      stream: false,
      user: "agent:main:main",
    });
  });

  it("400 con text vacío, sin tocar el gateway", async () => {
    const fetchMock = stubFetchOk({});
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "POST", "/api/operator-chat/send", {
      text: "   ",
      clientMessageId: "web-uuid-2",
    });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 sin clientMessageId, sin tocar el gateway", async () => {
    const fetchMock = stubFetchOk({});
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "POST", "/api/operator-chat/send", { text: "hola" });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("503 con gateway sin configurar", async () => {
    delete process.env.OPENCLAW_ADMIN_URL;
    delete process.env.OPENCLAW_BASE_URL;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "POST", "/api/operator-chat/send", {
      text: "hola",
      clientMessageId: "c9",
    });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("OPENCLAW_UNCONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("502 si el gateway rechaza el envío", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal("fetch", fetchMock);
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "POST", "/api/operator-chat/send", {
      text: "hola",
      clientMessageId: "c10",
    });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("OPENCLAW_RPC_FAILED");
  });
});

describe("espejo a Telegram tras POST /send (aa-espejo-movil-operador-telegram)", () => {
  it("sin OPENCLAW_OPERATOR_TELEGRAM_* configuradas: no llama a Telegram (noop)", async () => {
    stubFetchOk({});
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "POST", "/api/operator-chat/send", {
      text: "revisa la agenda de mañana",
      clientMessageId: "web-uuid-tg-1",
    });

    expect(res.status).toBe(202);
    expect(tgSendMessageMock).not.toHaveBeenCalled();
  });

  it("con envs configuradas: espeja el turno del operador al bot de Telegram", async () => {
    process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN = "bot-token-123";
    process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID = "1293809129";
    stubFetchOk({});
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "POST", "/api/operator-chat/send", {
      text: "revisa la agenda de mañana",
      clientMessageId: "web-uuid-tg-2",
    });

    expect(res.status).toBe(202);
    // El turno del operador se espeja con distintivo discreto, SIN la palabra "Operador".
    expect(tgSendMessageMock).toHaveBeenCalledWith(
      "bot-token-123",
      1293809129,
      expect.stringContaining("revisa la agenda de mañana"),
    );
    const mirrored = tgSendMessageMock.mock.calls[0][2] as string;
    expect(mirrored).not.toMatch(/operador/i);
  });

  it("si Telegram falla, el envío al operador sigue respondiendo 202 (fail-soft)", async () => {
    process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN = "bot-token-123";
    process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID = "1293809129";
    tgSendMessageMock.mockRejectedValueOnce(new Error("telegram caído"));
    stubFetchOk({});
    const app = await buildApp({ authenticated: true });

    const res = await request(app, "POST", "/api/operator-chat/send", {
      text: "hola",
      clientMessageId: "web-uuid-tg-3",
    });

    expect(res.status).toBe(202);
  });
});

describe("espejo de la respuesta del asistente (mirrorAssistantReply)", () => {
  async function importMirror() {
    const mod = await import("@/routes/operator-chat");
    return mod.mirrorAssistantReply;
  }

  it("espeja el turno assistant NUEVO en limpio (sin distintivo del operador)", async () => {
    process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN = "bot-token-123";
    process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID = "1293809129";
    stubDockerEntries([
      { type: "message", message: { id: "a-new", role: "assistant", content: "aquí está tu agenda" } },
    ]);
    const mirrorAssistantReply = await importMirror();

    await mirrorAssistantReply("agent:main:main", new Set(), { attempts: 1, delayMs: 0 });

    expect(tgSendMessageMock).toHaveBeenCalledWith("bot-token-123", 1293809129, "aquí está tu agenda");
    expect(tgSendMessageMock.mock.calls[0][2]).not.toMatch(/operador/i);
  });

  it("no reenvía un turno assistant ya conocido (dedup por id)", async () => {
    process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN = "bot-token-123";
    process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID = "1293809129";
    stubDockerEntries([
      { type: "message", message: { id: "a-old", role: "assistant", content: "respuesta previa" } },
    ]);
    const mirrorAssistantReply = await importMirror();

    await mirrorAssistantReply("agent:main:main", new Set(["a-old"]), { attempts: 1, delayMs: 0 });

    expect(tgSendMessageMock).not.toHaveBeenCalled();
  });

  it("nunca espeja entradas delivery-mirror ya entregadas nativamente por Telegram", async () => {
    process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN = "bot-token-123";
    process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID = "1293809129";
    // MIXED_ENTRIES incluye espejos de entrega (delivery-mirror) y un assistant real (m2).
    // Con m2 ya conocido, no queda ningún turno nuevo pintable → no se envía nada.
    stubDockerEntries(MIXED_ENTRIES);
    const mirrorAssistantReply = await importMirror();

    await mirrorAssistantReply("agent:main:main", new Set(["m2"]), { attempts: 1, delayMs: 0 });

    expect(tgSendMessageMock).not.toHaveBeenCalled();
  });

  it("fail-soft: si Telegram rechaza, no lanza", async () => {
    process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN = "bot-token-123";
    process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID = "1293809129";
    stubDockerEntries([
      { type: "message", message: { id: "a-x", role: "assistant", content: "hola" } },
    ]);
    tgSendMessageMock.mockRejectedValueOnce(new Error("telegram caído"));
    const mirrorAssistantReply = await importMirror();

    await expect(
      mirrorAssistantReply("agent:main:main", new Set(), { attempts: 1, delayMs: 0 })
    ).resolves.toBeUndefined();
  });

  it("noop sin credenciales de Telegram", async () => {
    stubDockerEntries([
      { type: "message", message: { id: "a-y", role: "assistant", content: "hola" } },
    ]);
    const mirrorAssistantReply = await importMirror();

    await mirrorAssistantReply("agent:main:main", new Set(), { attempts: 1, delayMs: 0 });

    expect(tgSendMessageMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
