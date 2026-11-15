/**
 * Cálculo server-side de totales de presupuesto.
 * Los totales NUNCA se confían al cliente: se computan a partir de las líneas.
 *
 * S17 (odd/tasks/mcp-plataforma-read-surface): aquí vive también el builder de datos
 * del alta de presupuesto y la numeración visible (AD-<año>-NNN), porque los dos
 * caminos que crean presupuestos —el panel (POST /api/budgets) y el operador
 * (agencia_crear_factura)— tienen que construir EXACTAMENTE la misma fila.
 */

export interface BudgetLineInput {
  quantity?: number;
  implPrice?: number;
  maintPrice?: number;
}

import type { Prisma } from "@/lib/generated/prisma/client";

export interface BudgetTotals {
  subtotalImpl: number;
  subtotalMaint: number;
  totalImpl: number;
  totalMaint: number;
}

/** Redondea a 2 decimales evitando errores de coma flotante. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula subtotales (sin IVA) y totales (con IVA) a partir de las líneas.
 * vatRate es una fracción (p. ej. 0.21 para 21%).
 */
export function computeBudgetTotals(
  lines: BudgetLineInput[],
  vatRate: number
): BudgetTotals {
  let subtotalImpl = 0;
  let subtotalMaint = 0;

  for (const l of lines) {
    const qty = Number.isFinite(l.quantity) ? Number(l.quantity) : 1;
    const impl = Number.isFinite(l.implPrice) ? Number(l.implPrice) : 0;
    const maint = Number.isFinite(l.maintPrice) ? Number(l.maintPrice) : 0;
    subtotalImpl += qty * impl;
    subtotalMaint += qty * maint;
  }

  const rate = Number.isFinite(vatRate) ? vatRate : 0;

  return {
    subtotalImpl: round2(subtotalImpl),
    subtotalMaint: round2(subtotalMaint),
    totalImpl: round2(subtotalImpl * (1 + rate)),
    totalMaint: round2(subtotalMaint * (1 + rate)),
  };
}

/**
 * Total con IVA de un presupuesto a partir de sus dos totales persistidos
 * (pago único + mantenimiento, ambos ya con IVA). Única definición: la usan el
 * resumen de la factura del operador y las lecturas de facturas/presupuestos.
 */
export function totalPresupuestoConIva(totalImpl: number, totalMaint: number): number {
  return round2((Number(totalImpl) || 0) + (Number(totalMaint) || 0));
}

/** Total con IVA a partir del resultado de `computeBudgetTotals`. */
export function totalConIva(totals: BudgetTotals): number {
  return totalPresupuestoConIva(totals.totalImpl, totals.totalMaint);
}

/* ---------- Alta de presupuesto (compartida con el panel) ---------- */

/** Línea de presupuesto tal y como la entrega el panel (todos opcionales con defecto). */
export interface BudgetLineCreateInput {
  serviceId?: string;
  name?: string;
  description?: string | null;
  quantity?: number;
  implPrice?: number;
  maintPrice?: number;
}

/**
 * Entrada del alta de presupuesto. Los importes NO se aceptan: se calculan aquí
 * desde las líneas (el panel manda totales del navegador y se ignoran).
 */
export interface BudgetCreateInput {
  quoteNumber: string;
  clientId?: string | null;
  clientSnapshot?: Record<string, unknown>;
  issuerSnapshot?: Record<string, unknown>;
  status?: string;
  vatRate: number;
  validDays: number;
  notes?: string | null;
  lines: BudgetLineCreateInput[];
}

/**
 * Datos Prisma del alta de presupuesto. Es el ÚNICO sitio donde se decide el
 * shape que se persiste: el panel (POST /api/budgets) y el operador
 * (agencia_crear_factura) llaman a esta función, así que no pueden divergir.
 *
 * El número de presupuesto se recibe ya resuelto: el panel lo teclea el humano y
 * el operador lo genera el servidor (ver `nextQuoteNumber`).
 */
export function buildBudgetCreateData(input: BudgetCreateInput): Prisma.BudgetUncheckedCreateInput {
  const totals = computeBudgetTotals(input.lines, input.vatRate);

  return {
    quoteNumber: input.quoteNumber,
    tenantId: input.clientId || undefined,
    clientSnapshot: (input.clientSnapshot ?? {}) as any,
    issuerSnapshot: (input.issuerSnapshot ?? {}) as any,
    status: input.status ?? "draft",
    subtotalImpl: totals.subtotalImpl,
    subtotalMaint: totals.subtotalMaint,
    totalImpl: totals.totalImpl,
    totalMaint: totals.totalMaint,
    vatRate: input.vatRate,
    validDays: input.validDays,
    notes: input.notes,
    lines: {
      create: input.lines.map((l, i: number) => ({
        serviceId: l.serviceId ?? "",
        name: l.name ?? "",
        description: l.description ?? undefined,
        quantity: l.quantity ?? 1,
        implPrice: l.implPrice ?? 0,
        maintPrice: l.maintPrice ?? 0,
        position: i,
      })),
    },
  };
}

/** Datos de un cliente (Tenant) que alimentan el snapshot del presupuesto. */
export interface DatosClienteSnapshot {
  name: string;
  razonSocial?: string | null;
  nif?: string | null;
  direccion?: string | null;
  email?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
}

/**
 * Snapshot del cliente con las MISMAS claves que envía el formulario del panel
 * (name, razonSocial, cif, address, email, phone, contactPerson). El operador no
 * tiene formulario: lo deriva del Tenant, sin inventarse claves nuevas.
 */
export function clientSnapshotFromTenant(cliente: DatosClienteSnapshot): Record<string, string> {
  return {
    name: cliente.name,
    razonSocial: cliente.razonSocial ?? "",
    cif: cliente.nif ?? "",
    address: cliente.direccion ?? "",
    email: cliente.email ?? "",
    phone: cliente.phone ?? "",
    contactPerson: cliente.contactPerson ?? "",
  };
}

/* ---------- Numeración visible del presupuesto (AD-<año>-NNN) ---------- */

/** Año y secuencia de un número de presupuesto (tolerante a sufijos tipo "-R"). */
const QUOTE_NUMBER_RE = /^AD-(\d{4})-(\d+)/;

/**
 * Compone el número visible: `AD-<año>-<secuencia>`, secuencia de 3 dígitos mínimo
 * (a partir de 1000 crece sin truncar: AD-2026-1000).
 */
export function formatoQuoteNumber(anio: number, secuencia: number): string {
  return `AD-${anio}-${String(secuencia).padStart(3, "0")}`;
}

/**
 * Siguiente número LIBRE del año del reloj del servidor, calculado a partir del
 * mayor ya existente de ese año (nunca de un contador en memoria ni de un número
 * que mande el llamador). Toma un cliente de transacción para que la lectura del
 * máximo y el alta que lo consume participen de la misma foto.
 *
 * No promete unicidad por sí sola: `quoteNumber` es @unique en BD y el llamador
 * debe reintentar la transacción ante un P2002 (ver `isQuoteNumberConflict`).
 *
 * lib/codes.ts tiene el gemelo no transaccional que usan los flujos de agente y
 * landing; ambos deben producir el mismo formato (hay un test de paridad).
 */
export async function nextQuoteNumber(
  db: { budget: { findMany: (args: any) => Promise<Array<{ quoteNumber: string }>> } },
  ahora: Date = new Date()
): Promise<string> {
  const anio = ahora.getFullYear();
  const prefijo = `AD-${anio}-`;
  const filas = await db.budget.findMany({
    where: { quoteNumber: { startsWith: prefijo } },
    select: { quoteNumber: true },
  });

  let maximo = 0;
  for (const { quoteNumber } of filas) {
    const match = QUOTE_NUMBER_RE.exec(quoteNumber);
    if (!match) continue;
    if (Number(match[1]) !== anio) continue;
    const secuencia = Number(match[2]);
    if (Number.isSafeInteger(secuencia) && secuencia > maximo) maximo = secuencia;
  }

  return formatoQuoteNumber(anio, maximo + 1);
}

/** Columnas @unique de Budget que identifican una colisión de numeración. */
const QUOTE_NUMBER_UNIQUE_TARGETS = ["quoteNumber", "numero_presupuesto"];

/** ¿El error es una colisión del número visible de presupuesto (P2002)? */
export function isQuoteNumberConflict(err: any): boolean {
  if (err?.code !== "P2002") return false;
  const target = err?.meta?.target;
  if (!target) return false;
  const columnas = Array.isArray(target) ? target : [target];
  return columnas.some((c: unknown) => QUOTE_NUMBER_UNIQUE_TARGETS.includes(c as string));
}
