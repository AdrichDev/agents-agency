// landing-build-paths — S9: the panel reads the build zip name from Content-Disposition.
//
// The panel and the API live on different origins, and Content-Disposition is not a
// CORS-safelisted response header: unless the strict layer exposes it, the browser hides it
// and every download falls back to "landing.zip".
import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { crearCorsPorRuta } from "@/lib/cors-layers";

const PANEL = "https://panel-nuestro.example";

function request(app: express.Express, method: string, path: string, headers: Record<string, string>) {
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        res.resume();
        res.on("end", () => {
          server.close();
          resolve(res);
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

function app() {
  const a = express();
  a.use(crearCorsPorRuta(new Set([PANEL])));
  a.post("/api/landing/p1/build", (_req, res) => {
    res.setHeader("Content-Disposition", 'attachment; filename="mi-landing.zip"');
    res.end("zip");
  });
  return a;
}

describe("strict CORS layer", () => {
  it("exposes Content-Disposition to the panel origin", async () => {
    const res = await request(app(), "POST", "/api/landing/p1/build", { Origin: PANEL });
    expect(res.headers["access-control-allow-origin"]).toBe(PANEL);
    expect(String(res.headers["access-control-expose-headers"] ?? "")).toMatch(/content-disposition/i);
  });
});
