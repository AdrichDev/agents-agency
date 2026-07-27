/**
 * H2 (aa-credenciales-byok-multiproveedor) — T3.3 / T3.4 / T3.5.
 *
 * El almacén de claves del cliente es de ESCRITURA: entra por HTTP, sale sólo hacia el resolutor
 * LLM. La prueba central (T3.3) no comprueba que falte un campo llamado `apiKey` — comprueba que
 * el secreto NO APARECE EN EL CUERPO de ninguna respuesta de lectura, aserción sobre el JSON
 * entero. Es la única forma que sobrevive a un `include` añadido dentro de seis meses, que
 * arrastraría la columna sin que nadie teclee la palabra `apiKey`.
 *
 * Para que la aserción tenga dientes, el mock de prisma devuelve la fila COMPLETA (con
 * `api_key` dentro) ignorando el `select`. Es el peor caso deliberado: si la capa sólo confiara
 * en el `select` de Prisma, este test la cazaría.
 *
 * El cifrado se mockea como `enc:v1:<claro>` a propósito: mete el claro DENTRO del cifrado, así
 * que una sola aserción cubre las dos fugas (clave en claro y blob cifrado).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const CLARO = "sk-proj-CLAVE-SECRETA-DEL-CLIENTE-9999";
const CIFRADO = `enc:v1:${CLARO}`;

const modelsList = vi.fn(async () => ({ data: [{ id: "gpt-4o" }] }));
const chatCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), update: vi.fn() },
    tenantLlmCredential: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/integrations/oauth", () => ({
  encryptToken: vi.fn((plain: string) => `enc:v1:${plain}`),
  decryptToken: vi.fn((blob: string) => {
    if (!blob.startsWith("enc:v1:")) throw new Error("bad ciphertext");
    return blob.slice("enc:v1:".length);
  }),
}));

vi.mock("@/lib/llm/governance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/governance")>();
  return {
    ...actual,
    createGovernedClient: vi.fn(() => ({
      models: { list: modelsList },
      chat: { completions: { create: chatCreate } },
    })),
  };
});

import { prisma } from "@/lib/db";
import { createGovernedClient } from "@/lib/llm/governance";
import {
  listCredentialsPublic,
  upsertCredential,
  reverifyCredential,
  getDecryptedApiKey,
  failureMessage,
} from "@/lib/llm/credentials";
import { clientsRouter } from "@/routes/clients";
import { HttpError } from "@/lib/http";

const cred = prisma.tenantLlmCredential as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mockTenantFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mockTenantUpdate = prisma.tenant.update as ReturnType<typeof vi.fn>;
const mockCreateClient = createGovernedClient as unknown as ReturnType<typeof vi.fn>;

/** Fila tal y como la devolvería la BD si el `select` no filtrara: con la clave dentro. */
function filaEnvenenada(over: Record<string, unknown> = {}) {
  return {
    tenantId: "t1",
    provider: "openai",
    apiKey: CIFRADO,
    keyHint: "9999",
    status: "connected",
    lastVerifiedAt: new Date("2026-07-27T10:00:00.000Z"),
    lastError: null,
    updatedAt: new Date("2026-07-27T10:00:00.000Z"),
    ...over,
  };
}

/* ---------- Servidor real, un puerto efímero por petición ---------- */

function request(
  method: string,
  path: string,
  payload?: unknown
): Promise<{ status: number; body: any; raw: string }> {
  const app = express();
  app.use(express.json());
  app.use("/api/clients", clientsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message });
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const body = payload === undefined ? null : JSON.stringify(payload);
      const headers: Record<string, string> = {};
      if (body) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(body));
      }
      const req = http.request({ port, method, path, headers }, (res) => {
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
          resolve({ status: res.statusCode ?? 0, body: parsed, raw: data });
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
  modelsList.mockResolvedValue({ data: [{ id: "gpt-4o" }] });
  mockTenantFind.mockResolvedValue({ id: "t1" });
  mockTenantUpdate.mockResolvedValue({ id: "t1", credentialMode: "byok" });
  cred.findMany.mockResolvedValue([filaEnvenenada()]);
  cred.findUnique.mockResolvedValue(filaEnvenenada());
  cred.upsert.mockResolvedValue(filaEnvenenada());
  cred.update.mockResolvedValue(filaEnvenenada());
  cred.deleteMany.mockResolvedValue({ count: 1 });
  cred.count.mockResolvedValue(1);
});

describe("T3.3 — el secreto no sale por ninguna respuesta de lectura", () => {
  it("GET /:id/llm-credentials: ni la clave en claro ni el blob cifrado en el cuerpo", async () => {
    const res = await request("GET", "/api/clients/t1/llm-credentials");

    expect(res.status).toBe(200);
    // Aserción sobre el JSON COMPLETO, no sobre un campo: es la que sobrevive a un `include`.
    expect(res.raw).not.toContain(CLARO);
    expect(res.raw).not.toContain("enc:v1:");
    // Y sí devuelve lo que el humano necesita para reconocerla.
    expect(res.body[0]).toMatchObject({ provider: "openai", keyHint: "9999", status: "connected" });
  });

  it("PUT: la respuesta del guardado tampoco devuelve lo que acaba de recibir", async () => {
    const res = await request("PUT", "/api/clients/t1/llm-credentials/openai", { apiKey: CLARO });

    expect(res.status).toBe(200);
    expect(res.raw).not.toContain(CLARO);
    expect(res.raw).not.toContain("enc:v1:");
  });

  it("POST .../verify: la reverificación tampoco la filtra", async () => {
    const res = await request("POST", "/api/clients/t1/llm-credentials/openai/verify");

    expect(res.status).toBe(200);
    expect(res.raw).not.toContain(CLARO);
    expect(res.raw).not.toContain("enc:v1:");
  });

  it("listCredentialsPublic consulta con select explícito y sin apiKey", async () => {
    await listCredentialsPublic("t1");

    const arg = cred.findMany.mock.calls[0][0];
    expect(arg.select).toBeDefined();
    expect(arg.select).not.toHaveProperty("apiKey");
    // Sin `include`: es el vector concreto que arrastraría la columna.
    expect(arg).not.toHaveProperty("include");
  });

  it("el mensaje de error de un guardado fallido no repite la clave", async () => {
    // Los proveedores a veces devuelven la clave dentro del mensaje de error. Si se guardara en
    // `lastError` tal cual, el secreto saldría por la vía de lectura... con nombre de "error".
    modelsList.mockRejectedValue(new Error(`Incorrect API key provided: ${CLARO}`));
    cred.upsert.mockImplementation(async (arg: any) =>
      filaEnvenenada({ status: "invalid", lastError: arg.update.lastError })
    );

    const res = await request("PUT", "/api/clients/t1/llm-credentials/openai", { apiKey: CLARO });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("invalid");
    expect(res.raw).not.toContain(CLARO);
    // Queda el motivo útil y el hint, que es lo que el humano necesita para saber qué pasó.
    expect(res.body.lastError).toMatch(/Incorrect API key/);
    expect(res.body.lastError).toContain("9999");
  });

  it("también redacta una clave que el proveedor devuelva en otra forma que la enviada", async () => {
    // Segunda red: el error puede citar la clave truncada, o la de otra cuenta. La sustitución
    // literal no la cubriría.
    modelsList.mockRejectedValue(new Error("Invalid key sk-ant-api03-OTRACLAVEQUENOENVIAMOS"));
    cred.upsert.mockImplementation(async (arg: any) =>
      filaEnvenenada({ status: "invalid", lastError: arg.update.lastError })
    );

    const res = await request("PUT", "/api/clients/t1/llm-credentials/anthropic", { apiKey: CLARO });

    expect(res.raw).not.toContain("OTRACLAVEQUENOENVIAMOS");
    expect(res.body.lastError).toContain("***");
  });
});

describe("T3.4 — verificar la clave no gasta tokens del cliente", () => {
  it("usa models.list(), nunca una completion", async () => {
    await upsertCredential("t1", "openai", CLARO);

    expect(modelsList).toHaveBeenCalledTimes(1);
    // Una completion mínima gastaría dinero del cliente para responder a una pregunta de
    // autenticación (y `max_tokens: 1` revienta en modelos razonadores).
    expect(chatCreate).not.toHaveBeenCalled();
  });

  it("verifica contra el proveedor pedido, con la clave que se está guardando", async () => {
    await upsertCredential("t1", "anthropic", CLARO);

    expect(mockCreateClient).toHaveBeenCalledWith({ provider: "anthropic", apiKey: CLARO });
  });

  it("clave válida: se guarda cifrada, con hint de 4 y status connected", async () => {
    await upsertCredential("t1", "openai", CLARO);

    const arg = cred.upsert.mock.calls[0][0];
    expect(arg.update.apiKey).toBe(CIFRADO);
    expect(arg.update.apiKey).not.toBe(CLARO); // nunca en claro en la BD
    expect(arg.update.keyHint).toBe("9999");
    expect(arg.update.status).toBe("connected");
    expect(arg.update.lastVerifiedAt).toBeInstanceOf(Date);
    expect(arg.update.lastError).toBeNull();
  });
});

describe("T3.5 — una clave inválida se guarda marcada, no se rechaza", () => {
  it("status invalid + motivo, y lastVerifiedAt en null", async () => {
    modelsList.mockRejectedValue(new Error("401 Incorrect API key provided"));

    await upsertCredential("t1", "openai", "sk-mala-pero-suficientemente-larga");

    const arg = cred.upsert.mock.calls[0][0];
    expect(arg.update.status).toBe("invalid");
    expect(arg.update.lastError).toMatch(/401/);
    // Nunca verificada: null, no "ahora". Si se pusiera la fecha, el panel diría "verificada"
    // sobre una clave que no autentica.
    expect(arg.update.lastVerifiedAt).toBeNull();
  });

  it("se guarda igual: perder lo que el humano acaba de teclear por un fallo de red es peor", async () => {
    modelsList.mockRejectedValue(new Error("ECONNRESET"));

    const res = await request("PUT", "/api/clients/t1/llm-credentials/openai", { apiKey: CLARO });

    expect(res.status).toBe(200);
    expect(cred.upsert).toHaveBeenCalled();
  });

  it("una clave demasiado corta se rechaza en el borde, sin llegar al proveedor", async () => {
    const res = await request("PUT", "/api/clients/t1/llm-credentials/openai", { apiKey: "sk-x" });

    expect(res.status).toBe(400);
    expect(modelsList).not.toHaveBeenCalled();
    expect(cred.upsert).not.toHaveBeenCalled();
  });

  it("un proveedor que no existe se rechaza en el borde", async () => {
    const res = await request("PUT", "/api/clients/t1/llm-credentials/deepseek", { apiKey: CLARO });

    expect(res.status).toBe(400);
    expect(cred.upsert).not.toHaveBeenCalled();
  });

  it("clave guardada ilegible: se marca undecryptable sin llamar al proveedor", async () => {
    // Síntoma real de haber cambiado CHANNEL_ENCRYPTION_KEY con datos ya cifrados. No es una
    // clave mala: es una clave que ya no se puede leer, y el panel debe decir eso.
    cred.findUnique.mockResolvedValue({ apiKey: "texto-que-no-es-enc-v1" });

    await reverifyCredential("t1", "openai");

    expect(modelsList).not.toHaveBeenCalled();
    const arg = cred.update.mock.calls[0][0];
    expect(arg.data.status).toBe("undecryptable");
    expect(arg.data.lastError).toMatch(/CHANNEL_ENCRYPTION_KEY/);
  });

  it("reverificar un proveedor sin credencial da 404, no un 200 vacío", async () => {
    cred.findUnique.mockResolvedValue(null);

    const res = await request("POST", "/api/clients/t1/llm-credentials/gemini/verify");

    expect(res.status).toBe(404);
  });
});

describe("getDecryptedApiKey — la única puerta de salida del claro", () => {
  it("connected: devuelve el claro y el updatedAt que alimenta la caché", async () => {
    const resolved = await getDecryptedApiKey("t1", "openai");

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.credential.apiKey).toBe(CLARO);
      expect(resolved.credential.updatedAt).toEqual(new Date("2026-07-27T10:00:00.000Z"));
    }
  });

  it("sin credencial: 'missing', no una excepción anónima", async () => {
    cred.findUnique.mockResolvedValue(null);

    const resolved = await getDecryptedApiKey("t1", "anthropic");

    expect(resolved).toEqual({ ok: false, failure: { kind: "missing" } });
  });

  it("status invalid: NO se sirve con ella, aunque esté guardada y sea descifrable", async () => {
    cred.findUnique.mockResolvedValue(filaEnvenenada({ status: "invalid" }));

    const resolved = await getDecryptedApiKey("t1", "openai");

    expect(resolved).toEqual({ ok: false, failure: { kind: "not_connected", status: "invalid" } });
  });

  it("blob ilegible: 'undecryptable', distinguible de 'no hay clave'", async () => {
    cred.findUnique.mockResolvedValue(filaEnvenenada({ apiKey: "basura" }));

    const resolved = await getDecryptedApiKey("t1", "openai");

    expect(resolved).toEqual({ ok: false, failure: { kind: "undecryptable" } });
  });

  it("los tres motivos dan mensajes distintos y nombran al proveedor", async () => {
    const mensajes = [
      failureMessage("openai", { kind: "missing" }),
      failureMessage("openai", { kind: "not_connected", status: "invalid" }),
      failureMessage("openai", { kind: "undecryptable" }),
    ];

    expect(new Set(mensajes).size).toBe(3);
    for (const m of mensajes) expect(m).toMatch(/OpenAI/);
  });
});

describe("PATCH /:id/credential-mode — avisa, no bloquea", () => {
  it("pasar a byok sin ninguna clave conectada devuelve warning, no error", async () => {
    // El orden natural de la pantalla es elegir modo → pegar clave. Bloquear el primer paso
    // obligaría a pegar la clave antes de poder elegir el modo al que sirve.
    cred.count.mockResolvedValue(0);

    const res = await request("PATCH", "/api/clients/t1/credential-mode", {
      credentialMode: "byok",
    });

    expect(res.status).toBe(200);
    expect(res.body.warning).toBeTruthy();
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { credentialMode: "byok" } })
    );
  });

  it("con clave conectada no avisa de nada", async () => {
    cred.count.mockResolvedValue(1);

    const res = await request("PATCH", "/api/clients/t1/credential-mode", {
      credentialMode: "byok",
    });

    expect(res.status).toBe(200);
    expect(res.body.warning).toBeFalsy();
  });

  it("un modo inventado se rechaza: sólo existen platform y byok", async () => {
    const res = await request("PATCH", "/api/clients/t1/credential-mode", {
      credentialMode: "gratis",
    });

    expect(res.status).toBe(400);
    expect(mockTenantUpdate).not.toHaveBeenCalled();
  });

  it("tenant inexistente: 404 antes de tocar nada", async () => {
    mockTenantFind.mockResolvedValue(null);

    const res = await request("PATCH", "/api/clients/nope/credential-mode", {
      credentialMode: "byok",
    });

    expect(res.status).toBe(404);
    expect(mockTenantUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE — retirar la clave", () => {
  it("borra y responde 204/200 sin devolver nada del secreto", async () => {
    const res = await request("DELETE", "/api/clients/t1/llm-credentials/openai");

    expect([200, 204]).toContain(res.status);
    expect(res.raw).not.toContain(CLARO);
    expect(cred.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t1", provider: "openai" } });
  });

  it("borrar lo que no existe da 404", async () => {
    cred.deleteMany.mockResolvedValue({ count: 0 });

    const res = await request("DELETE", "/api/clients/t1/llm-credentials/openai");

    expect(res.status).toBe(404);
  });
});
