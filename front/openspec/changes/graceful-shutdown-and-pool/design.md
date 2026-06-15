# Design — Graceful Shutdown & DB Pool

## Decisiones de arquitectura

### ADR-1 — `shutdown(signal)` idempotente en index.ts
Un único `shutdown` registrado para `SIGTERM` y `SIGINT`, protegido por un flag
para no ejecutarse dos veces. Secuencia: marcar `draining` → `clearInterval` del
cron → `server.close(cb)` (deja de aceptar conexiones, espera in-flight) → en el
callback `prisma.$disconnect()` → `process.exit(0)`. Un `setTimeout`
(`SHUTDOWN_TIMEOUT_MS`, default 10s) fuerza `exit(1)` si algo se cuelga; se le
hace `unref()` para no mantener vivo el loop.

### ADR-2 — Estado `draining` compartido en observability.ts
`observability.ts` ya posee `readyHandler`. Se añade un flag de módulo
`draining` con `setDraining()`. `readyHandler` devuelve `503` si `draining` es
true (antes de tocar la BD). Así el wiring de readiness vive junto a las sondas.

### ADR-3 — Cron devuelve su handle
`startAutomationsCron()` pasa de no devolver nada a devolver el `NodeJS.Timeout`
del `setInterval`, para poder `clearInterval` en el apagado. Cambio mínimo y
retrocompatible (el llamador puede ignorar el retorno).

### ADR-4 — Pool pg vía PoolConfig
`PrismaPg` acepta un `pg.PoolConfig`. Se pasa `{ connectionString, max,
idleTimeoutMillis }` con `max = DB_POOL_MAX ?? 10` e `idleTimeoutMillis =
DB_POOL_IDLE_MS ?? 10000`. Dimensionar el pool evita agotar conexiones bajo carga
y libera las ociosas.

## Nota sobre Windows (dev)
En Windows las señales POSIX no son idénticas; `SIGINT` (Ctrl-C) funciona,
`SIGTERM` se emula. El wiring se verifica por arranque limpio y revisión de
código; el comportamiento real de drenado se valida en el entorno Linux de
despliegue (diferido).

## Concerns front / back
- **Back**: `db.ts`, `cron.ts`, `observability.ts`, `index.ts`. Sin nuevas deps.
- **Front**: ninguno.

## Plan de rollback
Aditivo salvo el retorno de `startAutomationsCron`. Rollback = revertir el commit:
se quitan señales, draining y config de pool. Sin datos afectados.
