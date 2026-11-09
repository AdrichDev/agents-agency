/**
 * S5 (responses-api-migration, T2) — el selector de modelos ya no ofrece un modelo retirado.
 *
 * OpenAI retiró `gpt-4.1-nano` (404 en la API), así que quien lo eligiera en el panel del agente se
 * llevaría un agente que nunca contesta. Estructural, sin `page.goto`: lo que se comprueba es el
 * catálogo que consume el selector (`front/lib/models.ts`), no el píxel.
 */
import { test, expect } from "@playwright/test";
import { LLM_PROVIDERS, defaultEffortFor, findModel } from "../lib/models";

test.describe("T2/S5 — catálogo del front", () => {
  test("gpt-4.1-nano ya no está en el selector", () => {
    const ids = LLM_PROVIDERS.flatMap((p) => p.models.map((m) => m.id));

    expect(ids).not.toContain("gpt-4.1-nano");
    expect(findModel("gpt-4.1-nano")).toBeUndefined();
  });

  test("los modelos que el back sigue sirviendo siguen ofreciéndose", () => {
    const ids = LLM_PROVIDERS.flatMap((p) => p.models.map((m) => m.id));

    for (const id of ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "gpt-5.4-mini"]) {
      expect(ids, `${id} desapareció del selector`).toContain(id);
    }
  });

  test("luna arranca en `low`, igual que en el back", () => {
    expect(defaultEffortFor("gpt-5.6-luna")).toBe("low");
  });
});
