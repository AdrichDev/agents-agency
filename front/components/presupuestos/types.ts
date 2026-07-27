// Los importes NO viven en este fichero. Están en `front/lib/service-catalog.json`, que es el único
// sitio donde se cambia un precio: de ahí los lee el front (tarifas, presupuestos, facturas, portal)
// y de ahí regenera el back su espejo con `npm run catalog:sync`. Ver
// openspec/changes/aa-catalogo-precios-fuente-unica.
import catalog from "@/lib/service-catalog.json";

export interface BudgetService {
  id: string;
  name: string;
  description: string;     // descripción breve de lo que incluye el servicio
  implPrice: number;       // puesta en marcha (pago único), sin IVA
  maintPrice: number;      // mensualidad, sin IVA
  tokens?: number;         // tokens de IA incluidos (solo planes con agente)
  selected: boolean;
  quantity: number;
}

/** Tokens de IA incluidos por defecto en cada plan con agente. */
export const PLAN_TOKENS = catalog.planTokens;

/**
 * Cantidad inicial en el formulario de presupuestos. Es estado de la pantalla, no dato de catálogo:
 * por eso vive aquí y no en el JSON. `hours` se vende por horas y arranca en 10.
 */
const DEFAULT_QUANTITY: Record<string, number> = { hours: 10 };

/**
 * Catálogo oficial de servicios 2026. Precios SIN IVA (se aplica 21% al mostrar/facturar).
 * El orden es el del JSON, que es el que pinta la tabla completa de `/tarifas`.
 */
export const SERVICES_CATALOG: BudgetService[] = catalog.services.map((s) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  implPrice: s.implPrice,
  maintPrice: s.maintPrice,
  // El número de tokens se resuelve desde un booleano a propósito: los 10M se escriben una sola vez,
  // en `planTokens`. Repetirlos en cada plan sería reintroducir la duplicación en pequeño.
  tokens: s.includesPlanTokens ? PLAN_TOKENS : undefined,
  selected: false,
  quantity: DEFAULT_QUANTITY[s.id] ?? 1,
}));

export const IVA_RATE = catalog.ivaRate;

/** Aplica el 21% de IVA a un importe. */
export const withIva = (n: number): number => toNum(n) * (1 + IVA_RATE);

/** Coacciona a número finito; cualquier valor inválido (null/undefined/NaN) → 0. */
export function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export const fmt = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toNum(n));

export type BudgetStatus = "generada" | "aceptada" | "caducada" | "rechazada";

export interface BudgetRecord {
  id: string;
  quoteNumber: string;
  status: BudgetStatus;
  subtotalImpl: number;
  subtotalMaint: number;
  totalImpl: number;
  totalMaint: number;
  clientId?: string | null;
  client?: { id: string; name: string; cif?: string | null } | null;
  clientSnapshot: any;
  issuerSnapshot: any;
  lines: any[];
  createdAt: string;
}

/**
 * Facturas (aa-facturas-desde-presupuestos-aceptados): nacen automáticamente
 * al aceptar un presupuesto, nunca se crean a mano. Ciclo de cobro propio,
 * independiente del estado del presupuesto origen.
 */
export type InvoiceStatus = "pendiente" | "cobrada";

export interface InvoiceRecord {
  id: string;
  number: string; // "FAC - 2026-001"
  status: InvoiceStatus;
  paidAt: string | null;
  createdAt: string;
  budget: BudgetRecord;
}

export interface InvoiceMetrics {
  totalCount: number;
  pendingCount: number;
  paidCount: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
}
