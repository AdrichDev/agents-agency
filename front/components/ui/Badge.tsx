import type { ReactNode } from "react";

/**
 * Colored pill. Variants map to the EXACT Tailwind color classes already used
 * across facturación (estado de presupuesto) y contactos (contactado / tipo).
 *
 * The pill "shell" (padding, radius, font) is passed via `className` so each
 * call site keeps its original markup; only the color logic is centralized.
 */

// Estado de presupuesto (facturación): bg-X/20 text-X — sin borde.
const BUDGET_STATUS = {
  generada: "bg-blue-500/20 text-blue-400",
  aceptada: "bg-emerald-500/20 text-emerald-400",
  rechazada: "bg-red-500/20 text-red-400",
  caducada: "bg-slate-500/20 text-slate-400",
  neutral: "bg-white/10 text-white",
} as const;

// Estado de cobro de factura (facturas): bg-X/20 text-X — sin borde.
const INVOICE_STATUS = {
  pendiente: "bg-amber-500/20 text-amber-400",
  cobrada: "bg-emerald-500/20 text-emerald-400",
} as const;

// Contactado (contactos): bg-X/15 text-X border-X/40.
const CONTACTADO = {
  si: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  no: "bg-red-500/15 text-red-400 border-red-500/40",
  nc: "bg-orange-500/15 text-orange-400 border-orange-500/40",
} as const;

// Tipo de contacto (contactos): lead vs prospecto, con borde.
const CONTACT_TYPE = {
  lead: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/40",
  prospecto: "bg-cyan-500/15 text-cyan-400 border-cyan-500/40",
} as const;

const VARIANTS = {
  ...BUDGET_STATUS,
  ...INVOICE_STATUS,
  ...CONTACTADO,
  ...CONTACT_TYPE,
} as const;

export type BadgeVariant = keyof typeof VARIANTS;

/** Color classes for a budget status, falling back to neutral. */
export function budgetStatusColor(status: string): string {
  return (BUDGET_STATUS as Record<string, string>)[status] ?? BUDGET_STATUS.neutral;
}

/** Raw color classes for a variant — for interactive elements (button) that
 *  need the pill colors but cannot be a <span>. */
export function badgeVariantClass(variant: BadgeVariant): string {
  return VARIANTS[variant];
}

interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
  /** Pill shell classes (padding, radius, typography). Kept per call site. */
  className?: string;
}

export function Badge({ variant, children, className = "" }: BadgeProps) {
  return <span className={`${className} ${VARIANTS[variant]}`.trim()}>{children}</span>;
}
