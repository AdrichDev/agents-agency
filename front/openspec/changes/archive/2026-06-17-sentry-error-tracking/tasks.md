# Tasks — Sentry Error Tracking

## Fase 1
- [x] 1.1 dep `@sentry/node`
- [x] 1.2 `back/src/lib/sentry.ts`: `initSentry()` + `captureError()` guarded por `SENTRY_DSN`

## Fase 2
- [x] 2.1 `index.ts`: `initSentry()` al arranque
- [x] 2.2 `observability.ts`: `errorHandler` captura 5xx vía `captureError`

## Fase 3
- [x] 3.1 `back`: `tsc --noEmit` + `vitest` (352) verdes
- [x] 3.2 Arranque real sin DSN: log "Sentry deshabilitado", server ok
