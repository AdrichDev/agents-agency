# Propuesta — API Foundations (error & validation)

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 4 (buenas APIs)

## Intención

Pilar 4: APIs sólidas y consistentes. Hoy cada router repite el mismo boilerplate
(`safeParse` manual + `try/catch` + `res.status(...).json({error})`) y la forma de
los errores **no es uniforme**: validación devuelve `{ error: flatten() }` (un
objeto), otras rutas devuelven `{ error: "string" }`, y un `throw` async sin
`try/catch` puede colgar la petición (Express 4 no captura errores async).

Se añaden cimientos reutilizables, **aditivos y compatibles con el front**:

1. **`HttpError`**: error tipado con `status`, `code` y `details` opcionales.
2. **`asyncHandler`**: envuelve handlers async y reenvía cualquier error al
   manejador central (`errorHandler`).
3. **`validate`**: helpers Zod (`body`/`query`/`params`) que, al fallar, lanzan
   `HttpError(400, code:"VALIDATION_ERROR", details)`.
4. **Envelope de error consistente** en `errorHandler`:
   `{ error: <mensaje>, code?, details?, requestId }` — `error` sigue siendo un
   **string** (compatibilidad con el front actual).

Se migra el router **`clients`** (sin tests unitarios, candidato seguro) como
**implementación de referencia** del patrón. El resto de routers se migrarán en
cambios posteriores (incremental, sin big-bang).

**Éxito**: un router puede declararse con `asyncHandler` + `validate` + `throw
HttpError`, y todos los errores salen con la misma forma sin filtrar internos.

## Fuera de alcance (diferido)

| Tema | Motivo |
|------|--------|
| Versionado `/api/v1` | Toca el auth gate y las reglas públicas; cambio propio |
| Migrar todos los routers | Incremental; este change deja el patrón + 1 referencia |
| OpenAPI/Swagger | Posterior, una vez estabilizado el contrato de error |

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/lib/http.ts` | Nuevo | `HttpError`, `asyncHandler`, `validate` |
| `back/src/lib/observability.ts` | Modificado | `errorHandler` emite envelope con `code`/`details` |
| `back/src/routes/clients.ts` | Modificado | Migrado al patrón (referencia) |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Romper el parseo de errores del front | Media | `error` se mantiene como string; `code`/`details` son aditivos |
| `asyncHandler` rompe tests que llaman handlers directos | Baja | `clients` no tiene tests; routers testeados (contacts) no se tocan |
| `prisma.delete` de cliente inexistente → 500 | Media | Mapear `P2025` a `HttpError(404)` |

## Criterios de éxito

- [x] `HttpError`, `asyncHandler`, `validate` disponibles en `lib/http.ts`.
- [x] `errorHandler` devuelve `{ error: string, code?, details?, requestId }`.
- [x] `clients` usa el patrón; 400 de validación devuelve `error` string + `details`.
- [x] Borrar cliente inexistente → `404`, no `500` (mapeo `P2025`).
- [x] `vitest` (345) y `tsc --noEmit` (back) verdes; front sin regresión.
