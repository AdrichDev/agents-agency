# Tasks — Graceful Shutdown & DB Pool

## Fase 1 — Pool de BD
- [x] 1.1 `back/src/lib/db.ts`: pasar `{ connectionString, max, idleTimeoutMillis }` desde env (DB_POOL_MAX, DB_POOL_IDLE_MS)

## Fase 2 — Cron y draining
- [x] 2.1 `back/src/lib/cron.ts`: `startAutomationsCron()` devuelve el handle del intervalo
- [x] 2.2 `back/src/lib/observability.ts`: flag `draining` + `setDraining()`; `readyHandler` 503 si draining

## Fase 3 — Shutdown
- [x] 3.1 `back/src/index.ts`: capturar `server` y handle del cron; `shutdown(signal)` idempotente (draining → clearInterval → server.close → $disconnect → exit) con timeout de seguridad (unref)
- [x] 3.2 Registrar `SIGTERM` y `SIGINT`

## Fase 4 — Verificación
- [x] 4.1 `back`: `tsc --noEmit` + `vitest` (352) verdes
- [x] 4.2 Arranque real: server boota, `/ready` db:up; señales/draining verificadas por código (SIGINT POSIX no entregable desde git-bash en Windows → drenado real se valida en Linux/deploy)
