/**
 * H5 (aa-portal-cliente, T2.4) — La puerta deny-by-default.
 *
 * El test que importa de este fichero es el de la ruta INVENTADA. Los demás comprueban que la puerta
 * hace lo que dice; ese comprueba lo otro, que es lo que de verdad se compró al elegir deny-by-default:
 * que un router que nadie ha escrito todavía ya está cerrado para un `client`. Si algún día alguien
 * invierte la puerta a "filtrar cuando se acuerde", ese test cae — y es el único que caería.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { clientScopeGate, CLIENT_ROLE } from "@/lib/client-scope";
import { isClientAllowed, CLIENT_RULES } from "@/lib/client-routes";
import type { SessionUser } from "@/lib/auth";

/** Usuario de portal bien formado. */
const cliente: SessionUser = {
  id: "u-cli",
  firstName: "Ana",
  lastName: "Cliente",
  email: "ana@negocio.es",
  role: CLIENT_ROLE,
  tenantId: "t1",
};

/** Usuario del estudio: `tenantId` null, que es lo que significa staff. */
const staff: SessionUser = {
  id: "u-staff",
  firstName: "Adrián",
  lastName: "Estudio",
  email: "staff@estudio.es",
  role: "admin",
  tenantId: null,
};

/**
 * App mínima: inyecta el usuario que se le diga, monta la puerta donde la monta `index.ts` y sirve un
 * `200 { ok: true }` en cualquier ruta. Así, un 200 significa "la puerta dejó pasar" sin depender de
 * ningún router real.
 */
function buildApp(user?: SessionUser) {
  const app = express();
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use("/api", clientScopeGate);
  app.all(/.*/, (_req, res) => res.json({ ok: true }));
  return app;
}

function call(
  app: express.Express,
  method: string,
  path: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      http
        .request({ host: "127.0.0.1", port, method, path }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null });
          });
        })
        .on("error", (e) => {
          server.close();
          reject(e);
        })
        .end();
    });
  });
}

beforeEach(() => vi.clearAllMocks());

describe("T2.1 — la allowlist es pura y sólo abre GET bajo /api/portal", () => {
  it("permite GET /api/portal y sus subrutas", () => {
    expect(isClientAllowed("GET", "/api/portal")).toBe(true);
    expect(isClientAllowed("GET", "/api/portal/me")).toBe(true);
    expect(isClientAllowed("GET", "/api/portal/agents/a1/conversations")).toBe(true);
  });

  it("no permite escribir en el portal: el portal de H5 es de lectura", () => {
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(isClientAllowed(m, "/api/portal/me")).toBe(false);
    }
  });

  it("no confunde un prefijo parecido con /api/portal", () => {
    // `/api/portalero` empieza igual pero no es el portal. Con `startsWith` a secas y sin la barra,
    // cualquier router futuro que empezara por "portal" quedaría abierto sin querer.
    expect(isClientAllowed("GET", "/api/portalero")).toBe(false);
    expect(isClientAllowed("GET", "/api/portal-admin/x")).toBe(false);
  });

  it("permite cambiar su propia contraseña, y nada más de /api/auth", () => {
    // Añadido en T5.1: el alta de usuario de portal fija una contraseña inicial que el estudio
    // entrega en mano, y sin este endpoint esa contraseña compartida sería la definitiva. No abre
    // datos: el endpoint opera sobre `req.user.id` y exige la contraseña actual.
    expect(isClientAllowed("POST", "/api/auth/change-password")).toBe(true);
    expect(isClientAllowed("GET", "/api/auth/change-password")).toBe(false);
    // `/api/auth/me` no necesita regla: es pública, y la puerta la deja pasar antes de mirar aquí.
    expect(isClientAllowed("PATCH", "/api/auth/profile")).toBe(false);
    expect(isClientAllowed("POST", "/api/auth/logout")).toBe(false);
  });

  it("la lista tiene DOS reglas: cada añadido futuro es una decisión visible", () => {
    // Este número es un tripwire, no un detalle: si sube sin que alguien venga a cambiarlo aquí a
    // mano y a explicarlo, es que se ha ampliado lo que ve un cliente sin decidirlo.
    expect(CLIENT_RULES).toHaveLength(2);
  });
});

describe("T2.2 — AC1/AC2: el client sólo alcanza el portal", () => {
  it("GET /api/portal/me pasa", async () => {
    const { status, body } = await call(buildApp(cliente), "GET", "/api/portal/me");
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("GET /api/clients (datos de TODOS los clientes) devuelve 403", async () => {
    const { status } = await call(buildApp(cliente), "GET", "/api/clients");
    expect(status).toBe(403);
  });

  it("GET /api/agents del panel del estudio devuelve 403", async () => {
    const { status } = await call(buildApp(cliente), "GET", "/api/agents");
    expect(status).toBe(403);
  });

  it("escribir en el portal devuelve 403, aunque el path esté permitido para GET", async () => {
    const { status } = await call(buildApp(cliente), "POST", "/api/portal/me");
    expect(status).toBe(403);
  });

  it("una ruta que NO EXISTE todavía ya está cerrada para un client", async () => {
    // El corazón de deny-by-default: el router de mañana no necesita que nadie se acuerde de escoparlo.
    const { status } = await call(buildApp(cliente), "GET", "/api/facturacion-nueva-2027/todo");
    expect(status).toBe(403);
  });

  it("el 403 no filtra datos: sólo el mensaje", async () => {
    const { body } = await call(buildApp(cliente), "GET", "/api/clients");
    expect(body).toEqual({ error: "Acceso no permitido" });
  });
});

describe("T2.2 — AC5: el staff no lo toca esta puerta", () => {
  it("admin alcanza /api/clients", async () => {
    const { status } = await call(buildApp(staff), "GET", "/api/clients");
    expect(status).toBe(200);
  });

  it("admin alcanza cualquier ruta, incluida una inventada", async () => {
    const { status } = await call(buildApp(staff), "POST", "/api/lo-que-sea");
    expect(status).toBe(200);
  });

  it("sin sesión la puerta no decide: eso ya lo resolvió el gate de auth", async () => {
    const { status } = await call(buildApp(undefined), "GET", "/api/clients");
    expect(status).toBe(200); // en la app real el gate anterior habría devuelto 401
  });
});

describe("T2.2 — AC6: client sin tenantId es 403, no acceso sin filtro", () => {
  const sinTenant: SessionUser = { ...cliente, tenantId: null };

  it("403 incluso en una ruta permitida del portal", async () => {
    const { status, body } = await call(buildApp(sinTenant), "GET", "/api/portal/me");
    expect(status).toBe(403);
    expect(body).toEqual({ error: "Usuario de cliente sin tenant asignado" });
  });

  it("`tenantId` undefined (backend viejo o select incompleto) también corta", async () => {
    const { tenantId: _omitido, ...resto } = cliente;
    const { status } = await call(buildApp(resto as SessionUser), "GET", "/api/portal/me");
    expect(status).toBe(403);
  });

  it("cadena vacía no cuenta como tenant", async () => {
    const { status } = await call(buildApp({ ...cliente, tenantId: "" }), "GET", "/api/portal/me");
    expect(status).toBe(403);
  });
});

describe("T2.2 — AC11: las rutas públicas siguen siendo públicas", () => {
  it("un client puede hacer POST /api/chat (el widget es público)", async () => {
    // Bloquearlo sería incoherente: el mismo navegador sin sesión sí entra.
    const { status } = await call(buildApp(cliente), "POST", "/api/chat");
    expect(status).toBe(200);
  });

  it("un client puede leer GET /api/auth/me", async () => {
    const { status } = await call(buildApp(cliente), "GET", "/api/auth/me");
    expect(status).toBe(200);
  });

  it("la query string no cambia la decisión", async () => {
    // La puerta compara el path sin `?`. Si no lo hiciera, `/api/portal/me?x=1` no encajaría con
    // ninguna regla y saldría un 403 en algo que sí está permitido.
    const permitido = await call(buildApp(cliente), "GET", "/api/portal/me?periodo=actual");
    expect(permitido.status).toBe(200);

    const denegado = await call(buildApp(cliente), "GET", "/api/clients?todos=1");
    expect(denegado.status).toBe(403);
  });
});
