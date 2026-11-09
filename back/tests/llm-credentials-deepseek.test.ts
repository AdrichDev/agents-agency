/**
 * S4 (model-catalog, T3) — el slot BYOK de DeepSeek, por HTTP.
 *
 * `TenantLlmCredential.provider` es un `String` en la BD (sin migración), así que el único sitio
 * que impedía conectar una clave de DeepSeek era la validación del borde:
 * `providerParamSchema` en `routes/clients.ts`. Esta prueba lo comprueba por las TRES rutas que lo
 * usan (guardar, reverificar y borrar) porque las tres validan el MISMO enum: arreglar una y dejar
 * las otras dos devolviendo 400 sería un panel con un botón que a veces funciona.
 *
 * Y la otra mitad: un proveedor que NO existe sigue devolviendo 400 SIN llegar al proveedor. Abrir
 * el enum a "cualquier cadena" convertiría un error de tecleo en una fila inservible en la BD y una
 * petición a una URL que no existe.
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

const CLAVE = "sk-deepseek-clave-del-cliente-1234";

const modelsList = vi.fn(async () => ({ data: [{ id: "deepseek-flash" }] }));

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

/** Fila como la devolvería la BD para la credencial de DeepSeek ya guardada. */
function filaDeepseek(over: Record<string, unknown> = {}) {
  return {
    tenantId: "t1",
    provider: "deepseek",
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
  modelsList.mockResolvedValue({ data: [{ id: "deepseek-flash" }] });
  mockTenantFind.mockResolvedValue({ id: "t1" });
  cred.findMany.mockResolvedValue([filaDeepseek()]);
  cred.findUnique.mockResolvedValue(filaDeepseek());
  cred.upsert.mockResolvedValue(filaDeepseek());
  cred.update.mockResolvedValue(filaDeepseek());
  cred.deleteMany.mockResolvedValue({ count: 1 });
  cred.count.mockResolvedValue(1);
});

describe("S4 — BYOK de DeepSeek aceptado en el borde", () => {
  it("PUT guarda la clave de DeepSeek verificándola con SU proveedor", async () => {
    const res = await request("PUT", "/api/clients/t1/llm-credentials/deepseek", { apiKey: CLAVE });

    expect(res.status).toBe(200);
    // El proveedor viaja hasta el verificador: si se quedara en "openai", la clave de DeepSeek se
    // probaría contra la API de OpenAI y SIEMPRE saldría inválida.
    expect(mockCreateClient).toHaveBeenCalledWith({ provider: "deepseek", apiKey: CLAVE });
    expect(cred.upsert.mock.calls[0][0].where).toEqual({
      tenantId_provider: { tenantId: "t1", provider: "deepseek" },
    });
    expect(res.body?.provider).toBe("deepseek");
    expect(res.body?.status).toBe("connected");
  });

  it("POST .../verify reverifica la clave guardada contra DeepSeek", async () => {
    const res = await request("POST", "/api/clients/t1/llm-credentials/deepseek/verify");

    expect(res.status).toBe(200);
    expect(mockCreateClient).toHaveBeenCalledWith({ provider: "deepseek", apiKey: CLAVE });
    expect(res.body?.provider).toBe("deepseek");
  });

  it("DELETE retira la credencial de DeepSeek de ese tenant", async () => {
    const res = await request("DELETE", "/api/clients/t1/llm-credentials/deepseek");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(cred.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", provider: "deepseek" },
    });
  });
});

describe("S4 — PRESERVE: el enum sigue cerrado a proveedores que existen", () => {
  it("un proveedor inventado se rechaza en el borde, sin tocar BD ni proveedor", async () => {
    const res = await request("PUT", "/api/clients/t1/llm-credentials/mistral", { apiKey: CLAVE });

    expect(res.status).toBe(400);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(cred.upsert).not.toHaveBeenCalled();
  });

  it("verify y delete de un proveedor inventado también se rechazan", async () => {
    const verify = await request("POST", "/api/clients/t1/llm-credentials/mistral/verify");
    const remove = await request("DELETE", "/api/clients/t1/llm-credentials/mistral");

    expect(verify.status).toBe(400);
    expect(remove.status).toBe(400);
    expect(cred.deleteMany).not.toHaveBeenCalled();
  });
});

/**
 * Coherencia del panel con el enum, en la línea de `cupo-defecto-front-back-coherencia.test.ts`:
 * front y back son paquetes separados, pero el fichero se puede leer. Un panel que ofrece una fila
 * que el back rechaza con 400 es un botón que no funciona, y no lo cazaría ninguna prueba de
 * ninguno de los dos lados por separado.
 */
describe("S4 — el panel BYOK ofrece exactamente los proveedores que el back acepta", () => {
  it("las filas del panel son LLM_PROVIDER_IDS, con DeepSeek incluido", () => {
    const src = readFileSync(
      new URL("../../front/components/clientes/LlmCredentialsPanel.tsx", import.meta.url),
      "utf8"
    );

    const ids = [...src.matchAll(/\{\s*id:\s*"([a-z][a-z0-9]*)",\s*label:/g)].map((m) => m[1]);

    expect(ids).toContain("deepseek");
    expect(ids.slice().sort()).toEqual([...LLM_PROVIDER_IDS].sort());
  });
});
