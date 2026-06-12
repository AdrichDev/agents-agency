/**
 * Fuente única de verdad para el mapeo service → proveedor OAuth (R6-1, AD4).
 *
 * SERVICE_TO_PROVIDER: clave de servicio del catálogo SERVICES → provider físico en DB.
 * LOGICAL_TO_PHYSICAL: clave lógica usada en tools.ts/executor.ts → provider físico en DB.
 *
 * CRÍTICO: NO renombrar las claves lógicas (gmail, calendar) — tools.ts y executor.ts
 * dependen de ellas. La fila de Integration usa siempre el provider físico (google, slack...).
 */

/** Mapeo service del catálogo → proveedor OAuth físico en la DB */
export const SERVICE_TO_PROVIDER: Record<string, string> = {
  google_calendar: "google",
  gmail: "google",
  slack: "slack",
  notion: "notion",
  jira: "jira",
  instagram: "instagram",
};

/**
 * Mapeo proveedor lógico (usado en TOOLS_BY_PROVIDER / executor.ts)
 * → proveedor físico almacenado en Integration.provider.
 *
 * "gmail" y "calendar" son claves lógicas; en DB la fila es provider="google".
 */
export const LOGICAL_TO_PHYSICAL: Record<string, string> = {
  gmail: "google",
  calendar: "google",
  slack: "slack",
  notion: "notion",
  jira: "jira",
};

/** Proveedores conectables en la fase inicial */
export const CONNECTABLE_PROVIDERS = ["google", "slack", "notion"] as const;

/** Proveedores de fase posterior ("Próximamente") */
export const UPCOMING_PROVIDERS = ["jira", "instagram"] as const;

/** Dado un proveedor lógico devuelve el provider físico (o el mismo si no hay mapeo) */
export function toPhysicalProvider(logical: string): string {
  return LOGICAL_TO_PHYSICAL[logical] ?? logical;
}
