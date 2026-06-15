# Tasks — Dead Code Cleanup

## Fase 1 — Borrado verificado
- [x] 1.1 Quitar `requireAuth` (auth.ts), `isSentryEnabled` (sentry.ts), `export { z }` (http.ts)
- [x] 1.2 Borrar `back/test_sectors.ts` y `back/updateConfig.cjs`

## Fase 2 — knip
- [x] 2.1 `back/knip.json` con entry/ignore
- [x] 2.2 CI: paso knip no bloqueante (files+dependencies)

## Fase 3 — Verificación
- [x] 3.1 `tsc --noEmit` + `vitest` (352) verdes
