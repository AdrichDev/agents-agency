# Propuesta — API Rollout Batch 2 (agents, skills, automations, stats)

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 4 (buenas APIs)

## Intención

Segundo lote de la migración al patrón `api-foundations` (tras batch-1:
config/sectors/budgets). Se migran `agents`, `skills`, `automations` y `stats`:
todos sin tests de handler directo y con el patrón viejo de validación
(`{ error: flatten() }`).

Objetivo: validación de entrada uniforme en boundaries, sin errores async que
cuelguen la petición, y errores con envelope consistente. Comportamiento
observable preservado.

Casos con matiz (no todo encaja en `validate.body` como middleware):
- **stats**: valida la **query** (no el body) → `validate.query` o inline con
  `HttpError`.
- **skills**: handler tipo *action-switch* con varios esquemas según la acción →
  mantener `safeParse` inline pero lanzar `HttpError(400, VALIDATION_ERROR,
  details)` en vez de `res.status(400).json(flatten())`.

## Fuera de alcance (diferido)

| Tema | Motivo |
|------|--------|
| `landing` | 400 líneas, flujo de generación AI; lote propio (batch-3) |
| `contacts`, `market-studies` | Tienen tests de handler directo; requieren reescribir tests |
| `knowledge`, `integrations` | No usan el patrón flatten; revisión aparte |

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/routes/agents.ts` | Modificado | asyncHandler + validate/HttpError; 404 con HttpError |
| `back/src/routes/skills.ts` | Modificado | asyncHandler; validación action-switch → HttpError |
| `back/src/routes/automations.ts` | Modificado | asyncHandler + validate.body; 404 con HttpError |
| `back/src/routes/stats.ts` | Modificado | asyncHandler; validación de query → HttpError |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Romper middlewares (requireRole, limiters) | Media | Conservar el orden de middlewares en cada ruta |
| Cambiar comportamiento en action-switch de skills | Media | Solo cambia el formato del error; la lógica de cada acción intacta |
| Regresión silenciosa | Baja | `vitest` completo + arranque tras el cambio |

## Criterios de éxito

- [x] Los 4 routers usan `asyncHandler`; errores 4xx vía `HttpError`/`validate`.
- [x] Validación inválida → `400` con `error` string + `details`.
- [x] Middlewares existentes (auth/role/limiters) conservados; n8n execute sigue sin devolver 5xx.
- [x] `vitest` (352) y `tsc --noEmit` (back) verdes; server arranca limpio.
