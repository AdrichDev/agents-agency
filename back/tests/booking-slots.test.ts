/**
 * Generacion de huecos (aa-reservas-validadas-y-cobertura-scraping, bloque D).
 *
 * Fallo REAL que motiva estos tests: el agente no conseguia reservar NINGUNA cita por el
 * camino correcto. `computeAvailableSlots` devolvia 0 huecos para todos los agentes porque
 * `getScheduleForDay` buscaba la clave del dia como `"monday"` (`toFormat("EEEE")`) cuando
 * el horario se persiste como `{ mon: "09:00-18:00" }`. Medido en produccion: 0 huecos con
 * horario L-V 09:00-18:00 y cero bloqueos.
 *
 * La suite anterior no lo detectaba porque sus fixtures usaban la clave larga que esperaba
 * el codigo, no la que escribe el producto.
 */
import { describe, it, expect } from "vitest";
import { generateSlots } from "@/lib/booking/slots";

const TZ = "Europe/Madrid";
// Lunes 3 de agosto de 2026, 00:00 en Madrid.
const LUNES = new Date("2026-08-03T00:00:00+02:00");
const MARTES = new Date("2026-08-04T00:00:00+02:00");

describe("generateSlots — clave del dia", () => {
  it("genera huecos con las claves cortas que escribe el producto (mon/tue/...)", () => {
    const slots = generateSlots(LUNES, MARTES, 30, { mon: "09:00-11:00" }, TZ, []);
    expect(slots).toHaveLength(4);
    expect(slots[0].startTime).toContain("2026-08-03T09:00");
    expect(slots[3].endTime).toContain("2026-08-03T11:00");
  });

  it("sigue aceptando la clave larga en ingles", () => {
    const slots = generateSlots(LUNES, MARTES, 30, { monday: "09:00-11:00" }, TZ, []);
    expect(slots).toHaveLength(4);
  });

  it("es indiferente a mayusculas y espacios en la clave", () => {
    const slots = generateSlots(LUNES, MARTES, 30, { " MON ": "09:00-10:00" }, TZ, []);
    expect(slots).toHaveLength(2);
  });

  it("un dia sin horario configurado no produce huecos", () => {
    // El horario solo cubre el lunes; se pide el martes.
    const miercoles = new Date("2026-08-05T00:00:00+02:00");
    expect(generateSlots(MARTES, miercoles, 30, { mon: "09:00-18:00" }, TZ, [])).toHaveLength(0);
  });

  it("respeta el descanso partido con |", () => {
    // La rejilla avanza en pasos fijos de 30 min (no de `duration`), asi que se comprueba
    // el hueco del descanso, no un recuento exacto.
    const horas = generateSlots(LUNES, MARTES, 60, { mon: "09:00-11:00|16:00-18:00" }, TZ, []).map(
      (s) => s.startTime.slice(11, 16)
    );
    expect(horas[0]).toBe("09:00");
    expect(horas).toContain("16:00");
    expect(horas.some((h) => h >= "11:00" && h < "16:00")).toBe(false);
  });
});

describe("generateSlots — huecos pasados", () => {
  it("no ofrece huecos anteriores al inicio del rango", () => {
    // Consulta hecha el lunes a las 15:30: las 09:00 de ESE lunes ya han pasado. El barrido
    // arranca en startOf("day"), asi que sin filtro se ofrecian huecos imposibles de servir.
    const desde = new Date("2026-08-03T15:30:00+02:00");
    const slots = generateSlots(desde, MARTES, 30, { mon: "09:00-18:00" }, TZ, []);

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => new Date(s.startTime) >= desde)).toBe(true);
    // 15:30 cae justo en la rejilla, asi que es el primer hueco servible.
    expect(slots[0].startTime).toContain("T15:30");
  });
});

describe("generateSlots — bloqueos", () => {
  it("descarta los dias bloqueados", () => {
    const blocked = [
      { startDate: new Date("2026-08-03T00:00:00+02:00"), endDate: new Date("2026-08-03T23:59:00+02:00") },
    ];
    expect(generateSlots(LUNES, MARTES, 30, { mon: "09:00-18:00" }, TZ, blocked)).toHaveLength(0);
  });
});
