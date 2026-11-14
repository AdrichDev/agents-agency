/**
 * Mensajes por defecto de zod en español. Los campos sin mensaje propio devolvían el texto
 * genérico de zod 4 en inglés ("Invalid input: expected string, received undefined"), y ese
 * texto llega al usuario a través de `.flatten()` (p. ej. el formulario de crear agente).
 * `@/lib/zod-locale` configura el locale `es` de zod una sola vez al arrancar el back.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import "@/lib/zod-locale";

const firstMessage = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("se esperaba un error de validación");
  return result.error.issues[0].message;
};

describe("zod-locale: mensajes por defecto en español", () => {
  it("campo obligatorio ausente", () => {
    expect(firstMessage(z.object({ name: z.string() }), {})).toBe(
      "Entrada inválida: se esperaba texto, recibido indefinido"
    );
  });

  it("límite de longitud", () => {
    expect(firstMessage(z.string().max(3), "abcdef")).toBe(
      "Demasiado grande: se esperaba que texto tuviera <=3 caracteres"
    );
  });

  it("clave no permitida en un objeto estricto", () => {
    expect(firstMessage(z.object({ a: z.string() }).strict(), { a: "x", b: 1 })).toBe(
      'Llave desconocida: "b"'
    );
  });

  it("un mensaje propio sigue teniendo prioridad sobre el locale", () => {
    expect(firstMessage(z.string().min(1, "Indica tu nombre"), "")).toBe("Indica tu nombre");
  });
});
