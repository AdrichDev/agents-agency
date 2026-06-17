# Propuesta — Sentry Error Tracking

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 10 (observabilidad, extra)

## Intención

Completar la observabilidad (pilar 10) con captura de errores en Sentry, **guarded
por `SENTRY_DSN`**: si la variable no está definida (caso local actual) es un
**no-op** total. El `errorHandler` central ya concentra los errores → enchufar
`Sentry.captureException` ahí es aditivo y de bajo riesgo. Queda listo para cuando
se despliegue (solo definir `SENTRY_DSN`).

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/lib/sentry.ts` | Nuevo | `initSentry()` + `captureError()` guarded por DSN |
| `back/src/index.ts` | Modificado | `initSentry()` al arranque |
| `back/src/lib/observability.ts` | Modificado | `errorHandler` captura 5xx en Sentry |
| `back/package.json` | Modificado | dep `@sentry/node` |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Sentry rompe el arranque sin DSN | Baja | `initSentry` no hace nada si no hay DSN |
| Enviar datos sensibles a Sentry | Baja | Solo se captura el error + requestId/status; sin body |

## Criterios de éxito

- [x] Sin `SENTRY_DSN`: arranque normal, log "Sentry deshabilitado", no-op.
- [x] Con `SENTRY_DSN`: `initSentry` inicializa; `errorHandler` captura 5xx.
- [x] `vitest` (352) y `tsc --noEmit` (back) verdes.
