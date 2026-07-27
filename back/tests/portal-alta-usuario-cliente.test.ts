/**
 * H5 (aa-portal-cliente, T5.2) — Alta de usuario de portal.
 *
 * Lo que se defiende aquí es la invariante que el esquema no puede expresar: `role = "client"` ⇒
 * `tenantId` obligatorio. Un usuario de portal sin tenant es la fila que la puerta `clientScopeGate`
 * tiene que negar, así que la forma de que no exista es que el endpoint que la crea no pueda crearla:
 * el tenant sale de la URL y el `role` lo fija el servidor. Se asierta el `data` que llega a Prisma,
 * no el 201 — un 201 también lo devuelve la versión que guarda `role: "admin"`.
 *
 * El segundo bloque prueba la compensación: si el perfil falla después de crear la cuenta en Supabase
 * Auth, esa cuenta se borra. Sin eso queda un usuario que inicia sesión y recibe 401 en `/api/auth/me`
 * para siempre, y que además bloquea el reintento con el mismo email.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/codes", () => ({ nextClientCode: vi.fn(), withCodeRetry: vi.fn() }));

// Mock parcial: `supabaseAdmin` se dobla (crear cuentas de verdad no es un test), pero `requireRole`
// se usa REAL. Doblarlo dejaría el 403 del rol sin probar, que es justo la mitad de este endpoint.
vi.mock("@/lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth")>();
  return {
    ...actual,
    supabaseAdmin: {
      auth: {
        admin: {
          createUser: vi.fn(),
          deleteUser: vi.fn(),
        },
      },
    },
  };
});

import { prisma } from "@/lib/db";
import { supabaseAdmin } from "@/lib/auth";
import { clientsRouter } from "@/routes/clients";
// El errorHandler real, igual que en T3.6: sin él un `HttpError(409)` acabaría en 500 y los tests de
// conflicto estarían midiendo el envelope de otro middleware.
import { errorHandler } from "@/lib/observability";
import type { SessionUser } from "@/lib/auth";

const mTenant = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const mUserFind = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const mUserCreate = prisma.user.create as ReturnType<typeof vi.fn>;
const mCreateUser = (supabaseAdmin as any).auth.admin.createUser as ReturnType<typeof vi.fn>;
const mDeleteUser = (supabaseAdmin as any).auth.admin.deleteUser as ReturnType<typeof vi.fn>;

const admin: SessionUser = {
  id: "u-staff",
  firstName: "Adrián",
  lastName: "Estudio",
  email: "staff@3aestudio.es",
  role: "admin",
  tenantId: null,
};

const editor: SessionUser = { ...admin, id: "u-editor", role: "editor" };

const AUTH_UUID = "00000000-0000-4000-8000-0000000000aa";

/** Cuerpo válido mínimo. La contraseña cumple la política (12+, letra y número). */
function body(over: Record<string, unknown> = {}) {
  return {
    email: "ana@negocio.es",
    firstName: "Ana",
    lastName: "Cliente",
    password: "PortalAna2026",
    ...over,
  };
}

// `null` y no `undefined` para "sin sesión": un `undefined` explícito activa el valor por defecto del
// parámetro, así que el test de 401 se ejecutaría como admin y pasaría por el motivo equivocado.
function post(
  path: string,
  payload: unknown,
  user: SessionUser | null = admin
): Promise<{ status: number; body: any }> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use("/api/clients", clientsRouter);
  app.use(errorHandler);

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const data = JSON.stringify(payload);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(data)),
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
          });
        }
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      req.write(data);
      req.end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mTenant.mockResolvedValue({ id: "t1" });
  mUserFind.mockResolvedValue(null);
  mCreateUser.mockResolvedValue({ data: { user: { id: AUTH_UUID } }, error: null });
  mUserCreate.mockImplementation(async ({ data, select }: any) => {
    // Devuelve sólo lo que la ruta pide en el `select`, como haría Prisma: así el test de "no
    // devuelve la contraseña" no pasa por casualidad porque el doble devuelva un objeto pobre.
    const row: Record<string, unknown> = { ...data };
    return Object.fromEntries(Object.keys(select).map((k) => [k, row[k] ?? null]));
  });
});

describe("T5.1 — POST /api/clients/:id/portal-users", () => {
  it("crea el usuario con role client y el tenant de la URL", async () => {
    const res = await post("/api/clients/t1/portal-users", body());

    expect(res.status).toBe(201);
    const data = mUserCreate.mock.calls[0][0].data;
    expect(data.role).toBe("client");
    expect(data.tenantId).toBe("t1");
    // El id es el UUID que asignó Supabase Auth: `aa.usuario.id` reutiliza el de `auth.users`, y si
    // el endpoint generara uno propio el perfil no lo encontraría nadie al iniciar sesión.
    expect(data.id).toBe(AUTH_UUID);
    expect(data.email).toBe("ana@negocio.es");
    expect(res.body.role).toBe("client");
    expect(res.body.tenantId).toBe("t1");
  });

  it("ignora un tenantId inyectado en el body", async () => {
    await post("/api/clients/t1/portal-users", body({ tenantId: "t-ajeno" }));

    // El tenant lo decide la URL. Si el body pudiera cambiarlo, dar de alta a alguien en la cuenta
    // del vecino sería añadir un campo al JSON.
    expect(mUserCreate.mock.calls[0][0].data.tenantId).toBe("t1");
  });

  it("ignora un role inyectado en el body", async () => {
    await post("/api/clients/t1/portal-users", body({ role: "admin" }));

    // El rol lo fija el servidor. Un alta de portal que acepte `role` es una escalada de privilegios
    // servida por el propio endpoint.
    expect(mUserCreate.mock.calls[0][0].data.role).toBe("client");
  });

  it("normaliza el email a minúsculas y sin espacios", async () => {
    await post("/api/clients/t1/portal-users", body({ email: "  Ana@Negocio.ES " }));

    // `email` es UNIQUE: sin normalizar, "Ana@" y "ana@" son dos usuarios de portal para la misma
    // persona y el 409 no salta.
    expect(mUserFind.mock.calls[0][0].where.email).toBe("ana@negocio.es");
    expect(mUserCreate.mock.calls[0][0].data.email).toBe("ana@negocio.es");
  });

  it("la respuesta no incluye la contraseña", async () => {
    const res = await post("/api/clients/t1/portal-users", body());

    expect(res.body.password).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("PortalAna2026");
  });

  it("404 si el cliente no existe, sin tocar Supabase", async () => {
    mTenant.mockResolvedValue(null);

    const res = await post("/api/clients/no-existe/portal-users", body());

    expect(res.status).toBe(404);
    // Crear la cuenta de Auth antes de comprobar el tenant dejaría una cuenta huérfana por cada
    // typo en el id del cliente.
    expect(mCreateUser).not.toHaveBeenCalled();
  });

  it("409 si el email ya está en la plataforma, sin tocar Supabase", async () => {
    mUserFind.mockResolvedValue({ id: "u-ya" });

    const res = await post("/api/clients/t1/portal-users", body());

    expect(res.status).toBe(409);
    expect(mCreateUser).not.toHaveBeenCalled();
    expect(mUserCreate).not.toHaveBeenCalled();
  });

  it("409 si Supabase ya tiene ese email aunque la plataforma no", async () => {
    mCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "A user with this email address has already been registered" },
    });

    const res = await post("/api/clients/t1/portal-users", body());

    // Sigue siendo un conflicto, no un fallo del servidor: el estado que impide seguir es un dato
    // que ya existe, y un 500 mandaría al operador a mirar logs en vez de a mirar el email.
    expect(res.status).toBe(409);
    expect(mUserCreate).not.toHaveBeenCalled();
  });

  it("rechaza una contraseña que no cumple la política, sin tocar Supabase", async () => {
    const res = await post("/api/clients/t1/portal-users", body({ password: "corta1" }));

    expect(res.status).toBe(400);
    expect(mCreateUser).not.toHaveBeenCalled();
  });

  it("403 si quien llama no es admin", async () => {
    const res = await post("/api/clients/t1/portal-users", body(), editor);

    expect(res.status).toBe(403);
    // Ni siquiera se mira si el cliente existe: el rol se decide antes de tocar la base.
    expect(mTenant).not.toHaveBeenCalled();
    expect(mCreateUser).not.toHaveBeenCalled();
  });

  it("401 si no hay sesión", async () => {
    const res = await post("/api/clients/t1/portal-users", body(), null);

    expect(res.status).toBe(401);
    expect(mCreateUser).not.toHaveBeenCalled();
  });
});

describe("T5.1 — compensación si el perfil falla", () => {
  it("borra la cuenta de Auth cuando el create de Prisma revienta", async () => {
    mUserCreate.mockRejectedValue(new Error("db caída"));
    mDeleteUser.mockResolvedValue({ error: null });

    const res = await post("/api/clients/t1/portal-users", body());

    expect(res.status).toBe(500);
    expect(mDeleteUser).toHaveBeenCalledWith(AUTH_UUID);
  });

  it("si la compensación también falla, el fallo original sigue subiendo", async () => {
    mUserCreate.mockRejectedValue(new Error("db caída"));
    mDeleteUser.mockResolvedValue({ error: { message: "auth caída" } });

    const res = await post("/api/clients/t1/portal-users", body());

    // Queda una cuenta huérfana que hay que borrar a mano (se registra su id). Lo que NO puede pasar
    // es devolver 201: no hay perfil, así que ese usuario no puede usar el portal.
    expect(res.status).toBe(500);
  });
});
