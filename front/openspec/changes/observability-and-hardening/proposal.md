# Propuesta — Observability & Hardening

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **3** (Large) · Pilares: 10, 1, 6 (parcial)

## Intención

Primer corte del epic "app comercial escalable" (spec de 10 pilares), acotado a
lo que aporta valor **en local y single-org** (ver restricción de proyecto): el
pilar 10 **Observabilidad** (marcado como el más crítico) y el pilar 1
**Hardening de frontend**. Se posponen RLS (2), deploy/hardening cloud (5/6),
caché distribuida y escala 1000+ (7/8/9) por ser prematuros sin producción ni
multi-tenancy.

Alcance:

1. **Logging estructurado**: logger `pino` central (pretty en dev, JSON en prod)
   con redacción de secretos; un log por request con **correlation id**
   (`x-request-id`) y nivel según status code.
2. **Sondas de salud**: `GET /health` (liveness) y `GET /ready` (readiness con
   ping a BD → 503 si la BD no responde), fuera del gate `/api`.
3. **Manejo de errores centralizado**: handler de errores final que registra y
   devuelve JSON seguro (sin filtrar detalles internos en 5xx) + captura de
   `unhandledRejection`/`uncaughtException` con log en vez de crash silencioso.
4. **Hardening de frontend**: source maps de navegador desactivados de forma
   explícita en producción y auditoría de que ninguna variable `NEXT_PUBLIC_*`
   exponga secretos.

**Éxito**: cada petición es trazable por `x-request-id`; un fallo de la API se
registra con contexto y no tumba el proceso; el bundle de producción no expone
código fuente ni llaves.

## Fuera de alcance (diferido)

| Pilar | Motivo |
|-------|--------|
| 2 RLS | App es single-org; sin multi-tenancy no aplica aún |
| 5/6 Deploy + hardening cloud | No se va a producción todavía (local) |
| 7/8/9 Redis + escala 1000+ | Limiter/caché in-memory bastan en local single-org |
| Sentry/APM SaaS | Requiere DSN/cuenta; se deja preparado el punto de enganche |

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/lib/logger.ts` | Nuevo | Logger pino con redacción de secretos |
| `back/src/lib/observability.ts` | Nuevo | httpLogger, health/ready, notFound, errorHandler |
| `back/src/index.ts` | Modificado | Wiring de logger, sondas, error handler, crash guards |
| `back/package.json` | Modificado | Deps `pino`, `pino-http`, `pino-pretty` (dev) |
| `front/next.config.mjs` | Modificado | `productionBrowserSourceMaps: false` explícito |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Logs filtran tokens/cookies | Media | `redact` de pino sobre authorization/cookie/password/token/apiKey |
| Error handler oculta causa real | Baja | Loguea `err` completo server-side; solo el cliente recibe mensaje genérico en 5xx |
| `pino-pretty` en prod (lento) | Baja | Transport pretty solo si `NODE_ENV !== production` |

## Criterios de éxito

- [x] Cada respuesta incluye header `x-request-id` y genera un log de request.
- [x] `GET /health` responde `ok`; `GET /ready` responde `503` si la BD cae.
- [x] Error no capturado en una ruta → log con contexto + JSON 500 seguro.
- [x] `unhandledRejection`/`uncaughtException` se registran sin crash silencioso.
- [x] Build de producción del front sin source maps de navegador.
- [x] `vitest` (back) y `tsc --noEmit` (back+front) verdes; `next build` ok.
