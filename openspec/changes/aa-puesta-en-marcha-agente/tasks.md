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
- [x] T3.5 — Ampliar `back/tests/agents-publish.test.ts` — GWT1, GWT3, AC6.

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
- [ ] V3 — Los 9 AC de `validation.md` con un test verde o, para los de UI
      (AC5, AC7, AC8), typecheck + revisión visual declarada como tal.
- [x] V4 — Ningún agente de producción publicado como efecto colateral. El
      cambio afecta al flujo, no a los datos existentes.
- [ ] V5 — Ninguna afirmación de «arreglado» sin la evidencia del test o de la
      consulta que la respalda.
