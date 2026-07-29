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

## Verificaciones finales

- [x] V1 — `npm run typecheck` (back y front) exit 0.
- [x] V2 — Suite de back verde, **incluidos los tests de canal existentes sin
      modificar** (prueba de AC2).
- [ ] V3 — Suite e2e del front verde. **NO EJECUTADA**: el runner levanta
      `next dev` sobre la carpeta del usuario (corrompe `.next`). Ningún spec toca
      el panel de ajustes del agente y el typecheck de front pasa; queda pendiente
      de una ejecución explícita.
- [x] V4 — Los 8 AC de `validation.md` cubiertos por un test verde cada uno.
- [x] V5 — Ninguna cifra de ahorro de tokens reclamada sin contraste contra
      `aa.uso_tokens`.
