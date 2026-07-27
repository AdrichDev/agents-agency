import { describe, it, expect } from "vitest";
import { EMBED_RULES, isEmbeddable, isPublic, isServiceCall } from "@/lib/public-routes";

// Regresión del hallazgo CRÍTICO: /api/channels/* quedaba TODO público
// (prefix ANY). Solo los webhooks deben ser públicos; la gestión (connect/status/
// delete) debe exigir sesión.
describe("public-routes — channels: solo webhooks públicos", () => {
  it("webhooks PÚBLICOS", () => {
    expect(isPublic("POST", "/api/channels/telegram/agent123")).toBe(true);
    expect(isPublic("POST", "/api/channels/whatsapp/agent123")).toBe(true);
    expect(isPublic("GET", "/api/channels/whatsapp/agent123")).toBe(true); // verify Meta
  });

  it("GESTIÓN protegida (connect / status / delete)", () => {
    expect(isPublic("POST", "/api/channels/telegram/connect")).toBe(false);
    expect(isPublic("POST", "/api/channels/whatsapp/connect")).toBe(false);
    expect(isPublic("GET", "/api/channels/agent123/status")).toBe(false);
    expect(isPublic("DELETE", "/api/channels/telegram/agent123")).toBe(false);
    expect(isPublic("DELETE", "/api/channels/whatsapp/agent123")).toBe(false);
  });

  it("no abre de más por colisiones de nombre", () => {
    expect(isPublic("GET", "/api/channels/whatsapp/status")).toBe(false);
    expect(isPublic("POST", "/api/channels/telegram/connect")).toBe(false);
  });

  it("otras públicas siguen funcionando", () => {
    expect(isPublic("POST", "/api/auth/login")).toBe(true);
    expect(isPublic("GET", "/api/auth/me")).toBe(true);
    expect(isPublic("GET", "/api/booking/slots/x")).toBe(true);
  });

  it("protegidas por defecto", () => {
    expect(isPublic("GET", "/api/agents")).toBe(false);
    expect(isPublic("POST", "/api/config")).toBe(false);
  });
});

// aa-widget-entrega-cross-origin T1 — rutas incrustables.
// Una MUESTRA por regla de EMBED_RULES. El test de recuento de abajo obliga a
// añadir muestra al añadir regla: si no, el invariante de E6 quedaría sin cubrir.
const MUESTRAS_INCRUSTABLES: Array<[string, string]> = [
  ["POST", "/api/chat"],
  ["GET", "/api/widget/config"],
  ["POST", "/api/widget/ping"],
  ["GET", "/api/booking/slots/agent123"],
  ["POST", "/api/booking/reserve"],
  ["POST", "/api/public/leads"],
];

describe("isEmbeddable — qué puede llamar una página de otro dominio", () => {
  it("las rutas del widget y del formulario son incrustables", () => {
    for (const [method, path] of MUESTRAS_INCRUSTABLES) {
      expect(isEmbeddable(method, path), `${method} ${path}`).toBe(true);
    }
  });

  it("público NO implica incrustable", () => {
    // Viajan con cookie de sesión: abrirles el origen sería el agujero de verdad.
    expect(isEmbeddable("POST", "/api/auth/login")).toBe(false);
    expect(isEmbeddable("POST", "/api/auth/logout")).toBe(false);
    expect(isEmbeddable("GET", "/api/auth/me")).toBe(false);
    // Servidor a servidor: no hay navegador, luego no hay CORS que resolver.
    expect(isEmbeddable("POST", "/api/channels/telegram/agent123")).toBe(false);
    expect(isEmbeddable("GET", "/api/cron/automations")).toBe(false);
    expect(isEmbeddable("POST", "/api/automations/abc/execute")).toBe(false);
    // Navegación del navegador, no XHR.
    expect(isEmbeddable("GET", "/api/oauth/google/callback")).toBe(false);
  });

  it("protegidas nunca son incrustables", () => {
    expect(isEmbeddable("GET", "/api/agents")).toBe(false);
    expect(isEmbeddable("POST", "/api/config")).toBe(false);
  });

  it("el método importa: GET /api/chat no es incrustable", () => {
    expect(isEmbeddable("GET", "/api/chat")).toBe(false);
    expect(isEmbeddable("POST", "/api/widget/config")).toBe(false);
  });

  // E6 — incrustable ⊂ público. Una ruta incrustable que exigiera sesión sería
  // un agujero: el navegador ajeno tendría vía libre a algo autenticado.
  it("E6 — toda ruta incrustable es también pública", () => {
    for (const [method, path] of MUESTRAS_INCRUSTABLES) {
      expect(isPublic(method, path), `${method} ${path} incrustable pero NO pública`).toBe(true);
    }
  });

  it("E6 — cada regla de EMBED_RULES tiene muestra (si no, el invariante no se comprueba)", () => {
    const cubiertas = EMBED_RULES.filter((r) =>
      MUESTRAS_INCRUSTABLES.some(([m, p]) => (r.method === "ANY" || r.method === m) && r.match(p))
    );
    expect(cubiertas.length).toBe(EMBED_RULES.length);
  });
});

describe("isServiceCall — auth de servicio CRM→AA (token estático, solo generación)", () => {
  const TOK = "secret-service-token-123";
  const hdr = (t: string) => `Bearer ${t}`;

  it("generación IA: POST permitido", () => {
    expect(isServiceCall("POST", "/api/ai/marketing-plan", hdr(TOK), TOK)).toBe(true);
    expect(isServiceCall("POST", "/api/ai/generate", hdr(TOK), TOK)).toBe(true);
    expect(isServiceCall("GET", "/api/ai/generate", hdr(TOK), TOK)).toBe(false); // ai solo POST
  });

  it("market-studies: GET/POST/PATCH permitidos (lectura + generación + iteración)", () => {
    expect(isServiceCall("GET", "/api/market-studies", hdr(TOK), TOK)).toBe(true);
    expect(isServiceCall("POST", "/api/market-studies", hdr(TOK), TOK)).toBe(true);
    expect(isServiceCall("GET", "/api/market-studies/abc", hdr(TOK), TOK)).toBe(true);
    expect(isServiceCall("POST", "/api/market-studies/abc/generate", hdr(TOK), TOK)).toBe(true);
    expect(isServiceCall("PATCH", "/api/market-studies/abc/sections/x", hdr(TOK), TOK)).toBe(true);
  });

  it("market-studies: DELETE NO permitido (sin borrado destructivo)", () => {
    expect(isServiceCall("DELETE", "/api/market-studies/abc", hdr(TOK), TOK)).toBe(false);
  });

  it("token incorrecto → false", () => {
    expect(isServiceCall("POST", "/api/ai/generate", hdr("malo"), TOK)).toBe(false);
  });

  it("token correcto pero path NO de servicio → false (no abre el resto de la API)", () => {
    expect(isServiceCall("POST", "/api/agents", hdr(TOK), TOK)).toBe(false);
    expect(isServiceCall("GET", "/api/agents", hdr(TOK), TOK)).toBe(false);
  });

  it("sin token de servicio configurado → siempre false", () => {
    expect(isServiceCall("POST", "/api/ai/generate", hdr(TOK), "")).toBe(false);
  });

  it("sin header Bearer → false", () => {
    expect(isServiceCall("POST", "/api/ai/generate", undefined, TOK)).toBe(false);
    expect(isServiceCall("POST", "/api/ai/generate", "Basic xyz", TOK)).toBe(false);
  });
});
