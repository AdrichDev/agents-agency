# Tasks

## Orden crítico

La función pura (T1) primero: no necesita BD ni red y fija el contrato que
consumen las rutas. Después las rutas (T2), porque el front no puede pintar lo
que el back no devuelve. El wizard (T3) va antes que la UI de señal (T4-T5)
porque es el arreglo que justifica el cambio; el resto es visibilidad.

Sin migración. Todos los campos existen.

---

## T1 — Función pura de puesta en marcha

- [x] T1.1 — `back/src/lib/agent/onboarding.ts`: `ONBOARDING_STEPS`,
      `OnboardingInput`, `OnboardingState`, `computeOnboardingState()`.
      Sin I/O. Reutiliza `checkPublishPreconditions` e `isServable`.
- [x] T1.2 — Cascada monótona: cada escalón exige el anterior (design §3).
- [x] T1.3 — `nextLabel` / `nextTab` para el primer escalón pendiente.
- [x] T1.4 — `back/tests/agent-onboarding-state.test.ts` — GWT4, GWT5, GWT6,
      GWT7, GWT8 y monotonía (AC2).

## T2 — Exponerlo en las rutas

- [x] T2.1 — `listAgents()`: añadir al `include` `channelConnections
      { provider, status }` y a la selección `publishedAt`, `widgetInstalledAt`,
      `tenantId`, `systemPrompt`. **Una** `conversation.groupBy` por
      `agentId` con `_max: { createdAt }` y `isTest: false` (design §4). Nada de
      N+1.
- [x] T2.2 — `getAgentDetail()`: `findFirst` de la última conversación no-test +
      `onboarding` en la respuesta.
- [x] T2.3 — Verificar que `onboarding` no filtra nada sensible (no incluye
      credenciales de `channelConnections`, sólo `provider` y `status`).
- [x] T2.4 — `back/tests/agents-onboarding-route.test.ts` — AC1 (mismo resultado
      en listado y detalle), GWT9, y listado con cero conversaciones.

## T3 — El remate del wizard

- [x] T3.1 — `front/app/agents/new/page.tsx`: dos acciones finales. «Crear y
      publicar» = `POST /api/agents` + `POST /api/agents/:id/publish`. «Crear
      como borrador» = comportamiento actual sin tocar.
- [x] T3.2 — Fallo parcial: si el publish falla, navegar a la ficha del agente
      creado mostrando el error. No borrar el agente ni reintentar en bucle.
- [x] T3.3 — Deshabilitar «Crear y publicar» si faltan precondiciones, diciendo
      cuál falta (GWT2).
- [x] T3.4 — Copy de una línea bajo cada botón (design §5). El de publicar dice
      explícitamente que entra en la facturación del cliente.
- [x] T3.5 — Ampliar `back/tests/agent-publish-routes.test.ts` — GWT1, GWT3, AC6.
      (El nombre `agents-publish.test.ts` que citaban estos documentos nunca existió:
      correrlo por él ejecutaba dos ficheros de tres sin decir nada.)

## T4 — Señal agregada

- [x] T4.1 — `front/components/agents/AgentsGrid.tsx`: aviso «N agentes no
      atienden a nadie» con enlace al primero. Oculto si N = 0.
- [x] T4.2 — Escalón en la tarjeta de agente junto al `AgentStatusChip`, sin
      duplicar lo que ya dice el chip.

## T5 — Checklist en la ficha

- [x] T5.1 — Pestaña Implementación: los 4 escalones con su estado y UNA acción
      para el primero pendiente (`nextLabel` / `nextTab`).
- [x] T5.2 — Copy del escalón «probado»: **«ha recibido tráfico»**, nunca «lo usó
      un cliente» (design §3).
- [x] T5.3 — No tocar el aviso de borrador existente (`[id]/page.tsx:119-134`);
      el checklist va debajo.

## Verificaciones finales

- [x] V1 — `npm run typecheck` en back y front, exit 0.
- [x] V2 — Suite de back verde, **incluidos los tests de agente existentes sin
      modificar** (prueba de no-regresión de AC9).
- [x] V3 — Los 9 AC de `validation.md` con un test verde. Ver la matriz abajo.
      **AC5, AC7 y AC8 ya no se cierran con «revisión visual»**: los tres hablan
      de lo que ve el operador, y eso se demuestra en el navegador o no se
      demuestra. Tienen tests de Playwright propios.
- [x] V4 — Ningún agente de producción publicado como efecto colateral. El
      cambio afecta al flujo, no a los datos existentes.
- [x] V5 — Ninguna afirmación de «arreglado» sin la evidencia del test o de la
      consulta que la respalda. Cada fila de la matriz nombra el test que se ha
      ejecutado, no el fichero donde «debería» estar cubierto.

---

## Matriz de AC (V3)

Ejecutado el 29/07/2026.

**Back** — `npx vitest run tests/agent-onboarding-state.test.ts
tests/agents-onboarding-route.test.ts tests/agent-publish-routes.test.ts
tests/agent-detail-publish-preconditions.test.ts` → **4 ficheros, 49 tests, 0 rojos**.

**Front** — `E2E_BASE_URL=http://127.0.0.1:3101 npx playwright test
tests/agents-onboarding.spec.ts tests/agent-wizard.spec.ts` → **10 tests, 0 rojos**
(7 de onboarding, 3 del wizard; los 2 originales del wizard también verdes).

| AC | Qué exige | Test verde |
|----|-----------|-----------|
| AC1 | Un solo criterio para listado y ficha | `agents-onboarding-route` → «listado y detalle devuelven el mismo `onboarding` para la misma fila» y «un borrador sale como `configurado` por las dos vías» |
| AC2 | Los escalones no se saltan | `agent-onboarding-state` → describe «monotonía (AC2)» → «los escalones nunca se saltan, sea cual sea la combinación de entrada» (cruza todas las combinaciones, no un caso) + «sin configurar, todo lo demás cae aunque los datos digan que sí» |
| AC3 | Alcanzable por ping de widget **o** conexión de canal activa | `agent-onboarding-state` → «GWT6 — basta el ping del widget, sin ninguna conexión de canal», «GWT5 — basta una conexión de canal activa, sin ping de widget», «una conexión pendiente o en error no alcanza», «publicado sin widget ni canal se queda en `publicado`» |
| AC4 | Probado = tráfico no-test **posterior** a publicar | `agent-onboarding-state` → «GWT7 — el tráfico anterior a la publicación no cuenta», «GWT8 — sin ninguna conversación no-test, no está probado», «el tráfico exactamente en el instante de publicar no cuenta (comparación estricta)» |
| AC5 | Dos acciones explícitas en el wizard | `agent-wizard.spec.ts` → «AC5 — con cliente, las dos acciones están y publicar avisa de la facturación» y «GWT2 — sin cliente no se puede publicar, y se dice por qué». Navegador, no lectura |
| AC6 | Publicar usa la ruta de publicación y deja UN evento | `agent-publish-routes` → «GWT1/AC6 — «Crear y publicar» deja el agente publicado con UN solo evento», «GWT3 — «Crear como borrador» no publica ni deja evento», «AC6 — el alta no publica aunque le metan `status` en el cuerpo». Y desde el navegador: `agent-wizard.spec.ts` → «AC6 — «Crear y publicar» llama a la ruta de publicación, no a un atajo», que comprueba las dos llamadas en orden |
| AC7 | Contador agregado derivado de los booleanos del back | `agents-onboarding-route` → GWT9 «cuenta los que no atienden a nadie, sin recalcular el criterio». En el navegador: `agents-onboarding.spec.ts` → los tres tests de AC7, incluido «un agente sin `onboarding` no se cuenta: mejor callar que inventarse el número» |
| AC8 | La ficha da el siguiente escalón y UNA acción | `agents-onboarding.spec.ts` → los cuatro tests de AC8: borrador, publicado sin alcance, acción en otra pestaña, y todo hecho (ni escalón ni acción) |
| AC9 | Cero regresión al crear borradores | `agent-publish-routes` → GWT3. Y los dos tests originales de `agent-wizard.spec.ts`, que siguen verdes ejerciendo el alta completa (`dataBackend`, `tenantId`, `skillIds`) |

### Matiz de AC8 que el AC no decía, y conviene dejar escrito

AC8 pide «una acción concreta». El panel la pinta de dos formas según dónde viva:

- Si el escalón pendiente se resuelve en **otra** pestaña, sale un botón de salto
  («Ir a Ajustes →» / «Ir a Canales →»). Cubierto por el test «cuando la acción
  vive en otra pestaña, hay botón para ir».
- Si se resuelve en la **misma** pestaña (`nextTab === "implementacion"`), sale
  sólo el texto: el botón que la ejecuta ya está en pantalla. Un botón que te
  lleve a donde ya estás no es una acción, es ruido.

El primer intento de test daba por hecho que siempre había un botón y fallaba.
Fallaba el test, no el producto.

### Cosa menor encontrada de paso, sin arreglar

`front/app/agents/[id]/page.tsx:126-132` pinta «Ir a publicarlo →» para cualquier
borrador, también cuando ya estás en la pestaña Implementación — justo el salto
inútil que el panel de puesta en marcha evita a propósito. No viola ningún AC
(es el aviso previo que T5.3 mandaba **no** tocar) y no se ha cambiado. Queda
anotado para quien retoque ese banner.
