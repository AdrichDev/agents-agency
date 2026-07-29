import { checkPublishPreconditions, isServable } from "@/lib/agent/lifecycle";

/**
 * aa-puesta-en-marcha-agente (F1) — Contrato único de activación.
 *
 * El problema que resuelve: en producción había 11 agentes, 10 en borrador, y
 * ninguno de los 10 estaba bloqueado por nada. El único evento de transición de
 * estado de toda la historia lo generamos nosotros. Crear un agente terminaba en
 * un borrador que nadie volvía a tocar.
 *
 * Este módulo es el ÚNICO sitio donde se decide en qué escalón está un agente.
 * Rutas, listado, ficha y wizard consumen su salida; ninguno reimplementa el
 * criterio. Es puro a propósito: sin BD ni red, testeable con objetos literales.
 */

export const ONBOARDING_STEPS = ["configurado", "publicado", "alcanzable", "probado"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Pestaña de la ficha del agente donde se resuelve el escalón pendiente.
 *
 * `ajustes`, no `datos`: el `systemPrompt` se edita en `AgentModelPanel`, que cuelga de
 * la pestaña Ajustes. La de Datos del negocio es otra cosa. Mandar a la pestaña
 * equivocada es peor que no mandar a ninguna.
 *
 * No hay entrada para el cliente a propósito: `tenantId` sólo se asigna en el wizard de
 * creación, así que un agente sin cliente NO se puede arreglar desde su ficha. Cuando ese
 * es el bloqueante, `nextTab` sale `null` — mejor decir qué falta sin ofrecer un botón que
 * lleva a un sitio donde no se puede hacer nada.
 */
export type OnboardingTab = "ajustes" | "canales" | "implementacion";

export interface OnboardingInput {
  status: string;
  publishedAt: Date | null;
  tenantId: string | null;
  systemPrompt: string | null;
  channel: string;
  widgetInstalledAt: Date | null;
  channelConnections: { provider: string; status: string }[];
  /**
   * Fecha de la última conversación NO de prueba del agente, o null si no hay
   * ninguna. Se calcula fuera (una consulta agregada para todo el listado, ver
   * `service.ts`) porque Prisma no deja comparar contra una columna de la fila
   * padre dentro del `where` de un `_count` de relación.
   */
  lastPublicConversationAt: Date | null;
}

export interface OnboardingState {
  /** Último escalón alcanzado. `null` = ni siquiera está configurado. */
  step: OnboardingStep | null;
  configurado: boolean;
  publicado: boolean;
  alcanzable: boolean;
  probado: boolean;
  /** Qué falta para el siguiente escalón, en una frase. `null` si no falta nada. */
  nextLabel: string | null;
  /** Dónde se resuelve. `null` si no queda nada pendiente. */
  nextTab: OnboardingTab | null;
  /** Lo que impide publicar (de `checkPublishPreconditions`). */
  blocking: string[];
  /** Avisos no bloqueantes (canal declarado sin conexión, etc.). */
  warnings: string[];
}

/**
 * Los cuatro escalones, en cascada estricta: cada uno exige el anterior.
 *
 * La monotonía no es cosmética. Un borrador con el widget instalado NO es
 * alcanzable: `isServable` sólo acepta `published`, así que ese widget está
 * embebido en una web recibiendo un 403. Marcarlo como alcanzable sería
 * exactamente la mentira que este cambio viene a quitar de en medio.
 *
 * `suspended` tampoco es `publicado`: se factura (`BILLABLE_STATUSES`) pero no
 * atiende. Mezclar "se cobra" con "funciona" es el error de origen.
 */
export function computeOnboardingState(input: OnboardingInput): OnboardingState {
  const { blocking, warnings } = checkPublishPreconditions({
    tenantId: input.tenantId,
    systemPrompt: input.systemPrompt,
    channel: input.channel,
    channelConnections: input.channelConnections,
  });

  const configurado = blocking.length === 0;

  // `publishedAt` es la PRIMERA publicación y no se pisa al republicar
  // (schema.prisma). Sin él no hay contra qué comparar el tráfico, y un
  // `published` sin fecha es un dato roto que no debe contar como publicado.
  const publicado = configurado && isServable(input.status) && input.publishedAt !== null;

  const alcanzable =
    publicado &&
    (input.widgetInstalledAt !== null ||
      input.channelConnections.some((c) => c.status === "active"));

  // Sólo cuenta el tráfico POSTERIOR a la publicación: lo anterior es de la
  // consola de pruebas o de tráfico viejo, y no demuestra que atienda ahora.
  //
  // OJO con lo que esto significa: `isTest = false` sólo excluye la consola de
  // pruebas del operador. NO prueba que quien escribió fuese un cliente real —
  // el propio dueño puede abrir el widget. Por eso el copy dice "ha recibido
  // tráfico" y nunca "lo usó un cliente".
  const probado =
    alcanzable &&
    input.lastPublicConversationAt !== null &&
    input.publishedAt !== null &&
    input.lastPublicConversationAt > input.publishedAt;

  const step: OnboardingStep | null = probado
    ? "probado"
    : alcanzable
      ? "alcanzable"
      : publicado
        ? "publicado"
        : configurado
          ? "configurado"
          : null;

  const { nextLabel, nextTab } = describeNext({
    configurado,
    publicado,
    alcanzable,
    probado,
    blocking,
    hasTenant: Boolean(input.tenantId),
  });

  return { step, configurado, publicado, alcanzable, probado, nextLabel, nextTab, blocking, warnings };
}

/** El siguiente paso concreto: una sola acción, la del primer escalón pendiente. */
function describeNext(s: {
  configurado: boolean;
  publicado: boolean;
  alcanzable: boolean;
  probado: boolean;
  blocking: string[];
  hasTenant: boolean;
}): { nextLabel: string | null; nextTab: OnboardingTab | null } {
  if (!s.configurado) {
    // El primer bloqueo es el que hay que resolver; enumerarlos todos sólo
    // reparte la atención.
    return {
      nextLabel: s.blocking[0] ?? "Faltan datos para poder publicarlo.",
      // Si lo que falta es el cliente no hay pestaña a la que ir: `tenantId` sólo se
      // asigna en el wizard. Se dice qué falta y punto; un botón que no arregla nada
      // gasta la confianza del operador.
      nextTab: s.hasTenant ? "ajustes" : null,
    };
  }
  if (!s.publicado) {
    return { nextLabel: "Publícalo para que empiece a atender al público.", nextTab: "implementacion" };
  }
  if (!s.alcanzable) {
    return {
      nextLabel: "Instala el widget en la web del cliente o conecta un canal.",
      nextTab: "implementacion",
    };
  }
  if (!s.probado) {
    // Sin pestaña: probarlo "de verdad" es escribirle desde fuera. La consola de pruebas
    // marca `isTest` y no cuenta, así que mandar a "Probar agente" sería una trampa —
    // el escalón no se movería por mucho que se use.
    return {
      nextLabel: "Todavía no ha recibido ningún mensaje de fuera. Escríbele desde el canal real.",
      nextTab: null,
    };
  }
  return { nextLabel: null, nextTab: null };
}
