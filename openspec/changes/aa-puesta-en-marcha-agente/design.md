# Diseño

## 1. Enfoque

Una función pura y un solo lugar donde se decide. Todo lo demás —rutas, wizard,
listado, ficha— consume su salida. No hay un segundo criterio en el front.

No hay migración: los cinco datos que hacen falta ya están en la BD.

| Dato | Dónde vive |
|---|---|
| `configurado` | `Agent.tenantId`, `Agent.systemPrompt` (vía `checkPublishPreconditions`) |
| `publicado` | `Agent.status`, `Agent.publishedAt` |
| `alcanzable` | `Agent.widgetInstalledAt`, `ChannelConnection.status` |
| `probado` | `Conversation.isTest`, `Conversation.createdAt` |

## 2. Arquitectura

```
back/src/lib/agent/onboarding.ts      ← NUEVO. Función pura. Sin I/O.
  computeOnboardingState(input) → OnboardingState

back/src/lib/agent/service.ts
  listAgents()     → añade onboarding a cada fila
  getAgentDetail() → añade onboarding

front/components/agents/AgentsGrid.tsx  → aviso agregado + chip por tarjeta
front/app/agents/[id]/page.tsx          → checklist en la pestaña Implementación
front/app/agents/new/page.tsx           → dos acciones finales
```

### Contrato

```ts
export const ONBOARDING_STEPS = ["configurado", "publicado", "alcanzable", "probado"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingInput {
  status: string;
  publishedAt: Date | null;
  tenantId: string | null;
  systemPrompt: string | null;
  channel: string;
  widgetInstalledAt: Date | null;
  channelConnections: { provider: string; status: string }[];
  /** Última conversación NO de prueba. `null` si no hay ninguna. */
  lastPublicConversationAt: Date | null;
}

export interface OnboardingState {
  /** Último escalón alcanzado. `null` = ni siquiera está configurado. */
  step: OnboardingStep | null;
  configurado: boolean;
  publicado: boolean;
  alcanzable: boolean;
  probado: boolean;
  /** Lo que impide avanzar al siguiente escalón, en una frase. */
  nextLabel: string | null;
  /** Pestaña de la ficha donde se resuelve. `null` si no queda nada. */
  nextTab: "datos" | "canales" | "implementacion" | null;
  blocking: string[];
  warnings: string[];
}
```

## 3. La regla de cada escalón

**Monotonía (AC2).** Se evalúan en cascada: un escalón sólo puede ser `true` si
el anterior lo es. Un agente en `draft` con el widget instalado NO es
`alcanzable`, porque no está publicado y por tanto no atiende
(`isServable(status)` es falso para todo lo que no sea `published`).

```ts
const configurado = checkPublishPreconditions(input).blocking.length === 0;
const publicado   = configurado && isServable(input.status) && input.publishedAt !== null;
const alcanzable  = publicado && (
  input.widgetInstalledAt !== null ||
  input.channelConnections.some((c) => c.status === "active")
);
const probado = alcanzable &&
  input.lastPublicConversationAt !== null &&
  input.lastPublicConversationAt > input.publishedAt!;
```

**Por qué `publishedAt !== null` además del status.** `publishedAt` es la PRIMERA
publicación y no se pisa al republicar (`schema.prisma:305`). Sin él no se puede
comparar contra la conversación, y un `published` sin `publishedAt` sería un dato
roto que no debe contar como publicado.

**Por qué `probado` mira `lastPublicConversationAt > publishedAt`.** Las
conversaciones anteriores a la publicación son de la consola de pruebas o de
tráfico antiguo; no demuestran que el agente esté atendiendo AHORA.

**Qué NO significa `probado`.** `isTest = false` sólo excluye la consola de
pruebas del operador. No prueba que quien escribió fuese un cliente real: el
propio dueño puede abrir el widget. Por eso el copy dice **«ha recibido
tráfico»**, nunca «lo usó un cliente». Esto es deliberado y va escrito en la UI.

**Por qué `suspended` no es `publicado`.** `isServable` sólo acepta `published`.
Un agente suspendido se sigue facturando (`BILLABLE_STATUSES`) pero no atiende;
mezclar ambas cosas es exactamente el error que este cambio viene a corregir.

**El canal declarado sigue siendo un aviso, no un bloqueo.** `alcanzable` no
exige que el canal declarado tenga conexión: 3 de los agentes que sirven tráfico
declaran `whatsapp` sin conexión y atienden por widget. El warning existente de
`checkPublishPreconditions` se propaga tal cual en `warnings`.

## 4. De dónde sale `lastPublicConversationAt`

El problema: es una comparación por fila (`createdAt > publishedAt` de ESE
agente), y Prisma no deja referenciar una columna de la fila padre dentro del
`where` de un `_count` de relación.

- **Detalle** (`getAgentDetail`, un agente): `conversation.findFirst` con
  `where: { agentId, isTest: false }`, `orderBy: { createdAt: "desc" }`,
  `select: { createdAt: true }`.
- **Listado** (`listAgents`, N agentes): **una** consulta
  `conversation.groupBy({ by: ["agentId"], where: { isTest: false }, _max: { createdAt: true } })`
  y un `Map` en memoria. Una consulta extra en total, no N. Nada de N+1.

`listAgents` ya trae `_count.conversations` con `isTest: false`; hay que añadir a
su `include`/`select` los campos `publishedAt`, `widgetInstalledAt`, `tenantId`,
`systemPrompt` y `channelConnections { provider, status }`.

## 5. El wizard (F2)

Hoy: `submit()` hace `POST /api/agents` y luego
`router.push('/agents/${id}?tab=integraciones')` con el agente en `draft`
(`new/page.tsx:271`).

**Decisión: dos acciones, un solo camino de transición.** Publicar desde el
wizard es `POST /api/agents` seguido de `POST /api/agents/:id/publish`. No se
añade un parámetro `publish: true` al `POST /api/agents` ni un segundo sitio que
mueva el estado. Razón: `transitionAgentStatus` es quien escribe el
`AgentStatusEvent` y la auditoría de facturación tiene que seguir teniendo un
solo origen (AC6). Además `PATCH /api/agents/:id` ya rechaza explícitamente el
campo `status` (`agents.ts:163-166`) — el diseño existente ya dice que el estado
no se cambia por atajos.

Coste: dos llamadas. A cambio, cero duplicación del camino crítico de dinero.

**Fallo parcial.** Si el `POST /api/agents` va bien y el `publish` falla, el
agente EXISTE en `draft`. Se navega a la ficha y se muestra el error del publish
allí. No se borra el agente ni se reintenta en bucle: perder el trabajo del
wizard por un fallo de red sería peor que dejarlo en borrador.

**Qué botón es cuál.**
- «Crear y publicar» — principal. Debajo, una línea: *empieza a atender al
  público y entra en la facturación del cliente*.
- «Crear como borrador» — secundario. *No atiende a nadie todavía. Puedes
  probarlo desde la consola.*

Si faltan precondiciones (sin cliente, sin prompt) la acción de publicar se
deshabilita y se dice cuál falta. El wizard ya pide cliente en el paso 1, así que
en la práctica esto sólo salta si el prompt sale vacío.

**Lo que no cambia.** Los 4 pasos, la validación por paso, el borrador local y
`clearDraft`. Sólo cambia el remate.

## 6. Señal agregada (F3)

El aviso vive en `AgentsGrid`, que ya lo usan **las dos** pantallas (`/agents` y
el dashboard, que la renderiza con `limit`). Un componente, un criterio, dos
sitios. No se toca `GET /api/stats` para no crear un segundo contador con su
propia definición.

El número se deriva de los booleanos que da el backend
(`agents.filter(a => !a.onboarding.alcanzable).length`). El front cuenta, pero no
decide: el criterio sigue viviendo sólo en `onboarding.ts`.

Copy: **«N agentes no atienden a nadie»** con enlace al primero. Si N es 0 no se
pinta nada.

## 7. Checklist en la ficha (F4)

En la pestaña Implementación, los cuatro escalones con su estado y **una sola**
acción para el primero pendiente, tomada de `nextLabel` / `nextTab`. No se
sustituye el aviso de borrador que ya existe en `page.tsx:119-134`; se le añade
el checklist debajo para que el siguiente paso sea visible incluso cuando el
agente ya está publicado.

## 8. Estrategia de pruebas

- `back/tests/agent-onboarding-state.test.ts` — la función pura. Sin BD, sin red.
  Cubre monotonía, las dos vías de `alcanzable`, y las dos exclusiones de
  `probado` (anterior a `publishedAt`, `isTest`).
- `back/tests/agents-onboarding-route.test.ts` — que `GET /api/agents` y
  `GET /api/agents/:id` devuelven el mismo `onboarding` para el mismo agente
  (AC1) y que el `groupBy` no rompe el listado con cero conversaciones.
- `back/tests/agent-publish-routes.test.ts` (existente) — se amplía para GWT1/GWT3.
- Front: `npm run typecheck`. La suite e2e del front **no** se ejecuta desde aquí
  (el runner levanta `next dev` sobre la carpeta del usuario y corrompe `.next`).

## 9. Riesgo de rendimiento

`listAgents` pasa de 1 consulta a 2, y añade `channelConnections` al `include`.
Con 11 agentes y 36 conversaciones en producción es irrelevante. El `groupBy` no
tiene `where` por agente, así que escala con el número de conversaciones de la
plataforma, no con el de agentes; si algún día eso duele, se acota con
`agentId: { in: ids }`. Se deja escrito, no se preoptimiza.
