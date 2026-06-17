# Design — Sentry Error Tracking

## Decisiones

### ADR-1 — Guarded por DSN, no-op sin DSN
`lib/sentry.ts` expone `initSentry()` (inicializa solo si `SENTRY_DSN`) y
`captureError(err, ctx)` (no hace nada si no inicializado). Así el código es
inocuo en local y se activa con solo definir la env en despliegue.

### ADR-2 — Captura en el errorHandler, solo 5xx
El `errorHandler` ya es el punto único de errores. Llama a `captureError` solo
para `status >= 500` (los 4xx son esperables: validación, 404…). Adjunta
`requestId` y `status` como contexto, sin el body (evita PII).

### ADR-3 — `tracesSampleRate` configurable
`SENTRY_TRACES_SAMPLE_RATE` (default 0) controla el tracing de performance; 0 =
solo errores. Ajustable en despliegue.

## Rollback
Aditivo. Rollback = revertir el commit (quitar lib/sentry, wiring y dep).
