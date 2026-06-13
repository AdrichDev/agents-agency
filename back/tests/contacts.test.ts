import { describe, expect, it, beforeEach, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  prospectContact: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  createContactSchema,
  updateContactSchema,
  listContactsQuerySchema,
  buildContactsWhere,
  contactedAtPatch,
  defaultContactado,
  createContactHandler,
  updateContactHandler,
  pendingCountHandler,
  listContactsHandler,
} from "@/routes/contacts";

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("contacts — validación zod", () => {
  it("create: type por defecto es prospecto y contactado queda sin fijar", () => {
    const parsed = createContactSchema.parse({ name: "Pepe" });
    expect(parsed.type).toBe("prospecto");
    expect(parsed.contactado).toBeUndefined();
  });

  it("defaultContactado: lead → 'no', prospecto → 'nc', explícito manda", () => {
    expect(defaultContactado("lead")).toBe("no");
    expect(defaultContactado("prospecto")).toBe("nc");
    expect(defaultContactado("lead", "si")).toBe("si");
    expect(defaultContactado("prospecto", "no")).toBe("no");
  });

  it("create: rechaza sin nombre y con email inválido", () => {
    expect(createContactSchema.safeParse({}).success).toBe(false);
    expect(createContactSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createContactSchema.safeParse({ name: "Pepe", email: "no-es-email" }).success).toBe(false);
  });

  it("create: rechaza types y estados fuera del enum", () => {
    expect(createContactSchema.safeParse({ name: "Pepe", type: "cliente" }).success).toBe(false);
    expect(createContactSchema.safeParse({ name: "Pepe", contactado: "maybe" }).success).toBe(false);
  });

  it("update: acepta parciales y nulls para limpiar campos", () => {
    expect(updateContactSchema.safeParse({ contactado: "si" }).success).toBe(true);
    expect(updateContactSchema.safeParse({ phone: null, clientId: null }).success).toBe(true);
    expect(updateContactSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("query de listado: filtros opcionales validados", () => {
    expect(listContactsQuerySchema.safeParse({}).success).toBe(true);
    expect(listContactsQuerySchema.safeParse({ type: "lead", contactado: "nc" }).success).toBe(true);
    expect(listContactsQuerySchema.safeParse({ type: "x" }).success).toBe(false);
  });
});

describe("contacts — buildContactsWhere", () => {
  it("sin filtros devuelve where vacío", () => {
    expect(buildContactsWhere({})).toEqual({});
  });

  it("aplica type y contactado cuando llegan", () => {
    expect(buildContactsWhere({ type: "lead", contactado: "no" })).toEqual({
      type: "lead",
      contactado: "no",
    });
  });
});

describe("contacts — contactedAtPatch", () => {
  const now = new Date("2026-06-12T10:00:00Z");

  it("sella contactedAt al pasar a 'si'", () => {
    expect(contactedAtPatch("si", { contactado: "nc", contactedAt: null }, now)).toEqual({
      contactedAt: now,
    });
  });

  it("no re-sella si ya estaba contactado", () => {
    const prev = new Date("2026-01-01T00:00:00Z");
    expect(contactedAtPatch("si", { contactado: "si", contactedAt: prev }, now)).toEqual({});
  });

  it("limpia contactedAt al volver a 'no' o 'nc'", () => {
    const prev = new Date("2026-01-01T00:00:00Z");
    expect(contactedAtPatch("no", { contactado: "si", contactedAt: prev }, now)).toEqual({
      contactedAt: null,
    });
    expect(contactedAtPatch("nc", { contactado: "si", contactedAt: prev }, now)).toEqual({
      contactedAt: null,
    });
  });

  it("no toca contactedAt si contactado no viene en el patch", () => {
    expect(contactedAtPatch(undefined, { contactado: "nc", contactedAt: null }, now)).toEqual({});
  });
});

describe("contacts — handlers", () => {
  it("POST crea con codigo pc-NN secuencial a partir de los existentes", async () => {
    prismaMock.prospectContact.findMany.mockResolvedValue([{ codigo: "pc-01" }, { codigo: "pc-02" }]);
    prismaMock.prospectContact.create.mockImplementation(async ({ data }: any) => ({ id: "x", ...data }));

    const res = mockRes();
    await createContactHandler({ body: { name: "María", type: "lead" } } as any, res);

    expect(res.statusCode).toBe(201);
    expect(prismaMock.prospectContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ codigo: "pc-03", type: "lead", contactado: "no" }),
      })
    );
  });

  it("POST devuelve 400 con body inválido sin tocar la BD", async () => {
    const res = mockRes();
    await createContactHandler({ body: { email: "pepe@test.com" } } as any, res);

    expect(res.statusCode).toBe(400);
    expect(prismaMock.prospectContact.create).not.toHaveBeenCalled();
  });

  it("PATCH a contactado=si sella contactedAt", async () => {
    prismaMock.prospectContact.findUnique.mockResolvedValue({ contactado: "nc", contactedAt: null });
    prismaMock.prospectContact.update.mockImplementation(async ({ data }: any) => ({ id: "c1", ...data }));

    const res = mockRes();
    await updateContactHandler({ params: { id: "c1" }, body: { contactado: "si" } } as any, res);

    expect(res.statusCode).toBe(200);
    const updateArgs = prismaMock.prospectContact.update.mock.calls[0][0];
    expect(updateArgs.data.contactado).toBe("si");
    expect(updateArgs.data.contactedAt).toBeInstanceOf(Date);
  });

  it("PATCH devuelve 404 si el contacto no existe", async () => {
    prismaMock.prospectContact.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await updateContactHandler({ params: { id: "nope" }, body: { name: "X" } } as any, res);
    expect(res.statusCode).toBe(404);
  });

  it("GET pending-count cuenta los contactos con contactado != si", async () => {
    prismaMock.prospectContact.count.mockResolvedValue(5);
    const res = mockRes();
    await pendingCountHandler({} as any, res);

    expect(res.body).toEqual({ count: 5 });
    expect(prismaMock.prospectContact.count).toHaveBeenCalledWith({
      where: { contactado: { not: "si" } },
    });
  });

  it("GET lista filtrando por type/contactado y ordena por createdAt desc", async () => {
    prismaMock.prospectContact.findMany.mockResolvedValue([]);
    const res = mockRes();
    await listContactsHandler({ query: { type: "lead", contactado: "nc" } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(prismaMock.prospectContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: "lead", contactado: "nc" },
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("GET rechaza filtros inválidos con 400", async () => {
    const res = mockRes();
    await listContactsHandler({ query: { type: "invalido" } } as any, res);
    expect(res.statusCode).toBe(400);
  });
});
