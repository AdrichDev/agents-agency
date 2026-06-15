# Tasks — Rate Limit Reinforce

## Fase 1
- [x] 1.1 `limiters.ts`: helper `num(env,default)`; límites por env; `heavyLimiter` (default 10/min)

## Fase 2
- [x] 2.1 `skills.ts`: `heavyLimiter` en POST
- [x] 2.2 `market-studies.ts`: `heavyLimiter` en POST `/`, `/:id/generate`, `/:id/sections/:key/regenerate`
- [x] 2.3 `landing.ts`: `heavyLimiter` en generate

## Fase 3
- [x] 3.1 `back`: `tsc --noEmit` + `vitest` (352) verdes
- [x] 3.2 Arranque real: server boota limpio
