# Tasks — HTTP Caching

## Fase 1 — Utilidad
- [x] 1.1 `back/src/lib/cache.ts`: `buildCacheControl(opts)`, `setCache(res, opts)`, `cacheControl(opts)` middleware

## Fase 2 — Aplicación
- [x] 2.1 `routes/ai.ts`: `setCache` en `GET /widget/config` (solo rama de éxito)
- [x] 2.2 `routes/sectors.ts`: `cacheControl({ maxAge: 30 })` (private) en `GET /`

## Fase 3 — Tests + verificación
- [x] 3.1 `back/tests/cache.test.ts`: unit del helper (7 tests: public/private, swr, GET vs no-GET)
- [x] 3.2 `back`: `tsc --noEmit` + `vitest` (352) verdes
- [x] 3.3 Arranque real: error de `widget/config` (400) SIN `Cache-Control` (errores no cacheados); éxito cubierto por unit test + código (no había publicKey válido para el 200 en vivo)
