/**
 * service-operator-crud.test.ts — F6 (openspec/changes/aa-operator-agent).
 *
 * Cubre el CRUD de clientes y contactos añadido al router /service/operator:
 * alta completa de tenant (todos los campos), protocolo de confirmación
 * (confirmado:true → si no, 409) en cada escritura, edición y baja lógica de
 * cliente (isActive=false), CRUD de contactos reusando contacts.ts y la
 * conversión Contacto→Cliente que arrastra datos + completa razón social/NIF/
 * saldo y soft-borra el contacto.
 *
 * Mismo patrón que service-operator.test.ts: mock hoisted de prisma / codes /
 * audit, handlers importados y llamados con req/res simulados.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const prismaMock: any = {
    tenant: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    prospectContact: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  // $transaction ejecuta el callback pasándole el propio mock como tx.
  prismaMock.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/lib/codes", () => ({
  nextClientCode: vi.fn().mockResolvedValue("cli-05"),
  nextContactCode: vi.fn().mockResolvedValue("pc-05"),
  withCodeRetry: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock("@/lib/agent/service", () => ({ createAgent: vi.fn() }));
vi.mock("@/lib/operator-audit", () => ({ writeOperatorAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { writeOperatorAudit } from "@/lib/operator-audit";
import {
  crearClienteHandler,
  listClientesHandler,
  getClienteHandler,
  editarClienteHandler,
  borrarClienteHandler,
  operatorCrearContactoHandler,
  operatorEditarContactoHandler,
  operatorBorrarContactoHandler,
  convertirContactoHandler,
} from "@/routes/service-operator";
// Handlers reusados de contacts.ts (para stubear su prisma-path indirectamente
// se mockea @/lib/db arriba, compartido por ambos módulos).

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = vi.fn((b: any) => {
    res.body = b;
    return res;
  });
  return res;
}

function mockReq({
  body = {},
  params = {},
  query = {},
  headers = {},
}: { body?: any; params?: any; query?: any; headers?: Record<string, string> } = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    body,
    params,
    query,
    header: (name: string) => lower[name.toLowerCase()],
  } as any;
}

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── F6-T1: alta completa de cliente ─────────────────────────────────────────────
describe("POST /clientes (alta completa)", () => {
  it("persiste TODOS los campos mapeados a las props Prisma reales", async () => {
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_1", codigo: "cli-05", name: "Peluquería Sol" });
    const res = mockRes();

    await crearClienteHandler(
      mockReq({
        body: {
          confirmado: true,
          nombre: "Peluquería Sol",
          razonSocial: "Sol SL",
          nif: "B12345678",
          direccion: "Calle Mayor 1",
          sector: "belleza",
          sitioWeb: "https://sol.example",
          email: "sol@ejemplo.com",
          telefono: "600111222",
          contacto: "Marta",
          saldoTokens: 5000,
        },
      }),
      res
    );

    expect(res.statusCode).toBe(201);
    const createArg = asMock(prisma.tenant.create).mock.calls[0][0].data;
    expect(createArg).toMatchObject({
      codigo: "cli-05",
      name: "Peluquería Sol",
      razonSocial: "Sol SL",
      nif: "B12345678",
      direccion: "Calle Mayor 1",
      sector: "belleza",
      website: "https://sol.example",
      email: "sol@ejemplo.com",
      phone: "600111222",
      contactPerson: "Marta",
      tokenBalance: 5000,
    });
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_crear_cliente", resultado: "ok" })
    );
  });

  it("409 sin confirmado y NO crea nada", async () => {
    const res = mockRes();
    await crearClienteHandler(mockReq({ body: { nombre: "X" } }), res);
    expect(res.statusCode).toBe(409);
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });
});

// ── F6-T2: CRUD de clientes ─────────────────────────────────────────────────────
describe("GET /clientes", () => {
  it("lista solo clientes activos", async () => {
    asMock(prisma.tenant.findMany).mockResolvedValue([{ id: "ten_1", name: "A", isActive: true }]);
    const res = mockRes();
    await listClientesHandler(mockReq(), res);
    expect(asMock(prisma.tenant.findMany).mock.calls[0][0].where).toEqual({ isActive: true });
    expect(res.body).toHaveLength(1);
  });
});

describe("GET /clientes/:id", () => {
  it("404 si no existe", async () => {
    asMock(prisma.tenant.findUnique).mockResolvedValue(null);
    const res = mockRes();
    await getClienteHandler(mockReq({ params: { id: "nope" } }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /clientes/:id", () => {
  it("409 sin confirmado", async () => {
    const res = mockRes();
    await editarClienteHandler(mockReq({ params: { id: "ten_1" }, body: { nombre: "Nuevo" } }), res);
    expect(res.statusCode).toBe(409);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it("edita el subconjunto de campos con confirmado", async () => {
    asMock(prisma.tenant.findUnique).mockResolvedValue({ id: "ten_1" });
    asMock(prisma.tenant.update).mockResolvedValue({ id: "ten_1", name: "Nuevo" });
    const res = mockRes();

    await editarClienteHandler(
      mockReq({ params: { id: "ten_1" }, body: { confirmado: true, nombre: "Nuevo", saldoTokens: 100 } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(asMock(prisma.tenant.update).mock.calls[0][0].data).toEqual({ name: "Nuevo", tokenBalance: 100 });
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_editar_cliente", resultado: "ok" })
    );
  });

  it("404 si el cliente no existe", async () => {
    asMock(prisma.tenant.findUnique).mockResolvedValue(null);
    const res = mockRes();
    await editarClienteHandler(
      mockReq({ params: { id: "nope" }, body: { confirmado: true, nombre: "X" } }),
      res
    );
    expect(res.statusCode).toBe(404);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /clientes/:id (baja lógica)", () => {
  it("409 sin confirmado", async () => {
    const res = mockRes();
    await borrarClienteHandler(mockReq({ params: { id: "ten_1" }, body: {} }), res);
    expect(res.statusCode).toBe(409);
    expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
  });

  it("sella isActive=false y no vuelve a aparecer en listar", async () => {
    asMock(prisma.tenant.updateMany).mockResolvedValue({ count: 1 });
    const delRes = mockRes();
    await borrarClienteHandler(mockReq({ params: { id: "ten_1" }, body: { confirmado: true } }), delRes);
    expect(delRes.statusCode).toBe(200);
    expect(asMock(prisma.tenant.updateMany).mock.calls[0][0]).toEqual({
      where: { id: "ten_1", isActive: true },
      data: { isActive: false },
    });

    // Tras la baja, el listado (filtrado por isActive:true) no lo devuelve.
    asMock(prisma.tenant.findMany).mockResolvedValue([]);
    const listRes = mockRes();
    await listClientesHandler(mockReq(), listRes);
    expect(listRes.body).toEqual([]);
  });

  it("404 si no existe o ya estaba de baja", async () => {
    asMock(prisma.tenant.updateMany).mockResolvedValue({ count: 0 });
    const res = mockRes();
    await borrarClienteHandler(mockReq({ params: { id: "nope" }, body: { confirmado: true } }), res);
    expect(res.statusCode).toBe(404);
  });
});

// ── F6-T3: CRUD de contactos (reuso de contacts.ts) ─────────────────────────────
describe("CRUD de contactos", () => {
  it("409 sin confirmado en crear, sin tocar la BD", async () => {
    const res = mockRes();
    await operatorCrearContactoHandler(mockReq({ body: { name: "Bar Pepe" } }), res);
    expect(res.statusCode).toBe(409);
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_crear_contacto", detalle: "confirmation_required" })
    );
  });

  it("crea contacto con confirmado y deja auditoría ok", async () => {
    // createContactHandler (contacts.ts) usa prisma.prospectContact.create.
    (prisma as any).prospectContact.create = vi.fn().mockResolvedValue({ id: "pc_1", name: "Bar Pepe" });
    const res = mockRes();

    await operatorCrearContactoHandler(
      mockReq({ body: { confirmado: true, name: "Bar Pepe", type: "prospecto" } }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_crear_contacto", resultado: "ok" })
    );
  });

  it("edita contacto con confirmado", async () => {
    asMock(prisma.prospectContact.findUnique).mockResolvedValue({
      contactado: "no",
      contactedAt: null,
      deletedAt: null,
    });
    asMock(prisma.prospectContact.update).mockResolvedValue({ id: "pc_1", name: "Bar Nuevo" });
    const res = mockRes();

    await operatorEditarContactoHandler(
      mockReq({ params: { id: "pc_1" }, body: { confirmado: true, name: "Bar Nuevo" } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_editar_contacto", resultado: "ok" })
    );
  });

  it("borra-soft contacto con confirmado", async () => {
    // deleteContactHandler usa prisma.prospectContact.updateMany.
    (prisma as any).prospectContact.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const res = mockRes();

    await operatorBorrarContactoHandler(
      mockReq({ params: { id: "pc_1" }, body: { confirmado: true } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_borrar_contacto", resultado: "ok" })
    );
  });
});

// ── F6-T4: conversión Contacto → Cliente ────────────────────────────────────────
describe("POST /contactos/:id/convertir", () => {
  it("409 sin confirmado, sin tocar la BD", async () => {
    const res = mockRes();
    await convertirContactoHandler(mockReq({ params: { id: "pc_1" }, body: {} }), res);
    expect(res.statusCode).toBe(409);
    expect(prisma.prospectContact.findUnique).not.toHaveBeenCalled();
  });

  it("arrastra datos del contacto + completa razón social/NIF/saldo y soft-borra", async () => {
    asMock(prisma.prospectContact.findUnique).mockResolvedValue({
      id: "pc_1",
      name: "Bar Pepe",
      email: "pepe@ejemplo.com",
      phone: "600999888",
      sector: "hosteleria",
      direccion: "Plaza 2",
      tenantId: null,
      deletedAt: null,
    });
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_9", codigo: "cli-05", name: "Bar Pepe" });
    asMock(prisma.prospectContact.update).mockResolvedValue({});
    const res = mockRes();

    await convertirContactoHandler(
      mockReq({
        params: { id: "pc_1" },
        body: { confirmado: true, razonSocial: "Pepe SL", nif: "B99", saldoTokens: 3000 },
      }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: "ten_9", codigo: "cli-05", contactId: "pc_1" });

    const createArg = asMock(prisma.tenant.create).mock.calls[0][0].data;
    expect(createArg).toMatchObject({
      name: "Bar Pepe",
      email: "pepe@ejemplo.com",
      phone: "600999888",
      sector: "hosteleria",
      direccion: "Plaza 2",
      razonSocial: "Pepe SL",
      nif: "B99",
      tokenBalance: 3000,
    });
    // Soft-borra el contacto y lo vincula al tenant creado.
    expect(asMock(prisma.prospectContact.update).mock.calls[0][0].where).toEqual({ id: "pc_1" });
    const updateData = asMock(prisma.prospectContact.update).mock.calls[0][0].data;
    expect(updateData.tenantId).toBe("ten_9");
    expect(updateData.deletedAt).toBeInstanceOf(Date);

    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_convertir_contacto", resultado: "ok", detalle: "ten_9" })
    );
  });

  it("fallo parcial: prospectContact.update lanza dentro de la transacción → 500 y el create queda revertido", async () => {
    asMock(prisma.prospectContact.findUnique).mockResolvedValue({
      id: "pc_1",
      name: "Bar Pepe",
      email: "pepe@ejemplo.com",
      phone: "600999888",
      sector: "hosteleria",
      direccion: "Plaza 2",
      tenantId: null,
      deletedAt: null,
    });
    // Trazamos que create y update ocurren DENTRO del mismo callback de
    // $transaction y que el error del update propaga fuera (rollback real en Prisma).
    const calls: string[] = [];
    asMock((prisma as any).$transaction).mockImplementationOnce(
      async (fn: (tx: unknown) => unknown) => {
        calls.push("tx:start");
        try {
          return await fn(prisma);
        } finally {
          calls.push("tx:end");
        }
      }
    );
    asMock(prisma.tenant.create).mockImplementationOnce(async () => {
      calls.push("create");
      return { id: "ten_9", codigo: "cli-05", name: "Bar Pepe" };
    });
    asMock(prisma.prospectContact.update).mockImplementationOnce(async () => {
      calls.push("update:boom");
      throw new Error("boom");
    });

    const res = mockRes();
    await convertirContactoHandler(
      mockReq({ params: { id: "pc_1" }, body: { confirmado: true } }),
      res
    );

    expect(res.statusCode).toBe(500);
    expect(calls).toEqual(["tx:start", "create", "update:boom", "tx:end"]);
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_convertir_contacto", resultado: "error", detalle: "convert_failed" })
    );

    // Reintento con update funcional → convierte normalmente (sin duplicado: el
    // create anterior quedó dentro de la transacción abortada).
    asMock(prisma.tenant.create).mockResolvedValue({ id: "ten_9", codigo: "cli-05", name: "Bar Pepe" });
    asMock(prisma.prospectContact.update).mockResolvedValue({});
    const res2 = mockRes();
    await convertirContactoHandler(
      mockReq({ params: { id: "pc_1" }, body: { confirmado: true } }),
      res2
    );
    expect(res2.statusCode).toBe(201);
    expect(res2.body).toMatchObject({ id: "ten_9", contactId: "pc_1" });
  });

  it("404 si el contacto no existe", async () => {
    asMock(prisma.prospectContact.findUnique).mockResolvedValue(null);
    const res = mockRes();
    await convertirContactoHandler(
      mockReq({ params: { id: "nope" }, body: { confirmado: true } }),
      res
    );
    expect(res.statusCode).toBe(404);
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it("409 si el contacto ya estaba convertido", async () => {
    asMock(prisma.prospectContact.findUnique).mockResolvedValue({
      id: "pc_1",
      name: "Bar Pepe",
      tenantId: "ten_prev",
      deletedAt: null,
    });
    const res = mockRes();
    await convertirContactoHandler(
      mockReq({ params: { id: "pc_1" }, body: { confirmado: true } }),
      res
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: { code: "already_converted" } });
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it("cierra la carrera (TOCTOU): re-verificación DENTRO de la tx ve tenantId ya puesto por otra request concurrente → 409 already_converted, sin duplicar el tenant", async () => {
    // El chequeo previo a la tx (findUnique de arriba, primera llamada) NO ve
    // el tenantId todavía; el re-fetch DENTRO de la tx (segunda llamada, vía
    // tx.prospectContact.findUnique) sí: simula que la tx de la otra request
    // concurrente ya confirmó su commit entre medias.
    asMock(prisma.prospectContact.findUnique)
      .mockResolvedValueOnce({
        id: "pc_1",
        name: "Bar Pepe",
        email: "pepe@ejemplo.com",
        phone: "600999888",
        sector: "hosteleria",
        direccion: "Plaza 2",
        tenantId: null,
        deletedAt: null,
      })
      .mockResolvedValueOnce({ tenantId: "ten_won_the_race" });

    const res = mockRes();
    await convertirContactoHandler(
      mockReq({ params: { id: "pc_1" }, body: { confirmado: true } }),
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: { code: "already_converted" } });
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(prisma.prospectContact.update).not.toHaveBeenCalled();
    expect(writeOperatorAudit).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "agencia_convertir_contacto", resultado: "error", detalle: "already_converted" })
    );
  });
});
