# Propuesta — API Rollout Batch 3 (landing + cierre)

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 4 (buenas APIs)

## Intención

Cierre del rollout del pilar 4. Se migra `landing` (el router grande restante con
el patrón viejo) al patrón `api-foundations` (`asyncHandler` + `validate` +
`HttpError`), y se repasan `knowledge` e `integrations` para envolver handlers
async en `asyncHandler` y expresar 404 con `HttpError` donde aplique.

## Excepción documentada (no se migran)

`contacts` y `market-studies` tienen **tests de handler directo** que invocan los
handlers sin `next` y asertan `res.status(...)`. Migrarlos a `asyncHandler`+throw
exigiría reescribir ~48 tests con poco valor: **ya validan con Zod y devuelven
errores estructurados**. Decisión (devil's advocate): se dejan como están; el
patrón api-foundations queda como estándar para routers nuevos y para los ya
migrados (clients, config, sectors, budgets, agents, skills, automations, stats).

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/routes/landing.ts` | Modificado | asyncHandler + validate/HttpError; 404 con HttpError |
| `back/src/routes/knowledge.ts` | Modificado | asyncHandler + HttpError donde aplique |
| `back/src/routes/integrations.ts` | Modificado | asyncHandler + HttpError donde aplique |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| `landing` tiene lógica de generación AI compleja | Media | Solo cambia validación/errores; la lógica de generación intacta |
| OAuth de integrations sensible | Media | Conservar flujos/middlewares; solo formato de error |
| Regresión silenciosa | Baja | `vitest` completo + arranque |

## Criterios de éxito

- [x] `landing` usa `asyncHandler` + `validate`/`HttpError`; lógica preservada.
- [x] `knowledge`/`integrations`: handlers async envueltos; 404 con `HttpError`.
- [x] `vitest` (352) y `tsc --noEmit` (back) verdes; server arranca limpio.
- [x] `contacts`/`market-studies` sin tocar (excepción documentada).
