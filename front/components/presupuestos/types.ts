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
export const PLAN_TOKENS = 10_000_000;

/**
 * Catálogo oficial de servicios 2026. Precios SIN IVA (se aplica 21% al mostrar/facturar).
 * Fuente única de verdad del front (facturación + página de tarifas).
 * Mantener sincronizado con back/src/lib/service-catalog.ts.
 */
export const SERVICES_CATALOG: BudgetService[] = [
  {
    id: "chatbot_basic",
    name: "Agente IA — Starter",
    description: "Chatbot Web con base de conocimiento + Soporte",
    implPrice: 540,
    maintPrice: 39,
    tokens: PLAN_TOKENS,
    selected: false,
    quantity: 1,
  },
  {
    id: "chatbot_plus",
    name: "Agente IA — Plus",
    description:
      "Página Web + Agente IA Multi-canal + cobertura Google + Hosting",
    implPrice: 1290,
    maintPrice: 99,
    tokens: PLAN_TOKENS,
    selected: false,
    quantity: 1,
  },
  {
    id: "chatbot_pro",
    name: "Agente IA — Pro",
    description: "Agente autónomo con integraciones avanzadas, voz, RAG",
    implPrice: 1730,
    maintPrice: 149,
    tokens: PLAN_TOKENS,
    selected: false,
    quantity: 1,
  },
  {
    id: "web_basic",
    name: "Página Web Profesional (Landing Page)",
    description: "Web responsive, SEO básico  + captación de Leads + Hosting",
    implPrice: 890,
    maintPrice: 59,
    selected: false,
    quantity: 1,
  },
  {
    id: "web_chatbot",
    name: "Web Completa + Chatbot",
    description:
      "Web corporativa con agente IA integrado y multi-idioma. Incluye CRM, base de conocimiento, automatizaciones y analytics.",
    implPrice: 2950,
    maintPrice: 180,
    tokens: PLAN_TOKENS,
    selected: false,
    quantity: 1,
  },
  {
    id: "automation",
    name: "Automatización RPA/n8n",
    description:
      "Flujos automatizados: email, CRM, facturación y notificaciones",
    implPrice: 750,
    maintPrice: 49,
    selected: false,
    quantity: 1,
  },
  {
    id: "crm",
    name: "CRM a Medida",
    description:
      "CRM desde 2.000€ según los módulos contratados (clientes, trabajadores, producto, facturación...)",
    implPrice: 2000,
    maintPrice: 99,
    selected: false,
    quantity: 1,
  },
  {
    id: "hours",
    name: "Desarrollo a Medida",
    description:
      "Integraciones personalizadas, APIs, scripts y desarrollo específico (precio por hora)",
    implPrice: 75,
    maintPrice: 0,
    selected: false,
    quantity: 10,
  },
  {
    id: "tokens_5m",
    name: "Tokens IA Extra (5M)",
    description: "Ampliación de capacidad: 5 millones de tokens de IA al mes",
    implPrice: 0,
    maintPrice: 17,
    selected: false,
    quantity: 1,
  },
  {
    id: "tokens_10m",
    name: "Tokens IA Extra (10M)",
    description: "Ampliación de capacidad: 10 millones de tokens de IA al mes",
    implPrice: 0,
    maintPrice: 30,
    selected: false,
    quantity: 1,
  },
];

export const IVA_RATE = 0.21;

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
