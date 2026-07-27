/**
 * H4 (aa-planes-y-cuotas, T3) — Aritmética del periodo de facturación.
 *
 * Vive aparte de `token-metering.ts` a propósito: es lógica pura, sin base de datos, y es donde
 * están los casos difíciles (meses cortos, saltos de año, un proceso que estuvo caído varios
 * meses). Separada se prueba sin mocks de Prisma; dentro del metering habría que montar la BD
 * para verificar un cálculo de fechas.
 *
 * Periodo mensual. No se parametriza la duración todavía: hacerlo sin un `Plan` que la defina
 * sería inventar una dimensión que nadie configura (T4 es quien traerá el plan).
 */

/** Duración del periodo, en meses. */
export const PERIOD_MONTHS = 1;

/**
 * Día de ancla válido (1-31). Si el valor guardado es basura, se cae al día del inicio de
 * periodo, que siempre existe. Fail-safe deliberado: un ancla corrupta no debe impedir renovar
 * —eso dejaría al cliente sin cuota indefinidamente—, sólo mover el día de cobro.
 */
export function normalizeAnchorDay(anchorDay: number, periodStart: Date): number {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    return periodStart.getUTCDate();
  }
  return anchorDay;
}

/**
 * Suma `months` meses a `base` respetando el día de ancla y clampando a la longitud del mes
 * destino (31 de enero + 1 mes = 28/29 de febrero).
 *
 * Clave: el ancla NO se toma de `base`, se pasa aparte. Por eso el clampado de febrero no se
 * hereda: marzo vuelve a 31. Si el ancla se derivara de `base`, cada mes corto degradaría el día
 * de cobro para siempre.
 *
 * Todo en UTC. La hora del día se conserva.
 */
export function addMonthsClamped(base: Date, months: number, anchorDay: number): Date {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + months;
  // Día 0 del mes siguiente = último día del mes destino. `Date.UTC` normaliza el desbordamiento
  // de mes (13 → enero del año siguiente), así que no hace falta aritmética de años.
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(anchorDay, lastDayOfMonth),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds()
    )
  );
}

/** Inicio del periodo siguiente al que arranca en `periodStart`. */
export function nextPeriodStart(periodStart: Date, anchorDay: number): Date {
  return addMonthsClamped(periodStart, PERIOD_MONTHS, normalizeAnchorDay(anchorDay, periodStart));
}

/**
 * Decide si el periodo venció y devuelve el inicio del periodo VIGENTE en `now`.
 *
 * `renewed = false` significa que no hay nada que escribir en la base de datos: el caso normal,
 * y el que no debe costar una escritura. Sólo cuando vence se paga un UPDATE, una vez por
 * periodo y por tenant.
 *
 * Salta directo al periodo correcto en lugar de avanzar mes a mes. Importa para un proceso que
 * estuvo caído: con 3 meses sin tráfico, el periodo vigente es el tercero, no el primero, y
 * "renovar tres veces" daría el mismo resultado por un camino más frágil. Las dos correcciones
 * acotadas de abajo compensan el desfase de la estimación por meses de calendario (a lo sumo una
 * iteración cada una).
 */
export function resolveCurrentPeriod(
  current: { periodStart: Date; periodAnchorDay: number },
  now: Date
): { periodStart: Date; renewed: boolean } {
  const start = current.periodStart;
  const anchor = normalizeAnchorDay(current.periodAnchorDay, start);

  // Estimación por diferencia de meses de calendario. Puede pasarse por uno (si aún no se
  // alcanzó el día de ancla de este mes) o quedarse corta por el clampado.
  let periods = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  periods = Math.max(0, Math.floor(periods / PERIOD_MONTHS));

  while (periods > 0 && addMonthsClamped(start, periods * PERIOD_MONTHS, anchor).getTime() > now.getTime()) {
    periods -= 1;
  }
  while (addMonthsClamped(start, (periods + 1) * PERIOD_MONTHS, anchor).getTime() <= now.getTime()) {
    periods += 1;
  }

  if (periods === 0) return { periodStart: start, renewed: false };
  return { periodStart: addMonthsClamped(start, periods * PERIOD_MONTHS, anchor), renewed: true };
}
