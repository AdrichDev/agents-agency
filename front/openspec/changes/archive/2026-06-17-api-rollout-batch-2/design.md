# Design — API Rollout Batch 2

## Decisiones de arquitectura

### ADR-1 — Dos formas de validación según el caso
- **Body con un único esquema por ruta** (agents create/update, automations
  create) → `validate.body(schema)` middleware + `req.validatedBody`.
- **Query** (stats) o **body condicional / action-switch** (skills) → mantener
  `safeParse` inline pero, en fallo, `throw new HttpError(400, "Datos inválidos",
  "VALIDATION_ERROR", parsed.error.flatten())`. Así el envelope es el mismo sin
  forzar un middleware que no encaja.

### ADR-2 — `asyncHandler` en todos los handlers async
Cada handler async se envuelve en `asyncHandler` para que rechazos/throws lleguen
al `errorHandler`. Se eliminan los `try/catch` que solo devolvían `500` genérico.

### ADR-3 — 404 y errores Prisma con `HttpError`
`res.status(404).json(...)` → `throw new HttpError(404, msg)`. Donde haya update/
delete que pueda lanzar `P2025`, se mapea a `404`; `P2002` a `409`.

### ADR-4 — Middlewares intactos
`requireRole`, limiters de IA y cualquier middleware de ruta se conservan en su
posición. La validación va DESPUÉS de auth/role y ANTES del handler.

## Concerns front / back
- **Back**: `routes/agents.ts`, `routes/skills.ts`, `routes/automations.ts`,
  `routes/stats.ts`. Sin cambios de montaje ni de libs.
- **Front**: ninguno; `error` sigue string.

## Plan de rollback
Aditivo de patrón, sin cambios de datos. Rollback = revertir el commit.
