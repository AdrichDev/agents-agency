import { describe, expect, it } from "vitest";
import { base64ImageSchema } from "@/lib/schemas";

// Regresión XSS-001: base64ImageSchema solo validaba longitud, no formato —
// un string tipo "javascript:alert(1)" pasaba el schema y quedaba a salvo
// solo por el noop de avatarAction() (protección implícita, no de contrato).
describe("base64ImageSchema", () => {
  it("acepta un data URL de imagen", () => {
    expect(base64ImageSchema.safeParse("data:image/png;base64,AAAA").success).toBe(true);
  });

  it("acepta '' (señal de limpiar avatar)", () => {
    expect(base64ImageSchema.safeParse("").success).toBe(true);
  });

  it("rechaza un protocolo javascript: inyectado", () => {
    expect(base64ImageSchema.safeParse("javascript:alert(1)").success).toBe(false);
  });

  it("rechaza una URL https plana (no es un data URL)", () => {
    expect(base64ImageSchema.safeParse("https://evil.example/x.png").success).toBe(false);
  });

  it("rechaza base64 pelado sin prefijo data:image/", () => {
    expect(base64ImageSchema.safeParse("AAAA").success).toBe(false);
  });
});
