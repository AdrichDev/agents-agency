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
  tokenBalance: number;
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
export function remainingQuota(
  c: Pick<ClientRecord, "tokenBalance" | "tokensUsed" | "tokensUsedPeriod">
): number {
  return Math.max(0, (c.tokenBalance ?? 0) - usedAgainstQuota(c));
}
