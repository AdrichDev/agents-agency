/**
 * H7 (aa-cupo-defecto-y-avisos, T3.2) — Umbrales de aviso: 75%, 90% y corte al 100%.
 *
 * Qué cierra: el corte era binario y silencioso. Se pasaba de "todo bien" a 402 sin ningún aviso
 * intermedio, y el que se comía el silencio no era el cliente sino el cliente final del cliente, un
 * desconocido que estaba preguntando un precio.
 *
 * El invariante que vigila este fichero es la coherencia con el gate: el aviso usa `>=`, igual que
 * `tokensUsedPeriod >= limit`. Con `>` para avisar y `>=` para cortar existiría un consumo exacto en el
 * que el agente está cortado y el panel dice "ok", y un número que contradice a la máquina es peor que
 * ningún número.
 */
import { describe, it, expect } from "vitest";
import { quotaWarningLevel, DEFAULT_TOKEN_QUOTA_PER_AGENT } from "@/lib/quota";

describe("T3 — AC8: umbrales exactos", () => {
  const CUPO = 1_000;

  it.each([
    [0, "ok"],
    [1, "ok"],
    [749, "ok"],
    [750, "warn75"],
    [899, "warn75"],
    [900, "warn90"],
    [999, "warn90"],
    [1_000, "exhausted"],
    [1_500, "exhausted"],
  ])("consumo %i sobre 1.000 ⇒ %s", (used, esperado) => {
    expect(quotaWarningLevel(used, CUPO)).toBe(esperado);
  });

  it("los umbrales son inclusivos: el 75%% y el 90%% exactos ya avisan", () => {
    expect(quotaWarningLevel(75, 100)).toBe("warn75");
    expect(quotaWarningLevel(90, 100)).toBe("warn90");
  });
});

describe("T3 — AC9: casos que no son un porcentaje", () => {
  it("sin tope (`null`) es `ok`: la pregunta no aplica", () => {
    expect(quotaWarningLevel(0, null)).toBe("ok");
    expect(quotaWarningLevel(50_000_000, null)).toBe("ok");
  });

  it("cupo 0 es `exhausted` sin dividir: es un bloqueo, no un 0/0", () => {
    expect(quotaWarningLevel(0, 0)).toBe("exhausted");
    expect(quotaWarningLevel(123, 0)).toBe("exhausted");
  });

  it("cupo negativo (override mal puesto) tampoco produce NaN ni Infinity", () => {
    expect(quotaWarningLevel(0, -5)).toBe("exhausted");
  });
});

describe("T3 — AC10: el aviso no puede contradecir al corte", () => {
  /** Réplica exacta de la comparación del gate (`token-metering.ts`). */
  const gateCorta = (used: number, limit: number | null) => limit !== null && used >= limit;

  it("no existe un consumo en el que el gate corte y el aviso diga otra cosa que `exhausted`", () => {
    const cupos = [1, 2, 3, 100, 1_000, DEFAULT_TOKEN_QUOTA_PER_AGENT];
    for (const limit of cupos) {
      for (const used of [limit - 1, limit, limit + 1]) {
        if (gateCorta(used, limit)) {
          expect(quotaWarningLevel(used, limit)).toBe("exhausted");
        } else {
          expect(quotaWarningLevel(used, limit)).not.toBe("exhausted");
        }
      }
    }
  });

  it("con el defecto de 10M los avisos caen donde se prometió", () => {
    const L = DEFAULT_TOKEN_QUOTA_PER_AGENT;
    expect(quotaWarningLevel(7_499_999, L)).toBe("ok");
    expect(quotaWarningLevel(7_500_000, L)).toBe("warn75");
    expect(quotaWarningLevel(9_000_000, L)).toBe("warn90");
    expect(quotaWarningLevel(10_000_000, L)).toBe("exhausted");
  });
});
