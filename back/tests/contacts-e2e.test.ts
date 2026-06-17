import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * E2E del router /api/contacts: monta el router real sobre express y ejerce
 * el wiring completo (orden de rutas, parsing JSON, códigos de estado a través
 * del stack, 404 por ruta inexistente). Complementa contacts.test.ts (que prueba
 * handlers en aislamiento). Prisma y códigos secuenciales van mockeados — sin BD.
 */

const prismaMock = vi.hoisted(() => ({
  prospectContact: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  client: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/codes", () => ({
  nextContactCode: vi.fn(async () => "pc-07"),
  nextClientCode: vi.fn(async () => "cli-07"),
  withCodeRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

import { contactsRouter } from "@/routes/contacts";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/contacts", contactsRouter);
  return app;
}

// Mini cliente HTTP sobre el server de express (sin supertest, no es dependencia).
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

describe("contacts E2E (router montado)", () => {
  const app = buildApp();

  beforeEach(() => vi.clearAllMocks());

  it("GET /api/contacts/pending-count resuelve por su ruta propia (no la captura /:id)", async () => {
    prismaMock.prospectContact.count.mockResolvedValue(3);
    const res = await request(app, "GET", "/api/contacts/pending-count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3 });
    expect(prismaMock.prospectContact.count).toHaveBeenCalledWith({
      where: { contactado: { not: "si" }, deletedAt: null },
    });
  });

  it("POST /api/contacts crea y devuelve 201 con el objeto", async () => {
    prismaMock.prospectContact.create.mockImplementation(async ({ data }: any) => ({ id: "c1", ...data }));
    const res = await request(app, "POST", "/api/contacts", { name: "Ana", type: "lead" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "c1", name: "Ana", type: "lead", codigo: "pc-07", contactado: "no" });
  });

  it("POST /api/contacts con body inválido devuelve 400 y no toca la BD", async () => {
    const res = await request(app, "POST", "/api/contacts", { email: "no-es-email" });
    expect(res.status).toBe(400);
    expect(prismaMock.prospectContact.create).not.toHaveBeenCalled();
  });

  it("PATCH /api/contacts/:id existente devuelve 200", async () => {
    prismaMock.prospectContact.findUnique.mockResolvedValue({ contactado: "no", contactedAt: null, deletedAt: null });
    prismaMock.prospectContact.update.mockImplementation(async ({ data }: any) => ({ id: "c1", ...data }));
    const res = await request(app, "PATCH", "/api/contacts/c1", { contactado: "si" });
    expect(res.status).toBe(200);
    expect(res.body.contactado).toBe("si");
  });

  it("PATCH /api/contacts/:id inexistente devuelve 404 por el stack", async () => {
    prismaMock.prospectContact.findUnique.mockResolvedValue(null);
    const res = await request(app, "PATCH", "/api/contacts/nope", { name: "X" });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/contacts/:id hace soft delete y devuelve { ok: true }", async () => {
    prismaMock.prospectContact.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app, "DELETE", "/api/contacts/c1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /api/contacts lista filtrando por query string", async () => {
    prismaMock.prospectContact.findMany.mockResolvedValue([]);
    const res = await request(app, "GET", "/api/contacts?type=lead&contactado=nc");
    expect(res.status).toBe(200);
    expect(prismaMock.prospectContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, type: "lead", contactado: "nc" } })
    );
  });

  it("POST /api/contacts/convert-to-clients crea cliente y vincula el contacto", async () => {
    prismaMock.prospectContact.findMany.mockResolvedValue([
      { id: "c1", name: "Ana", email: "ana@x.com", phone: null, sector: null, direccion: null, clientId: null },
    ]);
    prismaMock.client.create.mockImplementation(async ({ data }: any) => ({ id: "cl1", ...data }));
    prismaMock.prospectContact.update.mockResolvedValue({});
    const res = await request(app, "POST", "/api/contacts/convert-to-clients", { ids: ["c1"] });
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);
    expect(prismaMock.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ codCliente: "cli-07", name: "Ana" }) })
    );
  });
});
