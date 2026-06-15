# Propuesta — API Rollout Batch 1 (config, sectors, budgets)

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 4 (buenas APIs)

## Intención

Continuación del pilar 4 (tras `api-foundations`, que dejó el patrón + `clients`
como referencia). Se migra un primer lote de routers **sin tests de handler
directo** al patrón estándar: `asyncHandler` + `validate` + `HttpError`. Así la
validación de entrada queda uniforme en los límites del sistema y los errores
salen con el envelope consistente.

Lote 1: `config`, `sectors`, `budgets`.

Mejoras concretas:
- Validación inconsistente (`{ error: flatten() }`, un objeto) → `400` uniforme
  con `error` string + `details`.
- Errores async ya no pueden colgar la petición (`asyncHandler`).
- Mapeo de errores Prisma: `budgets` `P2002` → `409`, `P2025` → `404`.
- `PUT /budgets/:id/status` gana validación de body (antes sin validar).

**Éxito**: los tres routers usan el patrón; comportamiento observable preservado;
sin romper tests (no tienen test de handler directo).

## Fuera de alcance (diferido)

| Tema | Motivo |
|------|--------|
| Migrar `contacts`/`market-studies` | Tienen tests de handler directo; requieren reescribir tests (lote propio) |
| Resto de routers (agents, landing, skills, automations, knowledge, integrations) | Lotes siguientes |

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/routes/config.ts` | Modificado | asyncHandler + validate + HttpError |
| `back/src/routes/sectors.ts` | Modificado | idem (conserva `cacheControl` en GET) |
| `back/src/routes/budgets.ts` | Modificado | idem + P2002→409, P2025→404, validar status |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Cambiar forma de error rompe el front | Baja | `error` sigue string; `details` aditivo |
| Romper lógica financiera de budgets | Media | Comportamiento preservado; totales server-side intactos; suite verde |
| Regresión silenciosa | Baja | `vitest` completo + arranque tras el cambio |

## Criterios de éxito

- [x] `config`, `sectors`, `budgets` usan `asyncHandler` + `validate` + `HttpError`.
- [x] Validación inválida → `400` con `error` string + `details`.
- [x] `budgets`: número duplicado → `409`; status de presupuesto inexistente → `404`.
- [x] `vitest` (352) y `tsc --noEmit` (back) verdes; server arranca limpio.
