# Tasks — API Rollout Batch 3

## Fase 1 — landing
- [x] 1.1 `landing`: handlers en `asyncHandler`; body → `validate.body`/`HttpError`; 404 con `HttpError`; lógica de generación intacta

## Fase 2 — knowledge / integrations
- [x] 2.1 `knowledge`: handlers async en `asyncHandler`; 404 con `HttpError`
- [x] 2.2 `integrations`: handlers async en `asyncHandler`; 404 con `HttpError`; flujos OAuth intactos

## Fase 3 — Verificación
- [x] 3.1 `back`: `tsc --noEmit` + `vitest` (352) verdes
- [x] 3.2 Arranque real: server boota limpio; `contacts`/`market-studies` sin tocar
