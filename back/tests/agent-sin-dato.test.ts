/**
 * T1.1 de `aa-agente-no-inventa-datos-ni-politicas` (convertida a ODD): cuando la búsqueda de
 * conocimiento no devuelve nada, el hueco se dice en voz alta.
 *
 * El caso real (Brasserie Lafayette, fila H4): preguntaron a qué hora cierra la cocina, la
 * búsqueda no trajo nada y el modelo reutilizó la ventana de reservas ("13:30 a 15:45")
 * presentándola como cierre de cocina, con cita a una página que no lo dice. El bloque de
 * conocimiento se descartaba cuando venía vacío: el modelo no sabía que no sabía.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/openai", () => {
  const create = vi.fn();
  return {
    openai: { chat: { completions: { create } } },
    getClientForAgent: vi.fn(async () => ({ client: { chat: { completions: { create } } }, isOpenclaw: false })),
    DEFAULT_MODEL: "gpt-4.1-nano",
    STRONG_MODEL: "gpt-5.4",
    refreshModelConfig: vi.fn(),
  };
});

import { buildKnowledgeBlock } from "@/lib/agent/engine";

describe("buildKnowledgeBlock — la ausencia de dato se declara", () => {
  it("sin fragmentos devuelve un bloque que dice explícitamente que no hay dato", () => {
    const block = buildKnowledgeBlock([]);
    expect(block).toBeTypeOf("string");
    expect(block).toMatch(/NINGÚN fragmento relevante/i);
    // Las tres prohibiciones que el modelo tiene que leer, no solo "no inventes" genérico.
    expect(block).toMatch(/no lo deduzcas/i);
    expect(block).toMatch(/horarios, precios, políticas/i);
    // Y una salida humana, que es lo que el visitante necesita cuando no hay dato.
    expect(block).toMatch(/persona del equipo/i);
  });

  it("con fragmentos NO aparece la frase de ausencia (no se paga ese texto)", () => {
    const block = buildKnowledgeBlock([
      { source: "https://negocio.example/contacto", content: "HORARIO DE RESERVAS: L-S 13:30-15:45" },
    ]);
    expect(block).not.toMatch(/NINGÚN fragmento relevante/i);
    expect(block).toMatch(/fuente: https:\/\/negocio\.example\/contacto/);
  });

  it("el bloque vacío no arrastra el nonce de contenido no confiable (es texto nuestro)", () => {
    const block = buildKnowledgeBlock([]);
    expect(block).not.toMatch(/\[\[/);
  });
});
