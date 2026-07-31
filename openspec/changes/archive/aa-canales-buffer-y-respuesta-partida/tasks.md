# Tasks

## Orden crítico

Lógica pura primero (T1), porque es testeable sin BD ni red y fija el contrato
que consumen los webhooks. La migración (T4) va **después** del código y antes
del front, para que el schema no quede aplicado sirviendo a nada.

---

## T1 — Lógica pura: troceo y buffer

- [x] T1.1 — `back/src/lib/channels/reply-split.ts`: `splitReply(text, maxMessages, opts)`.
      Corte por párrafo → frase. Sobrante al último trozo. Sin I/O.
- [x] T1.2 — `back/src/lib/channels/inbound-buffer.ts`: `bufferInbound(key, text, windowMs, onFlush)`,
      topes `INBOUND_BUFFER_MAX_MS` / `INBOUND_BUFFER_MAX_MESSAGES` / `REPLY_MAX_MESSAGES_CAP`,
      `flushAll()` para el apagado.
- [x] T1.3 — `back/tests/reply-split.test.ts` — GWT3, GWT8.
- [x] T1.4 — `back/tests/inbound-buffer.test.ts` — GWT4, GWT6 (timers falsos de vitest).

## T2 — Enganche en los webhooks

- [x] T2.1 — `whatsapp-webhook.ts`: rama bufferizada. `markProcessed` antes de
      bufferizar (AD6). Camino `inboundBufferMs === 0` **sin tocar**.
- [x] T2.2 — `telegram-webhook.ts`: igual, respetando pairing `/start` y no-texto
      (no bufferizan). `fanOutTelegramToCrm` con el último `updateId` (AD7).
- [x] T2.3 — Envío por trozos con pausa, aplicando el formateador de canal
      **a cada trozo** (AD4).
- [x] T2.4 — `back/tests/channel-inbound-buffer.test.ts` — GWT1, GWT2, GWT7.

## T3 — Apagado limpio

- [x] T3.1 — Registrar `flushAll()` en `SIGTERM`/`SIGINT` en `back/src/index.ts`,
      con tope de espera y log del resultado.
- [x] T3.2 — Test de `flushAll()` — GWT5.

## T4 — Persistencia (GATE HUMANO)

- [x] T4.1 — 3 columnas en `Agent` (`schema.prisma`), aditivas, con los defaults
      de AD2.
- [x] T4.2 — Migración generada y revisada. **NO aplicar en producción sin OK de
      Adrián.**
- [x] T4.3 — Lectura de la config en los webhooks, recortada a los topes al leer
      (AD5).
- [x] T4.4 — `prisma migrate status` limpio en local.

## T5 — Configuración en el panel

- [x] T5.1 — Controles en la ficha del agente: ventana de agrupación, máximo de
      mensajes por respuesta, pausa entre mensajes.
- [x] T5.2 — Validación en la ruta de actualización del agente (rangos = topes).
- [x] T5.3 — Copy que explique el efecto en una línea, sin jerga.
- [x] T5.4 — **Cubierto por test, ya no por vista.** `validation.md` dejaba T5 con
      «verificación visual del panel» y sin fichero. Una comprobación visual no es
      reproducible y caduca en silencio: los tres controles podían desaparecer, dejar
      de viajar en el PATCH o viajar como texto, y la suite seguía verde.
      Test: `front/tests/agent-rhythm-panel.spec.ts`, 4 casos verdes —
      defaults de AD2 (0 / 1), la pausa **solo** existe con la respuesta partida,
      los valores guardados se pintan (5000 / 3 / 2000), el PATCH manda los tres
      campos como **números**, y sin tocar nada «Guardar» está deshabilitado.
      Hizo falta añadir tres `data-testid` al panel (convención del repo, igual que
      `agenda-add-task-*`): sin selector estable el único test posible es por
      posición, que es justo el que pasa en verde cuando ya no prueba nada.
      Mutación (prueba de que los tests muerden): quitar `Number()` del `onChange`
      del buffer → rojo `Expected: 10000 / Received: "10000"`; cambiar la guarda
      `replyMaxMessages > 1 &&` por `true &&` → rojo `Expected: 0 / Received: 1`.
      Revertidas ambas; el diff del componente son exactamente las 3 líneas de
      `data-testid`.

## Verificaciones finales

- [x] V1 — `npm run typecheck` (back y front) exit 0.
- [x] V2 — Suite de back verde, **incluidos los tests de canal existentes sin
      modificar** (prueba de AC2).
- [x] V3 — Suite e2e del front verde: **137/137 passed (1.5m)**, ejecutada el
      2026-07-31. El bloqueo anterior (`next dev` sobre la carpeta del usuario
      corrompe `.next`) se resuelve con el mecanismo ya documentado en el repo:

      ```
      cd front && NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_TELEGRAM_POLLING=on \
        npx next dev -p 3100
      E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test
      ```

      **Gotcha que costó una ejecución en rojo.** `playwright.config.ts:23` enciende
      `NEXT_PUBLIC_TELEGRAM_POLLING=on` en el bloque `webServer`, y ese bloque se
      salta entero cuando hay `E2E_BASE_URL`. Levantar el servidor a mano sin la
      variable deja el kill-switch de egress en su valor de producción (OFF,
      `useTelegramInbox.ts:52`, commit `ba28a65`) y el badge de no leídos nunca
      sube: `telegram-widget.spec.ts:299` falla de forma determinista (3/3 con
      `--repeat-each=3`). No era ni un test caducado ni un fallo de producto — era
      el arranque del runner. Con la variable puesta, verde a la primera.

      Peor que el rojo: con el polling apagado, la aserción de `mergeServerPage`
      (`waitForTimeout(1200)` y el saliente sigue en pantalla) pasa sin ejercitar
      ni un ciclo de refresco. Verde que no prueba nada. Quien levante el servidor
      a mano tiene que poner la variable.
- [x] V4 — Los 8 AC de `validation.md` cubiertos por un test verde cada uno.
- [x] V5 — Ninguna cifra de ahorro de tokens reclamada sin contraste contra
      `aa.uso_tokens`.
