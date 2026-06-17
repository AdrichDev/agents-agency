# Design — API Rollout Batch 3

## Decisiones de arquitectura

### ADR-1 — Mismo patrón que batch-1/2
`asyncHandler` en todos los handlers async; `validate.body(schema)` para body de
un único esquema; `HttpError` para 404/409 y validación inline (query/condicional)
→ `HttpError(400, "Datos inválidos", "VALIDATION_ERROR", flatten())`. Se quitan
`try/catch` que solo daban 500 genérico; se conservan los que mapean errores
específicos.

### ADR-2 — Excluir routers con tests de handler directo
`contacts.ts` y `market-studies.ts` exportan handlers que sus tests invocan
directamente (`handler(req,res)` sin `next`). Envolverlos en `asyncHandler` o
hacer que lancen rompería esos tests. Coste alto, valor bajo (ya validan). Se
excluyen y se documenta. El estándar api-foundations queda para routers nuevos.

### ADR-3 — Conservar flujos OAuth de integrations
`integrations` maneja OAuth; solo se cambia el formato de error y el envoltorio
async. Redirects, intercambio de tokens y middlewares se mantienen idénticos.

## Concerns front / back
- **Back**: `routes/landing.ts`, `routes/knowledge.ts`, `routes/integrations.ts`.
- **Front**: ninguno; `error` sigue string.

## Plan de rollback
Aditivo de patrón. Rollback = revertir el commit.
