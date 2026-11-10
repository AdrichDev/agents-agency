/**
 * S4 corregido (model-catalog, T6) — no hay slot BYOK de DeepSeek.
 *
 * Corrección del propietario: DeepSeek no es un proveedor directo, va "de la mano de nanBuilders".
 * `TenantLlmCredential.provider` es un `String` en la BD (sin migración), así que el único sitio
 * que decide si una clave BYOK entra es la validación del borde (`providerParamSchema` en
 * `routes/clients.ts`). Si ese enum ofreciera `deepseek`, el panel pintaría una fila que guarda
 * una clave contra `api.deepseek.com` y el resto del back —que ya no conoce ese proveedor— nunca
 * la leería: una clave guardada, verificada y jamás usada. Es exactamente el fallo que se vio en
 * producción.
 *
 * Se comprueba por las TRES rutas que comparten el enum (guardar, reverificar y borrar): arreglar
 * una y dejar las otras dos devolviendo 400 sería un panel con un botón que a veces funciona.
 *
 * Mismo arnés que `llm-credentials.test.ts`: servidor express real en un puerto efímero y el SDK
 * mockeado, porque lo que hay que observar es qué proveedor y qué clave acaban llegando al
 * verificador — no el código de `credentials.ts`, que ya tiene sus propias pruebas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const CLAVE = "sk-clave-del-cliente-1234";

const modelsList = vi.fn(async () => ({ data: [{ id: "gpt-5.4-mini" }] }));

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
  decryptToken: vi.fn((blob: string) => blob.slice("enc:v1:".length)),
}));

vi.mock("@/lib/llm/governance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/governance")>();
  return {
    ...actual,
    createGovernedClient: vi.fn(() => ({
      models: { list: modelsList },
      chat: { completions: { create: vi.fn() } },
    })),
  };
});

import { prisma } from "@/lib/db";
import { createGovernedClient, LLM_PROVIDER_IDS } from "@/lib/llm/governance";
import { clientsRouter } from "@/routes/clients";
import { HttpError } from "@/lib/http";

const cred = prisma.tenantLlmCredential as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mockTenantFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mockCreateClient = createGovernedClient as unknown as ReturnType<typeof vi.fn>;

/** Fila como la devolvería la BD para una credencial ya guardada. */
function fila(provider: string, over: Record<string, unknown> = {}) {
  return {
    tenantId: "t1",
    provider,
    apiKey: `enc:v1:${CLAVE}`,
    keyHint: "1234",
    status: "connected",
    lastVerifiedAt: new Date("2026-08-30T10:00:00.000Z"),
    lastError: null,
    updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    ...over,
  };
}

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
  modelsList.mockResolvedValue({ data: [{ id: "gpt-5.4-mini" }] });
  mockTenantFind.mockResolvedValue({ id: "t1" });
  cred.findMany.mockResolvedValue([fila("openai")]);
  cred.findUnique.mockResolvedValue(fila("openai"));
  cred.upsert.mockResolvedValue(fila("openai"));
  cred.update.mockResolvedValue(fila("openai"));
  cred.deleteMany.mockResolvedValue({ count: 1 });
  cred.count.mockResolvedValue(1);
});

describe("S4 — DeepSeek NO tiene slot BYOK", () => {
  it("PUT de una clave de DeepSeek se rechaza en el borde, sin BD ni proveedor", async () => {
    const res = await request("PUT", "/api/clients/t1/llm-credentials/deepseek", { apiKey: CLAVE });

    expect(res.status).toBe(400);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(cred.upsert).not.toHaveBeenCalled();
  });

  it("verify y delete de DeepSeek también se rechazan", async () => {
    const verify = await request("POST", "/api/clients/t1/llm-credentials/deepseek/verify");
    const remove = await request("DELETE", "/api/clients/t1/llm-credentials/deepseek");

    expect(verify.status).toBe(400);
    expect(remove.status).toBe(400);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(cred.deleteMany).not.toHaveBeenCalled();
  });

  it("el rechazo no fue un accidente de formato: el proveedor no está en el enum", async () => {
    // Datos válidos (clave larga, tenant existente): lo único que falla es el proveedor.
    const res = await request("PUT", "/api/clients/t1/llm-credentials/deepseek", {
      apiKey: "sk-deepseek-clave-larguisima-1234",
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("Datos inválidos");
  });
});

describe("S4 — PRESERVE: los cuatro proveedores reales siguen aceptándose", () => {
  for (const provider of LLM_PROVIDER_IDS) {
    it(`PUT guarda la clave de ${provider} verificándola con SU proveedor`, async () => {
      cred.upsert.mockResolvedValue(fila(provider));

      const res = await request("PUT", `/api/clients/t1/llm-credentials/${provider}`, {
        apiKey: CLAVE,
      });

      expect(res.status).toBe(200);
      // El proveedor viaja hasta el verificador: si se quedara en "openai", la clave de otro
      // proveedor se probaría contra la API de OpenAI y SIEMPRE saldría inválida.
      expect(mockCreateClient).toHaveBeenCalledWith({ provider, apiKey: CLAVE });
      expect(cred.upsert.mock.calls[0][0].where).toEqual({
        tenantId_provider: { tenantId: "t1", provider },
      });
      expect(res.body?.provider).toBe(provider);
    });
  }

  it("un proveedor inventado se rechaza en el borde, sin tocar BD ni proveedor", async () => {
    const res = await request("PUT", "/api/clients/t1/llm-credentials/mistral", { apiKey: CLAVE });

    expect(res.status).toBe(400);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(cred.upsert).not.toHaveBeenCalled();
  });
});

/**
 * Coherencia del panel con el enum, en la línea de `cupo-defecto-front-back-coherencia.test.ts`:
 * front y back son paquetes separados, pero el fichero se puede leer. Un panel que ofrece una fila
 * que el back rechaza con 400 es un botón que no funciona, y no lo cazaría ninguna prueba de
 * ninguno de los dos lados por separado. Es lo que pasó con la fila de DeepSeek.
 */
describe("S4 — el panel BYOK ofrece exactamente los proveedores que el back acepta", () => {
  it("las filas del panel son LLM_PROVIDER_IDS, sin DeepSeek", () => {
    const src = readFileSync(
      new URL("../../front/components/clientes/LlmCredentialsPanel.tsx", import.meta.url),
      "utf8"
    );

    const ids = [...src.matchAll(/\{\s*id:\s*"([a-z][a-z0-9]*)",\s*label:/g)].map((m) => m[1]);

    expect(ids).not.toContain("deepseek");
    expect(ids.slice().sort()).toEqual([...LLM_PROVIDER_IDS].sort());
  });
});
