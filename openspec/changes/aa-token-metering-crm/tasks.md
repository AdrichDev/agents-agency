# Tareas — generación IA del CRM vía AA
## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 0-20 restantes; implementaci?n principal ya marcada como hecha |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | PR ?nico / verificaci?n de entorno |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending (no aplica: sin cadena recomendada) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Cerrar configuraci?n y smoke CRM?AA | PR ?nico | No marcar smoke/env como completo hasta ejecutarlo con variables reales. |


- [x] T1. `lib/public-routes.ts`: `SERVICE_RULES` + `isServiceCall(method, path, authHeader, serviceToken?)` (DI, timingSafeEqual, false si no hay token).
- [x] T2. `index.ts` gate: atajo `if (isServiceCall(...)) return next()` antes de la verificación JWT. Sin falsear req.user.
- [x] T3. `routes/ai.ts`: `runGeneration(prompt, model?, effort?)` (reasoning_effort solo gpt-5*, minimal→low) + handlers `POST /ai/marketing-plan` y `POST /ai/generate` → `{content, usage}`.
- [x] T4. Tests `tests/public-routes.test.ts`: isServiceCall (token ok+path ok→true; token malo→false; path no-servicio/método→false; sin token→false; sin Bearer→false).
- [x] T5. (Usuario) definir `AA_SERVICE_TOKEN` en AA back y CRM front (+ `AA_API_URL`). Verificado por presencia de variables sin imprimir secretos (2026-07-04).

## Verificación
- [x] tsc limpio.
- [x] vitest 543/3skip (incluye `tests/public-routes.test.ts`, 2026-07-04).
- [x] Smoke OpenAI real: gpt-5.4-mini → content + usage.total_tokens OK.
- [ ] (Tras setear env) smoke end-to-end CRM→AA: botón "Generar con IA" devuelve contenido.
