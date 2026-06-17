# Tasks — API Foundations (error & validation)

## Fase 1 — Cimientos
- [x] 1.1 `back/src/lib/http.ts`: clase `HttpError` (status, code?, details?)
- [x] 1.2 `asyncHandler(fn)` que reenvía errores a `next`
- [x] 1.3 `validate.body/query/params(schema)`: middleware Zod → `HttpError(400, VALIDATION_ERROR, details)` y `req.validated*`

## Fase 2 — Envelope
- [x] 2.1 `errorHandler` (observability.ts): respuesta `{ error: string, code?, details?, requestId }`; `code`/`details` solo en 4xx

## Fase 3 — Router de referencia (clients)
- [x] 3.1 `clients`: handlers con `asyncHandler`, validación con `validate`, 404 con `HttpError`
- [x] 3.2 Mapear `P2025` del borrado a `HttpError(404)`

## Fase 4 — Verificación
- [x] 4.1 `back`: `tsc --noEmit` + `vitest` (345) verdes
- [x] 4.2 Arranque real: server boota limpio, `/health` ok, gate devuelve envelope `{error}`; mapeo 404/validación verificado por código+tipos (flujo autenticado no smoke-testeado por falta de sesión)
