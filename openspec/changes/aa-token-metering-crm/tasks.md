# Tareas — generación IA del CRM vía AA

- [x] T1. `lib/public-routes.ts`: `SERVICE_RULES` + `isServiceCall(method, path, authHeader, serviceToken?)` (DI, timingSafeEqual, false si no hay token).
- [x] T2. `index.ts` gate: atajo `if (isServiceCall(...)) return next()` antes de la verificación JWT. Sin falsear req.user.
- [x] T3. `routes/ai.ts`: `runGeneration(prompt, model?, effort?)` (reasoning_effort solo gpt-5*, minimal→low) + handlers `POST /ai/marketing-plan` y `POST /ai/generate` → `{content, usage}`.
- [x] T4. Tests `tests/public-routes.test.ts`: isServiceCall (token ok+path ok→true; token malo→false; path no-servicio/método→false; sin token→false; sin Bearer→false).
- [ ] T5. (Usuario) definir `AA_SERVICE_TOKEN` en AA back y CRM front (+ `AA_API_URL`).

## Verificación
- [x] tsc limpio.
- [x] vitest 427/3skip (5 nuevos).
- [x] Smoke OpenAI real: gpt-5.4-mini → content + usage.total_tokens OK.
- [ ] (Tras setear env) smoke end-to-end CRM→AA: botón "Generar con IA" devuelve contenido.
