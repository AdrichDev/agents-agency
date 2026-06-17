# Tasks — Observability & Hardening

## Fase 1 — Backend: logging
- [x] 1.1 Deps `pino`, `pino-http` (prod) + `pino-pretty` (dev)
- [x] 1.2 `back/src/lib/logger.ts`: instancia pino (pretty en dev, JSON en prod) + `redact` de secretos
- [x] 1.3 `back/src/lib/observability.ts`: `httpLogger` (pino-http) con `genReqId` (`x-request-id`) y `customLogLevel` por status

## Fase 2 — Backend: sondas y errores
- [x] 2.1 `healthHandler` (liveness) + `readyHandler` (readiness con `SELECT 1`, 503 si falla)
- [x] 2.2 `notFoundHandler` (404 JSON para `/api`) + `errorHandler` central (JSON seguro, sin filtrar 5xx)
- [x] 2.3 Wiring en `index.ts`: `httpLogger` tras helmet, `/health` y `/ready` antes del gate, `notFound`+`errorHandler` al final
- [x] 2.4 Crash guards: `process.on("unhandledRejection"|"uncaughtException")` con log

## Fase 3 — Frontend: hardening
- [x] 3.1 `front/next.config.mjs`: `productionBrowserSourceMaps: false` explícito
- [x] 3.2 Auditar variables `NEXT_PUBLIC_*`: solo `NEXT_PUBLIC_API_URL` (URL pública, no secreto) → OK

## Fase 4 — Verificación
- [x] 4.1 `back`: `tsc --noEmit` + `vitest` verdes (345 tests)
- [x] 4.2 Arranque real: `/health` ok, `/ready` db:up, header `x-request-id` presente
- [x] 4.3 `front`: `tsc --noEmit` + `next build` verdes tras el cambio de config
