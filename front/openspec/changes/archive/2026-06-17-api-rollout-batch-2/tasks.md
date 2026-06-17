# Tasks — API Rollout Batch 2

## Fase 1 — agents
- [x] 1.1 `agents`: 8 handlers en `asyncHandler`; `validate.body` x4 (create/update/widget/ecommerce); 2 `HttpError(404)`; middlewares conservados

## Fase 2 — automations
- [x] 2.1 `automations`: 7 handlers en `asyncHandler`; create con `validate.body`; 2 `HttpError(404)`; preservados 401/503/200-n8n-execute

## Fase 3 — skills
- [x] 3.1 `skills`: 5 handlers en `asyncHandler`; action-switch inline → `HttpError(400, VALIDATION_ERROR)`; 404 con `HttpError`

## Fase 4 — stats
- [x] 4.1 `stats`: 2 handlers en `asyncHandler`; validación de query inline → `HttpError(400, VALIDATION_ERROR)`

## Fase 5 — Verificación
- [x] 5.1 `back`: `tsc --noEmit` + `vitest` (352, 30 files) verdes
- [x] 5.2 Arranque real: server boota limpio, sin errores de runtime; middlewares intactos
