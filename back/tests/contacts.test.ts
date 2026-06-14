import { describe, expect, it, beforeEach, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  prospectContact: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
  },
  client: {
    findMany: vi.fn(),
    create: vi.fn(),
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
  convertToClientsHandler,
  convertToClientsSchema,
  deleteContactHandler,
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

  it("defaultContactado: siempre 'no' (lead y prospecto), explícito manda", () => {
    expect(defaultContactado("lead")).toBe("no");
    expect(defaultContactado("prospecto")).toBe("no");
    expect(defaultContactado("lead", "si")).toBe("si");
    expect(defaultContactado("prospecto", "nc")).toBe("nc");
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
  it("sin filtros excluye los borrados (soft delete)", () => {
    expect(buildContactsWhere({})).toEqual({ deletedAt: null });
  });

  it("aplica type y contactado cuando llegan, manteniendo el filtro de borrados", () => {
    expect(buildContactsWhere({ type: "lead", contactado: "no" })).toEqual({
      deletedAt: null,
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
      where: { contactado: { not: "si" }, deletedAt: null },
    });
  });

  it("GET lista filtrando por type/contactado y ordena por createdAt desc", async () => {
    prismaMock.prospectContact.findMany.mockResolvedValue([]);
    const res = mockRes();
    await listContactsHandler({ query: { type: "lead", contactado: "nc" } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(prismaMock.prospectContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, type: "lead", contactado: "nc" },
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

describe("contacts — convert-to-clients", () => {
  it("schema exige al menos un id", () => {
    expect(convertToClientsSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(convertToClientsSchema.safeParse({ ids: ["c1"] }).success).toBe(true);
  });

  it("crea un cliente por contacto y lo vincula", async () => {
    prismaMock.prospectContact.findMany.mockResolvedValue([
      { id: "c1", name: "Ana", email: "ana@x.com", phone: "611", sector: "tech", direccion: null, clientId: null },
    ]);
    prismaMock.client.findMany.mockResolvedValue([]); // nextClientCode → cli-01
    prismaMock.client.create.mockImplementation(async ({ data }: any) => ({ id: "cl1", ...data }));
    prismaMock.prospectContact.update.mockResolvedValue({});

    const res = mockRes();
    await convertToClientsHandler({ body: { ids: ["c1"] } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.created).toHaveLength(1);
    expect(prismaMock.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ codCliente: "cli-01", name: "Ana", email: "ana@x.com" }),
      })
    );
    expect(prismaMock.prospectContact.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { clientId: "cl1" },
    });
  });

  it("no duplica si el contacto ya tiene clientId", async () => {
    prismaMock.prospectContact.findMany.mockResolvedValue([
      { id: "c2", name: "Bob", email: null, phone: null, sector: null, direccion: null, clientId: "cl-existing" },
    ]);

    const res = mockRes();
    await convertToClientsHandler({ body: { ids: ["c2"] } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.created).toHaveLength(0);
    expect(res.body.failed).toHaveLength(1);
    expect(prismaMock.client.create).not.toHaveBeenCalled();
  });

  it("devuelve 400 con ids vacíos", async () => {
    const res = mockRes();
    await convertToClientsHandler({ body: { ids: [] } } as any, res);
    expect(res.statusCode).toBe(400);
  });
});

describe("contacts — deleteContactHandler (soft delete)", () => {
  beforeEach(() => {
    prismaMock.prospectContact.updateMany.mockReset();
  });

  it("sella deletedAt en vez de borrar la fila", async () => {
    prismaMock.prospectContact.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();
    await deleteContactHandler({ params: { id: "c1" } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(prismaMock.prospectContact.delete).not.toHaveBeenCalled();
    const call = prismaMock.prospectContact.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "c1", deletedAt: null });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("devuelve 404 si no existe o ya estaba borrado (count 0)", async () => {
    prismaMock.prospectContact.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    await deleteContactHandler({ params: { id: "nope" } } as any, res);

    expect(res.statusCode).toBe(404);
  });
});
