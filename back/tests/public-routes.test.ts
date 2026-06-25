import { describe, it, expect } from "vitest";
import { isPublic, isServiceCall } from "@/lib/public-routes";

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

describe("isServiceCall — auth de servicio CRM→AA (token estático, solo generación)", () => {
  const TOK = "secret-service-token-123";
  const hdr = (t: string) => `Bearer ${t}`;

  it("token correcto + path de generación → true", () => {
    expect(isServiceCall("POST", "/api/ai/marketing-plan", hdr(TOK), TOK)).toBe(true);
    expect(isServiceCall("POST", "/api/ai/generate", hdr(TOK), TOK)).toBe(true);
    expect(isServiceCall("POST", "/api/market-studies", hdr(TOK), TOK)).toBe(true);
  });

  it("token incorrecto → false", () => {
    expect(isServiceCall("POST", "/api/ai/generate", hdr("malo"), TOK)).toBe(false);
  });

  it("token correcto pero path NO de servicio → false (no abre el resto de la API)", () => {
    expect(isServiceCall("POST", "/api/agents", hdr(TOK), TOK)).toBe(false);
    expect(isServiceCall("GET", "/api/market-studies", hdr(TOK), TOK)).toBe(false); // método
    expect(isServiceCall("POST", "/api/market-studies/123/generate", hdr(TOK), TOK)).toBe(false);
  });

  it("sin token de servicio configurado → siempre false", () => {
    expect(isServiceCall("POST", "/api/ai/generate", hdr(TOK), "")).toBe(false);
  });

  it("sin header Bearer → false", () => {
    expect(isServiceCall("POST", "/api/ai/generate", undefined, TOK)).toBe(false);
    expect(isServiceCall("POST", "/api/ai/generate", "Basic xyz", TOK)).toBe(false);
  });
});
