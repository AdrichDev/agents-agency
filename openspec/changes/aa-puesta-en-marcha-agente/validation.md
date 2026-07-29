# Validación

## Historia de usuario

Como propietario de la plataforma, quiero que crear un agente termine en un agente
publicado y alcanzable, y ver de un vistazo cuáles de mis agentes no atienden a
nadie, para que ninguno se quede olvidado en borrador ganando cero.

## Criterios de aceptación

- **AC1** — El estado de puesta en marcha de un agente se calcula en un único
  lugar del backend y lo consumen tanto `GET /api/agents` como
  `GET /api/agents/:id`. No hay dos criterios distintos para el mismo agente.
- **AC2** — Los cuatro escalones son ordenados y monótonos: un agente no puede
  estar `alcanzable` sin estar `publicado`, ni `probado` sin estar `alcanzable`.
- **AC3** — `alcanzable` es verdadero si el widget ha hecho ping alguna vez
  (`widgetInstalledAt != null`) **o** existe ≥1 `ChannelConnection` con
  `status = "active"`.
- **AC4** — `probado` es verdadero si existe ≥1 conversación con `isTest = false`
  creada después de `publishedAt`.
- **AC5** — El wizard ofrece dos acciones finales distintas y explícitas. La de
  publicar sólo aparece si las precondiciones de publicación se cumplen; si no,
  se explica cuál falta y sólo queda crear como borrador.
- **AC6** — Publicar desde el wizard produce exactamente el mismo efecto que
  `POST /api/agents/:id/publish`: un `AgentStatusEvent` y `publishedAt` fijado.
  No hay un segundo camino de transición de estado.
- **AC7** — El listado de agentes y el dashboard muestran cuántos agentes no
  alcanzan el escalón `alcanzable`. El número se deriva de los booleanos que
  devuelve el backend; el front cuenta pero no reimplementa el criterio.
- **AC8** — La ficha del agente muestra el siguiente escalón pendiente y una
  acción concreta para resolverlo.
- **AC9** — Regresión cero en el flujo actual: crear como borrador deja el agente
  exactamente igual que hoy (`draft`, sin `publishedAt`, sin evento de estado).

## Escenarios

### GWT1 — El wizard publica (AC5, AC6)
- **Dado** un agente nuevo con cliente asignado y prompt no vacío,
- **cuando** el operador pulsa «Crear y publicar»,
- **entonces** el agente queda en `status = "published"`, con `publishedAt`
  fijado y un `AgentStatusEvent` `draft → published`.

### GWT2 — El wizard no publica lo que no se puede publicar (AC5)
- **Dado** un agente nuevo sin cliente asignado,
- **cuando** se llega al último paso del wizard,
- **entonces** la acción de publicar no está disponible y se dice que falta el
  cliente.

### GWT3 — Crear como borrador no cambia nada (AC9)
- **Dado** un agente nuevo con todo relleno,
- **cuando** el operador pulsa «Crear como borrador»,
- **entonces** el agente queda en `draft`, `publishedAt` es `null` y no se
  registra ningún `AgentStatusEvent`.

### GWT4 — Escalones monótonos (AC2)
- **Dado** un agente en `draft` con `widgetInstalledAt` no nulo,
- **cuando** se calcula su puesta en marcha,
- **entonces** `alcanzable` es falso, porque `publicado` es falso.

### GWT5 — Alcanzable por canal (AC3)
- **Dado** un agente publicado sin ping de widget y con una `ChannelConnection`
  de WhatsApp en `status = "active"`,
- **cuando** se calcula su puesta en marcha,
- **entonces** `alcanzable` es verdadero.

### GWT6 — Alcanzable por widget (AC3)
- **Dado** un agente publicado con `widgetInstalledAt` no nulo y cero conexiones,
- **cuando** se calcula su puesta en marcha,
- **entonces** `alcanzable` es verdadero.

### GWT7 — Probado ignora lo anterior a la publicación (AC4)
- **Dado** un agente publicado hoy con conversaciones no-test creadas **antes** de
  `publishedAt`,
- **cuando** se calcula su puesta en marcha,
- **entonces** `probado` es falso.

### GWT8 — Probado ignora la consola de pruebas (AC4)
- **Dado** un agente publicado cuya única conversación posterior tiene
  `isTest = true`,
- **cuando** se calcula su puesta en marcha,
- **entonces** `probado` es falso.

### GWT9 — El contador agregado (AC7)
- **Dado** un tenant con 3 agentes: uno probado, uno publicado sin alcance y uno
  en borrador,
- **cuando** el front pide el listado,
- **entonces** el backend informa de 2 agentes que no atienden a nadie.

## Mapa test ↔ tarea

| Tarea | Test | Escenario |
|---|---|---|
| T1.1 | `back/tests/agent-onboarding-state.test.ts` | GWT4, GWT5, GWT6, GWT7, GWT8 |
| T1.2 | `back/tests/agent-onboarding-state.test.ts` | AC2 (monotonía) |
| T2.1 | `back/tests/agents-onboarding-route.test.ts` | AC1, GWT9 |
| T3.1 | `back/tests/agent-publish-routes.test.ts` (existente, ampliado) | GWT1, GWT3, AC6 |
| T4.1 | typecheck + revisión visual | AC5 |
| T5.1 | typecheck + revisión visual | AC7, AC8 |
