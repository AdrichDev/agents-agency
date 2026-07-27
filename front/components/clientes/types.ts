export interface ClientRecord {
  id: string;
  codigo: string | null;
  name: string;
  razonSocial: string | null;
  cif: string | null;
  direccion: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  contactPerson: string | null;
  sector: string | null;
  website: string | null;
  hasInvoices: boolean;
  // Créditos de IA (tokens consumidos por el widget del cliente).
  /**
   * H4 T4 — Ya NO es el cupo: es el OVERRIDE por tenant. `null` = sin override, manda el plan.
   * Para saber el cupo que aplica de verdad, `tokenQuota`.
   */
  tokenBalance: number | null;
  /**
   * H4 T4 — Cupo EFECTIVO que aplica el gate, calculado por el backend (override, o plan × agentes
   * activos). `null` = **sin tope**, no cero. Opcional porque un backend anterior a T4 no lo envía.
   */
  tokenQuota?: number | null;
  /**
   * De dónde sale el cupo.
   *
   * H7 — 'none' (sin plan ni override ⇒ bloqueado) ya no existe: ese caso pasó a ser 'default', el
   * cupo por defecto de la plataforma. Se distingue de 'override' a propósito: "10M porque es lo que
   * damos por defecto" y "10M porque alguien se lo puso a mano" se arreglan de formas distintas.
   */
  quotaSource?: "override" | "plan" | "default";
  /**
   * H7 — Nivel de aviso del consumo contra el cupo, calculado por el backend con el mismo consumo y
   * los mismos umbrales que aplica el gate. No se recalcula aquí: un aviso que contradice al corte es
   * peor que no avisar. Opcional porque un backend anterior a H7 no lo envía.
   *
   * `null` en `byok`: allí el cupo no se aplica, así que no hay porcentaje que avisar.
   */
  quotaWarning?: "ok" | "warn75" | "warn90" | "exhausted" | null;
  /** Agentes activos: la magnitud facturable del periodo. Un entero, nunca un importe. */
  billableAgents?: number;
  /** Plan asignado (sin importes: el precio vive en Stripe). */
  plan?: { codigo: string; nombre: string; tokenQuotaPerAgent: number | null } | null;
  /** Acumulado DE POR VIDA. Histórico: no es lo que consume el cupo. */
  tokensUsed: number;
  /**
   * H4 T3 — Consumo del periodo vigente. Es el contador contra el que corta el gate, así que es
   * el que hay que usar para calcular el cupo restante. Opcional porque un backend anterior al
   * despliegue de T3 no lo envía; en ese caso se cae a `tokensUsed`, que es lo que ese backend
   * está usando de verdad para cortar.
   */
  tokensUsedPeriod?: number;
  /** Inicio del periodo vigente (ISO). Sirve para explicar "restantes hasta el día X". */
  periodStart?: string;
  isActive: boolean;
  /** H2: 'platform' (la plataforma paga el LLM) | 'byok' (clave propia del cliente). */
  credentialMode: "platform" | "byok";
  createdAt: string;
}

export interface ClientFormState {
  name: string;
  razonSocial: string;
  cif: string;
  contactPerson: string;
  phone: string;
  email: string;
  direccion: string;
  sector: string;
  tokenBalance: string; // cupo de tokens (string en el form, número al enviar)
  isActive: boolean;
}

export const EMPTY_FORM: ClientFormState = {
  name: "",
  razonSocial: "",
  cif: "",
  contactPerson: "",
  phone: "",
  email: "",
  direccion: "",
  sector: "",
  tokenBalance: "0",
  isActive: true,
};

/**
 * Tokens medios por mensaje para estimar "mensajes" desde el cupo (solo display).
 * Chatbot FAQ/reservas/horarios = ~1.000 tok/msg (entrada 700 + salida 300).
 * Ligero conservador (1.200) para cubrir variabilidad sin sobreprometer.
 */
export const TOKENS_PER_MESSAGE = 1200;

/** Formatea dígitos a miles con punto (es-ES): "10000000" → "10.000.000". */
export function formatThousands(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits ? Number(digits).toLocaleString("es-ES") : "";
}

/**
 * Consumo que descuenta del cupo. Una sola función para que el cálculo del restante no se
 * duplique: la tabla y el formulario de edición tienen que coincidir, o el operador ve una cifra
 * en la lista y otra al abrir el cliente.
 */
export function usedAgainstQuota(c: Pick<ClientRecord, "tokensUsed" | "tokensUsedPeriod">): number {
  return c.tokensUsedPeriod ?? c.tokensUsed ?? 0;
}

/** Cupo restante del periodo, nunca negativo. */
/**
 * Cupo que aplica de verdad. `null` = sin tope.
 *
 * H4 T4 — Se prefiere `tokenQuota`, que es lo que el backend resolvió con la misma función que usa
 * el gate. `tokenBalance` sólo sirve de reserva para un backend anterior a T4, donde era el cupo.
 */
export function quotaLimit(c: Pick<ClientRecord, "tokenBalance" | "tokenQuota">): number | null {
  if (c.tokenQuota !== undefined) return c.tokenQuota;
  return c.tokenBalance ?? 0;
}

/** Tokens que le quedan en el periodo. `null` = sin tope (no hay resta que hacer). */
export function remainingQuota(
  c: Pick<ClientRecord, "tokenBalance" | "tokenQuota" | "tokensUsed" | "tokensUsedPeriod">
): number | null {
  const limit = quotaLimit(c);
  if (limit === null) return null;
  return Math.max(0, limit - usedAgainstQuota(c));
}
