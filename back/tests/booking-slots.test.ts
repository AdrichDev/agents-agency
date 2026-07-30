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
import { formatScheduleHuman, generateSlots } from "@/lib/booking/slots";

const TZ = "Europe/Madrid";
// Lunes 3 de agosto de 2026, 00:00 en Madrid.
const LUNES = new Date("2026-08-03T00:00:00+02:00");
const MARTES = new Date("2026-08-04T00:00:00+02:00");

// `generateSlots` no ofrece huecos anteriores al instante presente, y por defecto ese instante
// es el reloj real. Los fixtures viven en agosto de 2026: sin fijar el "ahora" la suite entera
// caducaria sola al pasar esa fecha. Se le da un presente anterior a los fixtures.
const AHORA = new Date("2026-07-01T00:00:00+02:00");
type ArgsSlots = Parameters<typeof generateSlots>;
const genSlots = (...a: ArgsSlots) =>
  generateSlots(a[0], a[1], a[2], a[3], a[4], a[5], a[6] ?? 30, a[7] ?? AHORA);

describe("generateSlots — clave del dia", () => {
  it("genera huecos con las claves cortas que escribe el producto (mon/tue/...)", () => {
    const slots = genSlots(LUNES, MARTES, 30, { mon: "09:00-11:00" }, TZ, []);
    expect(slots).toHaveLength(4);
    expect(slots[0].startTime).toContain("2026-08-03T09:00");
    expect(slots[3].endTime).toContain("2026-08-03T11:00");
  });

  it("sigue aceptando la clave larga en ingles", () => {
    const slots = genSlots(LUNES, MARTES, 30, { monday: "09:00-11:00" }, TZ, []);
    expect(slots).toHaveLength(4);
  });

  it("es indiferente a mayusculas y espacios en la clave", () => {
    const slots = genSlots(LUNES, MARTES, 30, { " MON ": "09:00-10:00" }, TZ, []);
    expect(slots).toHaveLength(2);
  });

  it("un dia sin horario configurado no produce huecos", () => {
    // El horario solo cubre el lunes; se pide el martes.
    const miercoles = new Date("2026-08-05T00:00:00+02:00");
    expect(genSlots(MARTES, miercoles, 30, { mon: "09:00-18:00" }, TZ, [])).toHaveLength(0);
  });

  it("respeta el descanso partido con |", () => {
    // La rejilla avanza en pasos fijos de 30 min (no de `duration`), asi que se comprueba
    // el hueco del descanso, no un recuento exacto.
    const horas = genSlots(LUNES, MARTES, 60, { mon: "09:00-11:00|16:00-18:00" }, TZ, []).map(
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
    const slots = genSlots(desde, MARTES, 30, { mon: "09:00-18:00" }, TZ, []);

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
    expect(genSlots(LUNES, MARTES, 30, { mon: "09:00-18:00" }, TZ, blocked)).toHaveLength(0);
  });
});

/**
 * Turno legible del servicio (`formatScheduleHuman`).
 *
 * Fallo REAL medido contra los agentes mock en produccion: ante "mesa para las 21:00" el
 * modelo llamaba a `consultar_disponibilidad` con el servicio "Comida" y respondia "no hay
 * disponibilidad", con la cena entera libre. `listar_servicios` solo devolvia nombre y
 * duracion: nada le decia que turno cubre cada servicio.
 */
describe("formatScheduleHuman", () => {
  it("agrupa los dias consecutivos con el mismo turno", () => {
    const cena = {
      mon: "20:00-22:45", tue: "20:00-22:45", wed: "20:00-22:45",
      thu: "20:00-22:45", fri: "20:00-22:45", sat: "20:00-22:45",
    };
    expect(formatScheduleHuman(cena)).toBe("L-S 20:00-22:45");
  });

  it("separa el dia con horario distinto en su propio tramo", () => {
    const comida = {
      mon: "13:30-15:45", tue: "13:30-15:45", wed: "13:30-15:45",
      thu: "13:30-15:45", fri: "13:30-15:45", sat: "13:30-15:45",
      sun: "13:30-16:00",
    };
    expect(formatScheduleHuman(comida)).toBe("L-S 13:30-15:45, D 13:30-16:00");
  });

  it("omite los dias cerrados y no los fusiona a traves del hueco", () => {
    // Miercoles cerrado: "L-M" y "J-V" son dos tramos, nunca "L-V".
    expect(formatScheduleHuman({ mon: "09:00-14:00", tue: "09:00-14:00", thu: "09:00-14:00", fri: "09:00-14:00" }))
      .toBe("L-M 09:00-14:00, J-V 09:00-14:00");
  });

  it("expone los dos turnos de un mismo dia", () => {
    expect(formatScheduleHuman({ sat: "13:00-16:30|19:30-23:30" })).toBe("S 13:00-16:30 y 19:30-23:30");
  });

  it("devuelve cadena vacia si no hay horario configurado", () => {
    expect(formatScheduleHuman({})).toBe("");
  });
});

/**
 * T4 (aa-reservas-fecha-y-zona-del-modelo): suelo del presente.
 *
 * El filtro previo comparaba contra el inicio del rango PEDIDO, no contra ahora. Sin ancla de
 * fecha en el prompt, el modelo pidio en produccion disponibilidad para agosto de 2023 y la
 * herramienta le devolvio huecos tan ricamente: horas que nadie puede reservar, ofrecidas a un
 * cliente real.
 */
describe("generateSlots — suelo del presente (AC5)", () => {
  it("no ofrece huecos de un año pasado (AC5)", () => {
    const desde = new Date("2023-08-07T00:00:00+02:00");
    const hasta = new Date("2023-08-08T00:00:00+02:00");
    const slots = generateSlots(desde, hasta, 120, { mon: "20:00-22:45" }, TZ, [], 15, AHORA);
    expect(slots).toHaveLength(0);
  });

  it("sigue ofreciendo los huecos futuros del mismo rango", () => {
    const slots = generateSlots(LUNES, MARTES, 120, { mon: "20:00-22:45" }, TZ, [], 15, AHORA);
    expect(slots.map((s) => s.startTime.slice(11, 16))).toEqual([
      "20:00",
      "20:15",
      "20:30",
      "20:45",
    ]);
  });

  it("corta por el presente cuando el rango pedido ya ha empezado", () => {
    // El lunes a las 10:30: los huecos de las 09:00 y 10:00 ya han pasado.
    const ahora = new Date("2026-08-03T10:30:00+02:00");
    const slots = generateSlots(LUNES, MARTES, 60, { mon: "09:00-13:00" }, TZ, [], 60, ahora);
    expect(slots.map((s) => s.startTime.slice(11, 16))).toEqual(["11:00", "12:00"]);
  });
});
