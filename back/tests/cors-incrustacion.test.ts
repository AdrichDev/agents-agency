// aa-widget-entrega-cross-origin — T2, T3, T4.
//
// Monta el MISMO orden de middlewares que index.ts y los MISMOS objetos
// (crearCorsPorRuta, errorHandler, helmet). Una reimplementación aquí dejaría
// pasar justo el fallo que este cambio arregla: el orden importa tanto como la
// política. Por eso helmet() va montado de verdad — es quien pone
// `Cross-Origin-Resource-Policy: same-origin` y a quien el estático tiene que
// sobreescribir.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import helmet from "helmet";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { crearCorsPorRuta } from "@/lib/cors-layers";
import { errorHandler } from "@/lib/observability";

const PANEL = "https://panel-nuestro.example";
const AJENO = "https://cliente-cualquiera.com";

function crearApp() {
  const app = express();
  app.use(helmet());

  app.use(crearCorsPorRuta(new Set([PANEL])));

  app.use(
    express.static(path.join(process.cwd(), "public"), {
      setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
    })
  );

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/chat", (_req, res) => res.json({ reply: "hola" }));
  app.post("/api/auth/login", (_req, res) => res.json({ token: "x" }));
  app.get("/api/agents", (_req, res) => res.json([]));

  app.use(errorHandler);
  return app;
}

type Respuesta = { status: number; headers: Record<string, string | string[] | undefined> };

function request(
  app: express.Express,
  method: string,
  ruta: string,
  headers: Record<string, string> = {}
): Promise<Respuesta> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method, path: ruta, headers }, (res) => {
        res.resume();
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode ?? 0, headers: res.headers });
        });
      });
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      req.end();
    });
  });
}

// La capa estricta solo rechaza en producción; sin esto el test verificaría el
// modo permisivo de desarrollo y no probaría nada.
let app: express.Express;
beforeEach(() => {
  process.env.NODE_ENV = "production";
  app = crearApp();
});
afterEach(() => {
  process.env.NODE_ENV = "test";
});

describe("T4 — CORP: el estático se puede incrustar, la API no se relaja", () => {
  // E1
  it("E1 — GET /widget.js sale con Cross-Origin-Resource-Policy: cross-origin", async () => {
    const res = await request(app, "GET", "/widget.js");
    expect(res.status).toBe(200);
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });

  // E2
  it("E2 — el resto de la API conserva same-origin", async () => {
    const res = await request(app, "GET", "/health");
    expect(res.status).toBe(200);
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });
});

describe("T2 — capa de incrustación: el widget puede hablar desde otro dominio", () => {
  // E3 — el preflight es lo primero que manda el navegador. Si responde 500,
  // la petición real no llega a salir nunca.
  it("E3 — preflight de POST /api/chat desde origen ajeno: 2xx, origen reflejado, SIN credenciales", async () => {
    const res = await request(app, "OPTIONS", "/api/chat", {
      Origin: AJENO,
      "Access-Control-Request-Method": "POST",
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe(AJENO);
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("E3b — la petición real también pasa, y nunca con `*`", async () => {
    const res = await request(app, "POST", "/api/chat", { Origin: AJENO });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(AJENO);
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("las demás rutas incrustables se comportan igual", async () => {
    const res = await request(app, "OPTIONS", "/api/chat", {
      Origin: AJENO,
      "Access-Control-Request-Method": "POST",
    });
    expect(res.headers["access-control-allow-origin"]).toBe(AJENO);
  });

  // E4 — la consola de operador llama a /api/chat con cookie de sesión: si
  // pierde las credenciales, el panel deja de funcionar.
  it("E4 — POST /api/chat desde la allowlist conserva las credenciales", async () => {
    const res = await request(app, "POST", "/api/chat", { Origin: PANEL });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(PANEL);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  // E8
  it("E8 — sin cabecera Origin (servidor a servidor) el comportamiento no cambia", async () => {
    const chat = await request(app, "POST", "/api/chat");
    expect(chat.status).toBe(200);
    const login = await request(app, "POST", "/api/auth/login");
    expect(login.status).toBe(200);
  });
});

describe("T3 — lo que exige sesión sigue cerrado, y con el código correcto", () => {
  // E5 — antes era 500 y además llegaba a Sentry como avería del servidor.
  it("E5 — POST /api/auth/login desde origen ajeno responde 403, no 500", async () => {
    const res = await request(app, "POST", "/api/auth/login", { Origin: AJENO });
    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("una ruta protegida desde origen ajeno también es 403", async () => {
    const res = await request(app, "GET", "/api/agents", { Origin: AJENO });
    expect(res.status).toBe(403);
  });

  it("el preflight de una ruta no incrustable tampoco se abre", async () => {
    const res = await request(app, "OPTIONS", "/api/auth/login", {
      Origin: AJENO,
      "Access-Control-Request-Method": "POST",
    });
    expect(res.status).toBe(403);
  });

  it("desde la allowlist, la ruta protegida pasa con credenciales", async () => {
    const res = await request(app, "GET", "/api/agents", { Origin: PANEL });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(PANEL);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});
