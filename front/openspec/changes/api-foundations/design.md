# Design — API Foundations (error & validation)

## Decisiones de arquitectura

### ADR-1 — `HttpError` como contrato de error de dominio
Clase que extiende `Error` con `status`, `code?`, `details?`. Permite que
cualquier capa (router o servicio) exprese semántica HTTP sin acoplarse a
`res`. El `errorHandler` ya leía `status`/`statusCode`; se añade lectura de
`code`/`details`.

### ADR-2 — `asyncHandler` para errores async (Express 4)
Express 4 no captura `throw` en handlers async → la petición queda colgada. El
wrapper `Promise.resolve(fn(req,res,next)).catch(next)` reenvía el error al
`errorHandler`. Se aplica al montar las rutas, no a handlers exportados que se
testean directamente (evita romper tests que invocan el handler sin `next`).

### ADR-3 — `validate` como middleware factory
`validate.body(schema)` / `.query` / `.params` devuelven un middleware que parsea
con Zod; al fallar lanzan `HttpError(400, "Datos inválidos", "VALIDATION_ERROR",
flatten())`. Reemplaza el patrón repetido `safeParse + res.status(400)`. En éxito,
escriben el dato parseado en `req` (p. ej. `req.validatedBody`) para el handler.

### ADR-4 — Envelope retrocompatible
`{ error: string, code?, details?, requestId }`. Se mantiene `error` como string
porque el front lee `(res).error` como texto en varios sitios. `code`/`details`
son aditivos y solo se incluyen en `4xx` (en `5xx` se devuelve genérico para no
filtrar internos). Antes, validación devolvía `{ error: flatten() }` (objeto);
ahora `error` es legible y el detalle va en `details`.

### ADR-5 — `clients` como referencia (no big-bang)
Se migra solo `clients` (sin tests unitarios, bajo acoplamiento). Los routers con
tests de handler directo (`contacts`) NO se tocan en este change para no reescribir
sus 25 tests. La migración del resto será incremental en cambios siguientes.

## Mapeo de errores Prisma
`prisma.client.delete` lanza `P2025` (registro inexistente). En el handler de
borrado se captura y se re-lanza como `HttpError(404)`. El resto de fallos de
Prisma (sin status) caen como `500` genérico vía `errorHandler`.

## Concerns front / back
- **Back**: `lib/http.ts` (nuevo), `lib/observability.ts` (errorHandler), router
  `clients` (migrado). Sin cambios de montaje en `index.ts`.
- **Front**: ninguno. El contrato `error: string` se preserva; `details` es opcional.

## Plan de rollback
Aditivo salvo la firma del envelope. Rollback = revertir el commit: `lib/http.ts`
desaparece, `errorHandler` y `clients` vuelven a su forma previa. Sin estado ni
datos afectados.
