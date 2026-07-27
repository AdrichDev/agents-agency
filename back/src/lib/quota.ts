
/**
 * H4 (aa-planes-y-cuotas, T4) — Resolución del cupo y recuento facturable.
 *
 * Dos magnitudes distintas que conviene no confundir, porque la tentación de fundirlas es
 * permanente:
 *
 *   CUPO (`resolveTokenQuota`)  → guardarraíl anti-abuso del gasto LLM del propietario.
 *                                 Es un límite, no un precio. Puede no existir (`null`).
 *   RECUENTO (`countBillableAgents`) → magnitud facturable del periodo: agentes activos.
 *                                 Es un entero, y es la `quantity` que H6 manda a Stripe.
 *
 * Aquí NO hay importes. Ninguna función de este módulo devuelve dinero, y eso es deliberado: el
 * importe vive en Stripe (design.md §C.4). Si algún día alguien necesita euros, el sitio no es este
 * fichero.
 */

/** De dónde sale el cupo vigente. Se devuelve junto al número porque el motivo del corte importa. */
export type QuotaSource =
  /** `tenant.tokenBalance` tiene valor: ajuste manual del propietario, gana al plan. */
  | "override"
  /** Lo dicta el plan asignado. */
  | "plan"
  /** Ni override ni plan: no es cobrable, y por H1 lo que no es cobrable no es servible. */
  | "none";

export type ResolvedQuota = {
  /** Tokens permitidos en el periodo. `null` = sin tope. `0` = bloqueado. */
  limit: number | null;
  source: QuotaSource;
};

/** Lo mínimo que hay que leer del tenant para resolver su cupo. */
export type QuotaInput = {
  tokenBalance: number | null;
  plan?: { tokenQuotaPerAgent: number | null } | null;
};

/**
 * Cupo vigente del tenant para el periodo.
 *
 * Orden deliberado —el override gana al plan— porque el override es un acto explícito del
 * propietario sobre un cliente concreto y el plan es la regla general: si el plan ganara, cualquier
 * ajuste manual se desharía solo y de forma invisible.
 *
 * `billableAgents` multiplica el cupo del plan porque el cupo del plan es POR AGENTE: un tenant con
 * tres agentes vendidos tiene tres veces el tope, no uno compartido a la fuerza. Mientras T5 no
 * reparta el tope agente por agente, el bote es común dentro del tenant — peor que T5, pero
 * estrictamente mejor que hoy, donde no hay tope ligado a lo contratado.
 *
 * El multiplicador tiene SUELO 1, y no es un parche: un tenant con plan y todos sus agentes en
 * `draft` tendría cupo cero, y con cupo cero no se puede probar un agente antes de publicarlo. El
 * flujo es crear → probar → publicar, así que un cupo que exige publicar primero lo haría
 * imposible. Dar la asignación de un agente no regala nada: el cupo es el guardarraíl, no la
 * factura — la factura es el recuento, que sí es cero si no hay nada publicado.
 */
export function resolveTokenQuota(tenant: QuotaInput, billableAgents = 0): ResolvedQuota {
  if (tenant.tokenBalance !== null && tenant.tokenBalance !== undefined) {
    return { limit: tenant.tokenBalance, source: "override" };
  }
  if (!tenant.plan) return { limit: 0, source: "none" };
  const perAgent = tenant.plan.tokenQuotaPerAgent;
  // `null` es "sin tope" y NO se multiplica: multiplicar el infinito por agentes no significa nada,
  // y tratarlo como 0 convertiría el caso normal de BYOK en un bloqueo.
  if (perAgent === null) return { limit: null, source: "plan" };
  return { limit: perAgent * Math.max(1, billableAgents), source: "plan" };
}

/**
 * ¿Necesita este tenant que se cuenten sus agentes para saber su cupo? Sirve para no pagar una
 * consulta por mensaje cuando la respuesta no depende de ella: con override o sin plan, el cupo ya
 * está decidido, y hoy todos los tenants de producción tienen override.
 */
export function quotaNeedsAgentCount(tenant: QuotaInput): boolean {
  if (tenant.tokenBalance !== null && tenant.tokenBalance !== undefined) return false;
  return !!tenant.plan && tenant.plan.tokenQuotaPerAgent !== null;
}

/**
 * Magnitud facturable del periodo: **agentes activos del tenant**. Un entero, nunca un importe.
 *
 * NO se reimplementa aquí: vive en H3 (`@/lib/agent/lifecycle`), que es donde está la máquina de
 * estados y la lista `BILLABLE_STATUSES`. Se reexporta para que el consumidor de cupo no tenga que
 * saber de qué módulo viene, pero la definición es una sola — dos recuentos con el mismo nombre
 * acabarían divergiendo y el que se corrigiera no sería el que corre.
 *
 * `suspended` cuenta, y no es un descuido: un agente suspendido está vendido y sólo está silenciado.
 * Si dejara de contar, suspender sería la forma de dejar de pagar sin dejar de tener el agente.
 */
export { billableAgentFilter, countBillableAgents } from "@/lib/agent/lifecycle";
