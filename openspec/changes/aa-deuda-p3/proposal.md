# Propuesta — aa-deuda-p3 (refactor mantenibilidad, SIN cambio de comportamiento)

## Intención
Pagar deuda P3 de clean-code/clean-arch en agents-agency detectada por auditoría Agentic Runtime.
Refactor PURO: contratos REST, respuestas y comportamiento NO cambian. Solo estructura.

## Alcance
- **WU3 — rutas finas (back):** `src/routes/landing.ts` (526 LOC) y
  `src/routes/market-studies.ts` (432 LOC) tienen lógica de negocio inline en los
  handlers. Extraer esa lógica a `src/lib/` (p.ej. `lib/landing/*`, `lib/market-study/*`
  ya existen) dejando los handlers finos (parse req → llamar lib → responder). NO cambiar
  rutas, payloads ni status.
- **WU4 — front mantenibilidad:** 
  - Tipar `any` donde el shape de respuesta es conocido (prioriza lib/api y las páginas).
  - Extraer el fetch+estado a hooks (patrón `hooks/useResource.ts` ya existe) en las 2
    páginas peores: `app/configuracion/page.tsx` (561) y `app/clientes/page.tsx` (501),
    partiendo subcomponentes. UI idéntica.

## Fuera de alcance
- Lógica de negocio nueva, auth (ya endurecida), esquema DB. Nada funcional nuevo.

## Riesgo
WU3 medio (cubierto por vitest 422). WU4 medio-alto: el front AA NO tiene unit tests
→ validación = tsc + `next build` + e2e si existe. El builder debe preservar el
comportamiento EXACTO y, ante duda, parar y reportar en vez de adivinar.
