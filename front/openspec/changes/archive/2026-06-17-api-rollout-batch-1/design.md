# Design — API Rollout Batch 1

## Decisiones de arquitectura

### ADR-1 — Reusar el patrón de `api-foundations`
Cada handler async se envuelve en `asyncHandler`; la validación de body pasa a
`validate.body(schema)` (middleware antes del handler) que escribe
`req.validatedBody`; los 404/409 se expresan con `HttpError`. Los `try/catch` que
solo devolvían `500` genérico se eliminan: el error sube al `errorHandler`.

### ADR-2 — Mapeo selectivo de errores Prisma
Donde el código Prisma tiene semántica HTTP clara se captura y se re-lanza como
`HttpError`: `budgets` `P2002` (unique violation) → `409`, `P2025` (record not
found en update) → `404`. El resto de errores caen como `500` genérico.

### ADR-3 — `validate` preserva defaults de Zod
Los esquemas con `.default()` (p. ej. `budgetCreateSchema.lines`, `vatRate`)
siguen aplicándose: `validate.body` usa `safeParse` y expone `result.data`, que ya
incluye los defaults. El handler lee `req.validatedBody` con el tipo inferido.

### ADR-4 — Middlewares de auth/caché se conservan
`config` mantiene `requireRole("admin")` en el POST; `sectors` mantiene
`cacheControl({ maxAge: 30 })` en el GET. El orden queda: `[auth?] → cache? →
validate? → asyncHandler(handler)`.

## Concerns front / back
- **Back**: `routes/config.ts`, `routes/sectors.ts`, `routes/budgets.ts`. Sin
  cambios de montaje ni de libs.
- **Front**: ninguno; `error` sigue siendo string.

## Plan de rollback
Aditivo de patrón, sin cambios de datos. Rollback = revertir el commit: los
routers vuelven a `safeParse + try/catch`. Sin impacto en datos.
