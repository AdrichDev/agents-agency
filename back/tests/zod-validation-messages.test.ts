/**
 * Migración zod 3 → 4 (ac/deps-security): los textos que ve el usuario al enviar un
 * formulario inválido NO pueden cambiar.
 *
 * zod 4 reescribe TODOS sus mensajes por defecto ("Required" → "Invalid input: expected
 * string, received undefined", "Expected string, received number" → "Invalid input:
 * expected string, received number", "Number must be less than or equal to 1" → "Too big:
 * expected number to be <=1"...). Lo único que mantiene el texto byte-idéntico es el
 * mensaje EXPLÍCITO del schema: `.min(2, "Indica tu nombre")`, `.email("Email no válido")`
 * o `z.literal(true, { error: "..." })`.
 *
 * Este test fija esa garantía donde el texto llega de verdad al usuario final:
 *  - el formulario público de la landing (POST /api/public/leads responde `error` con el
 *    mensaje del primer issue, así que es texto literal en pantalla),
 *  - los schemas de la agenda de contactos,
 *  - el schema del avatar en base64 (`lib/schemas.ts`).
 *
 * Si alguien quita un mensaje explícito, el texto pasa a ser el inglés por defecto de zod
 * y este test lo delata. Los asserts son los strings EXACTOS: no ajustarlos para que pase.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    landingLead: { create: vi.fn(), findMany: vi.fn() },
    prospectContact: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn(async () => {}) }));
vi.mock("@/lib/limiters", () => ({ leadsLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { prisma } from "@/lib/db";
import { publicRouter } from "@/routes/public";
import { createContactSchema } from "@/routes/contacts";
import { base64ImageSchema } from "@/lib/schemas";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** App mínima con el router público; el errorHandler replica el `error` de las respuestas. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/public", publicRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status ?? 500).json({ error: err?.message });
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

/** Payload válido del formulario; cada caso invalida UN campo para aislar su mensaje. */
const LEAD_VALIDO = {
  name: "Ana Pérez",
  email: "ana@example.com",
  phone: "612345678",
  message: "Hola",
  consent: true,
};

describe("POST /api/public/leads — mensajes de validación visibles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asMock(prisma.landingLead.create).mockResolvedValue({ id: "lead-1", ...LEAD_VALIDO });
  });

  it("nombre demasiado corto → «Indica tu nombre»", async () => {
    const res = await request(buildApp(), "POST", "/api/public/leads", { ...LEAD_VALIDO, name: "A" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Indica tu nombre" });
  });

  it("email inválido → «Email no válido»", async () => {
    const res = await request(buildApp(), "POST", "/api/public/leads", { ...LEAD_VALIDO, email: "nope" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Email no válido" });
  });

  it("teléfono demasiado corto → «Teléfono no válido»", async () => {
    const res = await request(buildApp(), "POST", "/api/public/leads", { ...LEAD_VALIDO, phone: "123" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Teléfono no válido" });
  });

  it("consentimiento rechazado → «Debes aceptar la política de privacidad»", async () => {
    const res = await request(buildApp(), "POST", "/api/public/leads", { ...LEAD_VALIDO, consent: false });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Debes aceptar la política de privacidad" });
  });

  it("payload válido → 201 y no devuelve mensaje de validación", async () => {
    const res = await request(buildApp(), "POST", "/api/public/leads", LEAD_VALIDO);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, id: "lead-1" });
  });
});

describe("createContactSchema — mensajes de validación visibles", () => {
  it("nombre vacío → «El nombre es obligatorio»", () => {
    const parsed = createContactSchema.safeParse({ name: "" });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.flatten().fieldErrors.name).toEqual(["El nombre es obligatorio"]);
  });

  it("email inválido → «Email no válido»", () => {
    const parsed = createContactSchema.safeParse({ name: "Ana", email: "nope" });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.flatten().fieldErrors.email).toEqual(["Email no válido"]);
  });

  it("contacto válido → no hay errores", () => {
    const parsed = createContactSchema.safeParse({ name: "Ana", email: "ana@example.com" });
    expect(parsed.success).toBe(true);
  });
});

describe("base64ImageSchema — mensajes de validación visibles", () => {
  it("imagen demasiado grande → mensaje de tamaño", () => {
    const huge = "data:image/png;base64," + "A".repeat(1_500_001);
    const parsed = base64ImageSchema.safeParse(huge);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0].message).toBe("Imagen demasiado grande (máx ~1.5MB)");
  });

  it("cadena que no es data URL de imagen → mensaje de formato", () => {
    const parsed = base64ImageSchema.safeParse("javascript:alert(1)");
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0].message).toBe(
      "Debe ser un data URL de imagen (data:image/...;base64,...) o vacío para limpiar"
    );
  });

  it("data URL válido y la cadena vacía se aceptan", () => {
    expect(base64ImageSchema.safeParse("data:image/png;base64,AAAA").success).toBe(true);
    expect(base64ImageSchema.safeParse("").success).toBe(true);
  });
});
