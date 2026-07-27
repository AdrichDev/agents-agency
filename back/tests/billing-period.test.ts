/**
 * H4 (aa-planes-y-cuotas, T3.1/T3.2) — Aritmética del periodo de facturación.
 *
 * Sin mocks: es lógica pura. Lo que se prueba aquí no son los meses fáciles, es lo que rompe la
 * facturación en silencio: los meses cortos, el salto de año, el proceso que estuvo caído, y el
 * caso que motivó guardar el día de ancla aparte (que el 31 no se degrade para siempre).
 */
import { describe, it, expect } from "vitest";
import {
  addMonthsClamped,
  nextPeriodStart,
  normalizeAnchorDay,
  resolveCurrentPeriod,
} from "@/lib/billing-period";

const utc = (s: string) => new Date(s);

describe("addMonthsClamped", () => {
  it("mes normal: mismo día del mes siguiente", () => {
    expect(addMonthsClamped(utc("2026-03-15T10:30:00.000Z"), 1, 15).toISOString()).toBe(
      "2026-04-15T10:30:00.000Z"
    );
  });

  it("conserva la hora del día (el periodo no empieza a medianoche por sorpresa)", () => {
    expect(addMonthsClamped(utc("2026-03-15T23:59:59.999Z"), 1, 15).toISOString()).toBe(
      "2026-04-15T23:59:59.999Z"
    );
  });

  it("31 de enero + 1 mes = 28 de febrero (clampa al último día del mes destino)", () => {
    expect(addMonthsClamped(utc("2026-01-31T00:00:00.000Z"), 1, 31).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z"
    );
  });

  it("año bisiesto: 31 de enero de 2028 + 1 mes = 29 de febrero", () => {
    expect(addMonthsClamped(utc("2028-01-31T00:00:00.000Z"), 1, 31).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z"
    );
  });

  it("cruza el año sin aritmética especial (diciembre + 1 = enero siguiente)", () => {
    expect(addMonthsClamped(utc("2026-12-20T08:00:00.000Z"), 1, 20).toISOString()).toBe(
      "2027-01-20T08:00:00.000Z"
    );
  });

  it("salta varios meses de golpe y cruza el año", () => {
    expect(addMonthsClamped(utc("2026-11-30T00:00:00.000Z"), 4, 30).toISOString()).toBe(
      "2027-03-30T00:00:00.000Z"
    );
  });

  // ESTE es el motivo de que `periodAnchorDay` sea una columna y no se derive de `periodStart`.
  it("el ancla NO se degrada: tras aplastar a febrero, marzo recupera el día 31", () => {
    const febrero = addMonthsClamped(utc("2026-01-31T00:00:00.000Z"), 1, 31);
    expect(febrero.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    // Partiendo del 28 de febrero pero con el ancla 31 guardada aparte.
    const marzo = addMonthsClamped(febrero, 1, 31);
    expect(marzo.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("si el ancla se derivara del inicio de periodo, el día de cobro derivaría para siempre", () => {
    // Contraprueba del test anterior: con el ancla tomada de la fecha (28) el 31 no vuelve nunca.
    const febrero = utc("2026-02-28T00:00:00.000Z");
    expect(addMonthsClamped(febrero, 1, febrero.getUTCDate()).toISOString()).toBe(
      "2026-03-28T00:00:00.000Z"
    );
  });

  it("ancla 30 en febrero: clampa a 28 y en abril da 30", () => {
    const feb = addMonthsClamped(utc("2026-01-30T00:00:00.000Z"), 1, 30);
    expect(feb.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonthsClamped(feb, 2, 30).toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });
});

describe("normalizeAnchorDay", () => {
  const start = utc("2026-03-15T00:00:00.000Z");

  it("acepta 1-31", () => {
    expect(normalizeAnchorDay(1, start)).toBe(1);
    expect(normalizeAnchorDay(31, start)).toBe(31);
  });

  it("valor corrupto cae al día del inicio de periodo, no bloquea la renovación", () => {
    // Fail-safe: un ancla inválida sólo puede mover el día de cobro. Si en vez de eso impidiera
    // renovar, el cliente se quedaría sin cuota indefinidamente por un dato mal escrito.
    expect(normalizeAnchorDay(0, start)).toBe(15);
    expect(normalizeAnchorDay(32, start)).toBe(15);
    expect(normalizeAnchorDay(-3, start)).toBe(15);
    expect(normalizeAnchorDay(7.5, start)).toBe(15);
    expect(normalizeAnchorDay(NaN, start)).toBe(15);
  });
});

describe("nextPeriodStart", () => {
  it("es un mes después, respetando el ancla", () => {
    expect(nextPeriodStart(utc("2026-01-31T00:00:00.000Z"), 31).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z"
    );
  });
});

describe("resolveCurrentPeriod", () => {
  const anchor = (periodStart: string, periodAnchorDay: number) => ({
    periodStart: utc(periodStart),
    periodAnchorDay,
  });

  it("dentro del periodo: no renueva y NO pide escritura", () => {
    const r = resolveCurrentPeriod(anchor("2026-07-10T00:00:00.000Z", 10), utc("2026-07-26T12:00:00.000Z"));
    expect(r.renewed).toBe(false);
    expect(r.periodStart.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("el instante exacto del ancla siguiente YA es periodo nuevo (borde cerrado por abajo)", () => {
    const r = resolveCurrentPeriod(anchor("2026-07-10T09:00:00.000Z", 10), utc("2026-08-10T09:00:00.000Z"));
    expect(r.renewed).toBe(true);
    expect(r.periodStart.toISOString()).toBe("2026-08-10T09:00:00.000Z");
  });

  it("un milisegundo antes del ancla sigue siendo el periodo viejo", () => {
    const r = resolveCurrentPeriod(anchor("2026-07-10T09:00:00.000Z", 10), utc("2026-08-10T08:59:59.999Z"));
    expect(r.renewed).toBe(false);
    expect(r.periodStart.toISOString()).toBe("2026-07-10T09:00:00.000Z");
  });

  it("mismo mes de calendario pero antes del día de ancla: NO renueva", () => {
    // Caso que una diferencia de meses ingenua contaría como un periodo cumplido.
    const r = resolveCurrentPeriod(anchor("2026-06-20T00:00:00.000Z", 20), utc("2026-07-05T00:00:00.000Z"));
    expect(r.renewed).toBe(false);
    expect(r.periodStart.toISOString()).toBe("2026-06-20T00:00:00.000Z");
  });

  it("proceso caído tres meses: salta al periodo VIGENTE, no al siguiente", () => {
    // Si renovara "un mes" acumulando, el cliente arrastraría periodos vencidos y su cuota
    // seguiría siendo la de abril durante los tres meses siguientes.
    const r = resolveCurrentPeriod(anchor("2026-04-05T00:00:00.000Z", 5), utc("2026-07-20T00:00:00.000Z"));
    expect(r.renewed).toBe(true);
    expect(r.periodStart.toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });

  it("hueco de más de un año: salta correctamente", () => {
    const r = resolveCurrentPeriod(anchor("2025-01-15T00:00:00.000Z", 15), utc("2026-07-20T00:00:00.000Z"));
    expect(r.renewed).toBe(true);
    expect(r.periodStart.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("ancla 31 con meses cortos por medio: el periodo vigente vuelve al 31", () => {
    const r = resolveCurrentPeriod(anchor("2026-01-31T00:00:00.000Z", 31), utc("2026-04-02T00:00:00.000Z"));
    expect(r.renewed).toBe(true);
    expect(r.periodStart.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("ancla 31 dentro de febrero: el periodo vigente es el que empezó el 31 de enero", () => {
    const r = resolveCurrentPeriod(anchor("2026-01-31T00:00:00.000Z", 31), utc("2026-02-15T00:00:00.000Z"));
    expect(r.renewed).toBe(false);
    expect(r.periodStart.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("es idempotente: resolver el resultado otra vez no vuelve a renovar", () => {
    const first = resolveCurrentPeriod(anchor("2026-04-05T00:00:00.000Z", 5), utc("2026-07-20T00:00:00.000Z"));
    const second = resolveCurrentPeriod(
      { periodStart: first.periodStart, periodAnchorDay: 5 },
      utc("2026-07-20T00:00:00.000Z")
    );
    expect(second.renewed).toBe(false);
    expect(second.periodStart.toISOString()).toBe(first.periodStart.toISOString());
  });

  it("reloj por detrás del inicio de periodo: no renueva ni retrocede el ancla", () => {
    // Defensivo. Un `now` anterior al periodo sólo puede venir de un reloj mal puesto; la
    // respuesta correcta es no tocar nada, nunca mover el periodo hacia atrás.
    const r = resolveCurrentPeriod(anchor("2026-07-10T00:00:00.000Z", 10), utc("2026-06-01T00:00:00.000Z"));
    expect(r.renewed).toBe(false);
    expect(r.periodStart.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });
});
