# Tasks — API Rollout Batch 1

## Fase 1 — config
- [x] 1.1 `config`: GET/POST con `asyncHandler`; POST con `validate.body` (conserva `requireRole("admin")`)

## Fase 2 — sectors
- [x] 2.1 `sectors`: GET con `asyncHandler` (conserva `cacheControl`); POST con `validate.body`; error de `createSector` → `HttpError(400)`

## Fase 3 — budgets
- [x] 3.1 `budgets`: GET/GET:id/POST/PUT status con `asyncHandler`; 404 con `HttpError`
- [x] 3.2 `budgets`: validar body de `PUT /:id/status`; `P2002`→409, `P2025`→404

## Fase 4 — Verificación
- [x] 4.1 `back`: `tsc --noEmit` + `vitest` (352) verdes
- [x] 4.2 Arranque real: server boota limpio, sin errores de runtime; gate 401 OK (endpoints tras auth)
