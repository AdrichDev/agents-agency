/**
 * Datos del EMISOR de presupuestos y facturas de 3A Estudio (S18,
 * odd/tasks/mcp-plataforma-read-surface, L30).
 *
 * Vive en el SERVIDOR porque el operador (`agencia_crear_factura`) no tiene el
 * formulario del panel: allí el navegador guarda su propio snapshot en
 * localStorage y lo manda en el body de POST /api/budgets. Ese camino NO cambia
 * (passthrough puro, el servidor no mezcla nada); este módulo alimenta sólo el
 * camino del operador, que hasta ahora escribía `issuerSnapshot: {}`.
 *
 * Cada campo se puede sobreescribir por entorno (`ISSUER_*`). Un valor ausente,
 * vacío o en blanco cae al defecto: configurar una variable a "" no puede dejar
 * una factura sin emisor.
 *
 * El CIF por defecto es INVENTADO (decisión explícita del dueño tras el aviso de
 * validez legal): no identifica a ninguna sociedad registrada. Por eso se puede
 * sustituir por el real con `ISSUER_CIF` sin tocar código.
 */

/** Snapshot del emisor con las MISMAS cinco claves que lee el front. */
export interface IssuerSnapshot {
  company: string;
  cif: string;
  address: string;
  email: string;
  phone: string;
}

/**
 * Cabecera por defecto de presupuestos y facturas. Se pinta en
 * BudgetPreview/InvoicePreview y en el pie ("Emitido por {company || 'ADRICH'}").
 */
export const ISSUER_DEFAULTS: Readonly<IssuerSnapshot> = {
  company: "Adrich Digital S.L.",
  // Inventado a propósito (ver cabecera): sintácticamente válido, no registrado.
  cif: "B87451239",
  address: "Calle Aquiles 25, Madrid",
  email: "achozas9@gmail.com",
  phone: "635984010",
};

/** Variable de entorno que sobreescribe cada campo, por nombre de clave. */
const ISSUER_ENV: Record<keyof IssuerSnapshot, string> = {
  company: "ISSUER_COMPANY",
  cif: "ISSUER_CIF",
  address: "ISSUER_ADDRESS",
  email: "ISSUER_EMAIL",
  phone: "ISSUER_PHONE",
};

/**
 * Snapshot del emisor listo para persistir: defectos del dueño con la
 * sobreescritura de entorno campo a campo. Se recorta el espacio en blanco de
 * los extremos (un valor así viaja a un documento legal) y un valor vacío o en
 * blanco no sobreescribe nada.
 *
 * Recibe el entorno por parámetro para poder probarlo sin tocar `process.env`;
 * en producción se llama sin argumentos.
 */
export function issuerSnapshot(
  env: Record<string, string | undefined> = process.env
): IssuerSnapshot {
  const claves = Object.keys(ISSUER_DEFAULTS) as Array<keyof IssuerSnapshot>;
  const snapshot = {} as IssuerSnapshot;

  for (const clave of claves) {
    const valor = env[ISSUER_ENV[clave]];
    const limpio = typeof valor === "string" ? valor.trim() : "";
    snapshot[clave] = limpio === "" ? ISSUER_DEFAULTS[clave] : limpio;
  }

  return snapshot;
}
