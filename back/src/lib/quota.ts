import { prisma } from "@/lib/db";

/**
 * H4 (aa-planes-y-cuotas, T4/T5) — Resolución del cupo y recuento facturable.
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

/**
 * H7 (aa-cupo-defecto-y-avisos) — Cupo por defecto: tokens por agente activo y periodo cuando el
 * tenant no tiene ni override ni plan. Es la política de la plataforma, no un dato de ningún cliente,
 * y por eso es una constante y no un valor escrito en cada fila: una política duplicada en N filas no
 * es una política, son N valores que hay que creerse.
 *
 * Medido el 27/07/2026: toda la plataforma consumió 111.561 tokens en un mes (~3.100 por
 * interacción). 10M ≈ 3.200 interacciones/mes ≈ 107/día. Techo alcanzable por un negocio con tráfico
 * real, inalcanzable por accidente.
 *
 * REVISADO el 29/07/2026 (n=5 por rama, tokens leídos de `uso_tokens`, no del retorno del motor —
 * evidencia en `openspec/changes/aa-skills-propias-tenant/evidence-t44.md`). Aquel ~3.100 se midió
 * ANTES del recorte de `aa-agentes-economia-tokens` y SIN ninguna skill instalada, así que hoy no
 * describe a ningún agente:
 *
 *   - agente pelado:        990 tokens/turno → 10.101 turnos/mes (~336/día)
 *   - con UNA skill:      3.261 tokens/turno →  3.066 turnos/mes (~102/día)
 *
 * El número se queda en 10M, pero conviene saber POR QUÉ aguanta: el recorte (−68%) y el coste de
 * instalar una skill (×3,29 — una iteración extra más ~2 KB de protocolo en contexto) casi se
 * cancelan, y el caso con skill vuelve a caer a un 5% del supuesto original. Es coincidencia, no
 * previsión: nadie contó con las skills al fijar esto. Si alguien vuelve a optimizar tokens y cree
 * que ha ganado margen, que mire primero cuántas skills lleva instaladas el agente.
 *
 * No medido: varias skills a la vez, conversaciones largas arrastrando el protocolo en el historial,
 * ni otros sectores con protocolos más gordos. Los tres empujan hacia arriba.
 *
 * Debe coincidir con `PLAN_TOKENS` (front/components/presupuestos/types.ts), que es el número que se
 * ENSEÑA en /tarifas. Hay un test que compara los dos ficheros para que no deriven: si el back aplica
 * 10M y el front anuncia otra cosa, el cliente lee una promesa que la máquina no cumple.
 */
export const DEFAULT_TOKEN_QUOTA_PER_AGENT = 10_000_000;

/** De dónde sale el cupo vigente. Se devuelve junto al número porque el motivo del corte importa. */
export type QuotaSource =
  /** `tenant.tokenBalance` tiene valor: ajuste manual del propietario, gana al plan y al defecto. */
  | "override"
  /** Lo dicta el plan asignado. */
  | "plan"
  /**
   * Ni override ni plan: se aplica `DEFAULT_TOKEN_QUOTA_PER_AGENT`.
   *
   * Sustituye al antiguo `"none"` (H1/H4), que devolvía cupo 0 y hacía que un cliente recién dado de
   * alta naciera muerto: su agente contestaba 402 hasta que alguien entrara a la base a ponerle el
   * saldo a mano. Eso es exactamente lo que hacían los 11 tenants con `saldo = 10.000.000`.
   *
   * `"none"` ya no existe porque ningún dato de entrada lo produce, y una rama inalcanzable se lee
   * como si sí lo fuera. Ojo: el fail-closed de H1 no se afloja, se mueve — `tokenBalance = 0` sigue
   * siendo cupo 0, porque 0 es un valor puesto a propósito y no un hueco.
   */
  | "default";

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
 *
 * H7 — El orden completo es override → plan → **defecto**. Sin override y sin plan ya no es cupo cero
 * sino `DEFAULT_TOKEN_QUOTA_PER_AGENT` por agente, con el mismo suelo de 1 y por el mismo motivo.
 */
export function resolveTokenQuota(tenant: QuotaInput, billableAgents = 0): ResolvedQuota {
  if (tenant.tokenBalance !== null && tenant.tokenBalance !== undefined) {
    return { limit: tenant.tokenBalance, source: "override" };
  }
  // H7 — Sin plan: política de plataforma. Va DESPUÉS del override, así que `tokenBalance = 0` (el
  // freno de mano del propietario) sigue ganando y sigue bloqueando.
  if (!tenant.plan) {
    return {
      limit: DEFAULT_TOKEN_QUOTA_PER_AGENT * Math.max(1, billableAgents),
      source: "default",
    };
  }
  const perAgent = tenant.plan.tokenQuotaPerAgent;
  // `null` es "sin tope" y NO se multiplica: multiplicar el infinito por agentes no significa nada,
  // y tratarlo como 0 convertiría el caso normal de BYOK en un bloqueo.
  if (perAgent === null) return { limit: null, source: "plan" };
  return { limit: perAgent * Math.max(1, billableAgents), source: "plan" };
}

/**
 * ¿Necesita este tenant que se cuenten sus agentes para saber su cupo? Sirve para no pagar una
 * consulta por mensaje cuando la respuesta no depende de ella: con override el cupo ya está decidido,
 * y hoy los 15 tenants de producción tienen override.
 *
 * H7 — Sin plan ahora SÍ hace falta contar, porque el defecto también multiplica por agente. Es la
 * factura de haber elegido una constante de plataforma en vez de escribir el saldo en cada tenant: un
 * `count` indexado por mensaje para los tenants sin override. Se paga a sabiendas.
 */
export function quotaNeedsAgentCount(tenant: QuotaInput): boolean {
  if (tenant.tokenBalance !== null && tenant.tokenBalance !== undefined) return false;
  if (!tenant.plan) return true;
  return tenant.plan.tokenQuotaPerAgent !== null;
}

/**
 * De dónde sale el tope de UN agente.
 *
 * `"none"` aquí significa **sin tope propio**, no bloqueado — deliberadamente distinto del `"none"`
 * que tenía el tenant antes de H7, y ese choque de nombres es justo el motivo por el que allí se
 * retiró.
 */
export type AgentQuotaSource = "override" | "plan" | "default" | "none";

/** Lo mínimo que hay que leer del agente para conocer su tope. */
export type AgentQuotaInput = { tokenQuotaOverride: number | null };

/**
 * H4 T5 — Tope de ESTE agente para el periodo.
 *
 * Sube de importancia con T4 y no es un extra: si se cobra por agente activo, el cupo es del agente
 * por construcción —lo que se paga por unidad se limita por unidad—. Sin tope propio, el cupo del
 * tenant es un bote común y el agente que más habla se come el que otro ya está pagando.
 *
 * `source: "none"` con `limit: null` significa **sin tope de agente**. Queda reservado al plan que
 * pone `tokenQuotaPerAgent = null`, que es "sin tope" a propósito (H4 T5).
 *
 * H7 — El caso "sin plan **y sin override del tenant**" se separa y pasa a tener tope propio de
 * `DEFAULT_TOKEN_QUOTA_PER_AGENT`. Aquí está la parte que importa del modelo de negocio: si el cupo
 * del tenant es 10M × agentes y ningún agente tiene tope propio, **un agente charlatán se come el
 * cupo de los otros dos que el cliente ya está pagando**. Con el defecto por agente, tres agentes son
 * 30M en total y 10M cada uno. Con un solo agente los dos topes coinciden en el mismo número y el
 * corte cae en el mismo punto: no sobra, es el mismo límite mirado desde los dos lados.
 *
 * "Sin plan" y "plan que no pone tope" son cosas distintas y sólo la primera cae al defecto.
 *
 * H7 — Por eso el segundo parámetro es el TENANT y no sólo su plan: **con override no hay defecto por
 * agente**. El override es un total elegido a mano por el propietario, no una cifra por agente; un
 * cliente con `tokenBalance = 50M` y tres agentes se quedaría en 30M utilizables si cada agente se
 * topara en 10M, y el ajuste manual se habría deshecho solo y sin dejar rastro — exactamente lo que
 * el orden de `resolveTokenQuota` existe para evitar. Quien quiera repartir un override reparte con
 * `Agent.tokenQuotaOverride`, que es explícito.
 *
 * Recibe el tenant entero, y no un booleano ni la `source` ya resuelta, para que el llamador no pueda
 * pasar una combinación que no exista: el tope del agente y el del tenant se derivan del mismo dato.
 */
export function resolveAgentQuota(
  agent: AgentQuotaInput,
  tenant?: QuotaInput | null
): { limit: number | null; source: AgentQuotaSource } {
  if (agent.tokenQuotaOverride !== null && agent.tokenQuotaOverride !== undefined) {
    return { limit: agent.tokenQuotaOverride, source: "override" };
  }
  const hasTenantOverride =
    tenant?.tokenBalance !== null && tenant?.tokenBalance !== undefined;
  if (hasTenantOverride) return { limit: null, source: "none" };
  const plan = tenant?.plan;
  if (!plan) return { limit: DEFAULT_TOKEN_QUOTA_PER_AGENT, source: "default" };
  if (plan.tokenQuotaPerAgent === null) return { limit: null, source: "none" };
  return { limit: plan.tokenQuotaPerAgent, source: "plan" };
}

/** Nivel de aviso del consumo contra el cupo. */
export type QuotaWarning =
  /** Por debajo del 75%, o sin tope: no hay nada de lo que avisar. */
  | "ok"
  /** ≥ 75%: primer aviso, aún queda margen. */
  | "warn75"
  /** ≥ 90%: último aviso antes del corte. */
  | "warn90"
  /** ≥ 100%: el gate ya está cortando. */
  | "exhausted";

/**
 * H7 — Nivel de aviso del consumo contra el cupo. Función pura: el gate corta, esto sólo informa.
 *
 * Usa `>=`, **igual que el corte del gate** (`tokensUsedPeriod >= limit`). Si el aviso usara `>` y el
 * corte `>=`, existiría un consumo exacto en el que el agente está cortado y el panel dice "ok". Un
 * número que contradice a la máquina es peor que ningún número.
 *
 * Se calcula, no se guarda: guardarlo obligaría a recalcularlo en cada consumo y a resetearlo en cada
 * renovación de periodo. Mismo argumento por el que H4 T5 derivó el consumo por agente en vez de
 * cachearlo.
 */
export function quotaWarningLevel(used: number, limit: number | null): QuotaWarning {
  // Sin tope no hay porcentaje. No es optimismo: es que la pregunta no aplica.
  if (limit === null) return "ok";
  // Cubre el 0 del freno de mano y cualquier negativo de un override mal puesto, sin NaN ni Infinity.
  if (limit <= 0) return "exhausted";
  const ratio = used / limit;
  if (ratio >= 1) return "exhausted";
  if (ratio >= 0.9) return "warn90";
  if (ratio >= 0.75) return "warn75";
  return "ok";
}

/**
 * Consumo de UN agente en el periodo vigente.
 *
 * Se **suma de `uso_tokens`** y no de un contador cacheado en `Agent`, a diferencia del contador del
 * tenant. Motivo: `uso_tokens` es la fuente de verdad (una fila por respuesta), y todo agregado
 * incremental deriva — el del tenant ya obligó a escribir un script de reconciliación en T3.4.
 * Una segunda caché duplicaría esa superficie y además habría que resetearla en cada renovación de
 * periodo, con una escritura por agente. Aquí el tope es un guardarraíl, no una factura: pagar una
 * suma acotada por el periodo y por el índice `(agente_id, creado_en)` sale más barato que mantener
 * un número que puede mentir.
 *
 * Sólo cuenta `credentialMode: "platform"`, igual que el contador del tenant: en byok el gasto lo
 * paga el cliente a su proveedor y no consume cupo de nadie.
 */
export async function sumAgentPeriodUsage(agentId: string, periodStart: Date): Promise<number> {
  const agg = await prisma.tokenUsage.aggregate({
    where: { agentId, createdAt: { gte: periodStart }, credentialMode: "platform" },
    _sum: { tokens: true },
  });
  return agg._sum.tokens ?? 0;
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
