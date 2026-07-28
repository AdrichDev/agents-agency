# Tasks — aa-bug-generar-prompt-redirect

## Fase A — Investigación (bloqueante)
- [~] A.1 Reproducir el 401 con sesión real: NO reproducible en este entorno (sin credenciales/back con sesión viva). Sustituido por análisis de código + T0 backend + **instrumentación** (`lib/api.ts`, log no-sensible del delta de expiración en el 401) que confirmará/refutará el diagnóstico en la próxima ocurrencia real. Cierre pendiente de esa evidencia.
- [x] A.2 Causa raíz CONFIRMADA (T0 backend `back/src/index.ts:112-167`, `back/src/routes/landing.ts:175-188`): 401 **legítimo**, no específico de prompts — `prompts` y `regenerate` están protegidos idénticamente. Gatillo: el token expira durante el chat largo del decálogo (prompts = primer click tras idle) y `getSession()` en `lib/api.ts` no refresca proactivamente. **NO requiere fix backend.**

## Fase B — Fix del interceptor (front)
- [x] B.1 `front/lib/api.ts`: `getToken()` refresca proactivamente vía `refreshSession()` cuando el token está a <60s de expirar → elimina el 401 en el caso común (token expirado + refresh válido). Si el refresh también falla → 401 tratado como sesión realmente caducada.
- [~] B.2 Preservado el contexto con `?returnTo=<ruta>` en la redirección (en vez de `/` pelado). **Aviso visible ("sesión expirada") + consumo del returnTo por el modal de login queda acoplado a `aa-bug-acceso-sin-sesion`** (aún no implementado); el param queda inerte hasta entonces (forward-compatible).
- [x] B.3 Suite e2e completa verde (7/7), sin regresión en el path 401 (test `api-401-returnto.spec.ts` cubre 401→returnTo y no-bucle en `/`).
  - ⚠️ CAVEAT (Devil's Advocate): el test cubre el **interceptor** (returnTo), NO el **refresco proactivo** — front no tiene runner unit y montar un token real por-expirar en Playwright es frágil. El refresco queda sin cobertura automatizada → C.3 manual obligatorio.

## Revisión (AgenticRuntime + Devil) — aplicada
- [x] Agentic Runtime 🟡: `expires_at` undefined → refrescaba en cada llamada. CORREGIDO (skip refresh si no hay expires_at).
- [x] Agentic Runtime 🔵: `returnTo` anidado doble-encode. CORREGIDO (`URL.searchParams.delete("returnTo")` antes de reencodear).
- [ ] Agentic Runtime ❓: validar `returnTo` como path relativo en el CONSUMIDOR (login modal) → responsabilidad de `aa-bug-acceso-sin-sesion`. Anotado. — deuda reasignada al cambio `aa-bug-acceso-sin-sesion`, que sigue activo y abierto
- [~] Devil: diagnóstico (token expira en idle) es hipótesis FUERTE pero NO reproducida con sesión real. El fix es **mitigación + defensa en profundidad**, no cierre probado de causa raíz. Si el 401 tuviera otra causa (clock skew, sub sin fila aa.User), el refresco no ayuda — pero el returnTo hace el fallo no-destructivo igual.

## Fase C — Verificación
- [x] C.1 `npm run typecheck` limpio.
- [x] C.2 `npm run test:e2e` verde 7/7 (2 tests nuevos: `tests/api-401-returnto.spec.ts`).
- [ ] C.3 Verificación manual del flujo completo "Generar prompt" con sesión real (pendiente: requiere entorno con back + sesión). — ⏳ GATE HUMANO: verificación manual del flujo "Generar prompt" con sesión real y el backend levantado

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [x] Agentic Runtime PASS. — verificado: el commit `2bd9f24` ("fix(front): refresh token proactively and preserve returnTo on 401") está mergeado en `master` con su test e2e

## Cierre — 28/07/2026

Cierre con una verificación manual pendiente (C.3) y una deuda reasignada al cambio `aa-bug-acceso-sin-sesion`, que permanece activo. El arreglo del refresco de token y la preservación de `returnTo` está mergeado en `master`.
