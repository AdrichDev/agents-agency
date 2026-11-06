/**
 * Fechas derivadas del RELOJ para los tests que dependen de "ahora".
 *
 * POR QUE EXISTE: dos piezas del producto comparan contra el instante presente, y las dos
 * estan bien:
 *
 *  - `generateSlots` no ofrece huecos del pasado (aa-reservas-fecha-y-zona-del-modelo, AC5:
 *    "no ofrece huecos de un año pasado"). Es la correccion del fallo real en produccion, no
 *    un detalle: `GET /slots` y `POST /reserve` pasan por ahi.
 *  - `checkClientBalance` renueva el periodo de facturacion de forma PEREZOSA cuando vence
 *    (aa-planes-y-cuotas, T3.2), y el consumo contra el que compara vuelve a cero.
 *
 * Por eso una fecha cableada no describe un escenario: caduca. Las suites de reservas fijaban
 * el 2026-08-04 y las de cupo el 2026-07-27 (el dia en que se escribieron). Meses despues las
 * primeras piden horas que ya pasaron —"no hay hueco"— y las segundas se encuentran el
 * contador del periodo renovado a cero —"no corta". Los dos sintomas parecen regresiones del
 * codigo y son datos de test que se quedaron atras. Toda fecha que dependa de "ahora" se
 * deriva aqui.
 */
import { DateTime } from "luxon";

/** Zona del negocio que declaran los dobles de reservas. */
export const ZONA_NEGOCIO = "Europe/Madrid";

/**
 * Proximo martes del calendario del negocio, con al menos una semana de margen.
 *
 * Los dobles de reservas solo abren los martes (`tue: "13:00-23:00"`), y ese dia es parte del
 * escenario. El margen de una semana evita ademas que la suite caiga en un martes cuyo horario
 * ya paso hoy, y que el borde del dia se cruce mientras corre.
 */
export function proximoMartes(now: Date = new Date()): string {
  let dia = DateTime.fromJSDate(now, { zone: ZONA_NEGOCIO }).startOf("day").plus({ days: 7 });
  // luxon: 1 = lunes ... 7 = domingo.
  while (dia.weekday !== 2) dia = dia.plus({ days: 1 });
  return dia.toISODate()!;
}

/**
 * Instante UTC de una hora local del negocio: `("2026-08-04", "21:00")` son las 21:00 en
 * Madrid, que en verano son las 19:00Z y en invierno las 20:00Z. Se deriva en vez de escribirse
 * en UTC para que el escenario no dependa del horario de verano.
 */
export function enZonaNegocio(dia: string, hhmm: string): Date {
  const instante = DateTime.fromISO(`${dia}T${hhmm}:00`, { zone: ZONA_NEGOCIO });
  if (!instante.isValid) throw new Error(`Hora invalida para el doble de reservas: ${dia} ${hhmm}`);
  return instante.toJSDate();
}

/**
 * Inicio del periodo de facturacion VIGENTE: hoy a las 00:00 UTC.
 *
 * `resolveCurrentPeriod` solo renueva cuando el ancla ha pasado de mes, asi que este valor
 * describe "el tenant esta dentro de su periodo" cualquier dia del año, con el ancla del dia
 * de hoy. Un `periodStart` fijo de otro mes hace que el gate renueve y ponga el consumo a cero
 * justo antes de compararlo, y entonces "agotado" deja de cortar.
 */
export function inicioPeriodoVigente(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Dia de ancla que corresponde a `inicioPeriodoVigente`: el del dia de hoy. */
export function anclaPeriodoVigente(now: Date = new Date()): number {
  return inicioPeriodoVigente(now).getUTCDate();
}
