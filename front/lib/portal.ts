/**
 * H5 (aa-portal-cliente, T4) — Contratos y cálculos del portal del cliente.
 *
 * Dos reglas gobiernan este módulo:
 *
 * 1. **La tarifa sale del catálogo del front, nunca del backend.** `/api/portal/me` no devuelve ni un
 *    importe (AC9), y no es un olvido: el precio vive en el catálogo comercial y en Stripe (H6), y un
 *    backend que además lo enviase daría dos fuentes para el mismo número — el día que divergieran, la
 *    pantalla del cliente diría un precio y la factura otro.
 *
 * 2. **Aquí no se recalcula el cupo.** El cupo, el restante y el nivel de aviso vienen resueltos por el
 *    backend con la misma función que usa el gate para cortar. Recalcularlos en el navegador abriría la
 *    puerta a que el portal diga "te queda saldo" mientras el agente ya está devolviendo 402.
 */
import { SERVICES_CATALOG, type BudgetService } from "@/components/presupuestos/types";

/** Raíz del portal. Todo lo que un usuario de portal puede ver vive debajo. */
export const PORTAL_ROOT = "/portal";

/**
 * Rol del usuario de portal. Mismo literal que `CLIENT_ROLE` en el backend
 * (`back/src/lib/client-scope.ts`): si los dos dejaran de coincidir, el front enseñaría el menú del
 * estudio a alguien a quien el backend le deniega cada petición.
 */
export const CLIENT_ROLE = "client";

/** Origen del cupo vigente, tal como lo resuelve el backend. */
export type QuotaSource = "override" | "plan" | "default";

/** Nivel de aviso. `null` en byok: allí el cupo no se aplica y no hay porcentaje que avisar. */
export type QuotaWarning = "ok" | "warn75" | "warn90" | "exhausted" | null;

/** Respuesta de `GET /api/portal/me`. Sin importes, a propósito. */
export interface PortalMe {
  tenant: { id: string; name: string; isActive: boolean };
  /** Plan contratado. `codigo` es la clave con la que se cruza la tarifa del catálogo. */
  plan: { codigo: string; nombre: string } | null;
  period: { start: string; anchorDay: number };
  usage: {
    tokensUsedPeriod: number;
    /** `null` = sin tope, no cero. */
    tokenQuota: number | null;
    quotaSource: QuotaSource;
    remaining: number | null;
    warning: QuotaWarning;
  };
  credentialMode: "platform" | "byok";
  billableAgents: number;
}

export interface PortalAgent {
  id: string;
  name: string;
  sector: string | null;
  status: "published" | "suspended";
  statusChangedAt: string | null;
  channel: string | null;
  createdAt: string;
  tokensUsedPeriod: number;
}

export interface PortalConversation {
  id: string;
  channel: string | null;
  createdAt: string;
  messageCount: number;
}

export interface PortalMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface PortalPage<T> {
  items: T[];
  /** `null` = no hay más páginas. */
  nextCursor: string | null;
}

/**
 * Tarifa del plan contratado, desde el catálogo comercial del front.
 *
 * Devuelve `null` cuando el plan no está en el catálogo — y eso incluye el caso de HOY, con la tabla
 * `plan` vacía. Preferimos `null` y una pantalla que dice "consulta con el estudio" antes que caer a
 * una tarifa cualquiera: un importe inventado en la pantalla del cliente es peor que no mostrar
 * ninguno.
 */
export function tarifaDePlan(codigo: string | null | undefined): BudgetService | null {
  if (!codigo) return null;
  return SERVICES_CATALOG.find((s) => s.id === codigo) ?? null;
}

/** Importe mensual con IVA, en euros. El catálogo guarda los precios sin IVA. */
export const IVA_RATE = 0.21;

export function conIva(amount: number): number {
  return Math.round(amount * (1 + IVA_RATE) * 100) / 100;
}

/** Porcentaje del cupo consumido, acotado a [0, 100]. `null` cuando no hay tope que medir. */
export function porcentajeConsumido(usage: PortalMe["usage"]): number | null {
  const { tokenQuota, tokensUsedPeriod } = usage;
  if (tokenQuota === null || tokenQuota <= 0) return null;
  return Math.min(100, Math.round((tokensUsedPeriod / tokenQuota) * 100));
}

/**
 * Texto del aviso, o `null` si no hay nada que avisar.
 *
 * `exhausted` dice explícitamente que el asistente está cortado, porque es lo que pasa: el gate
 * devuelve 402 y el agente deja de contestar. Un "cupo agotado" sin más deja al cliente adivinando si
 * eso le afecta o no.
 */
export function textoAviso(warning: QuotaWarning): string | null {
  switch (warning) {
    case "warn75":
      return "Has consumido el 75% de tu cupo mensual.";
    case "warn90":
      return "Has consumido el 90% de tu cupo mensual. Al llegar al 100% el asistente deja de responder.";
    case "exhausted":
      return "Cupo mensual agotado: el asistente no responde hasta la próxima renovación.";
    default:
      return null;
  }
}

/** Día en el que renueva el cupo, a partir del ancla del periodo. */
export function textoRenovacion(period: PortalMe["period"]): string {
  return `Renueva el día ${period.anchorDay} de cada mes.`;
}
