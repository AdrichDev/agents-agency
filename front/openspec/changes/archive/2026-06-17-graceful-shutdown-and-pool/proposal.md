# Propuesta — Graceful Shutdown & DB Pool

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 9 (escalabilidad / fiabilidad)

## Intención

Pilar 9 (prep local, sin infra extra): que la app aguante reinicios/deploys y
picos sin tirar peticiones ni dejar conexiones colgadas. Hoy:

- El proceso **no cierra de forma ordenada**: ante `SIGTERM`/`SIGINT` muere de
  golpe → peticiones en vuelo cortadas, conexiones de BD no liberadas, cron a
  medias.
- El **pool de conexiones** de Prisma/pg es implícito (default `max=10`), sin
  poder ajustarlo por entorno.

Se añade:

1. **Apagado ordenado (graceful shutdown)**: en `SIGTERM`/`SIGINT` se deja de
   aceptar conexiones nuevas, se espera a drenar las en vuelo, se para el cron y
   se cierra el cliente Prisma; con timeout de seguridad que fuerza la salida.
2. **Readiness "draining"**: durante el apagado, `GET /ready` responde `503`
   para que un balanceador deje de enrutar tráfico antes de cerrar.
3. **Pool de BD configurable**: `max` e `idleTimeoutMillis` del pool pg vía env
   (`DB_POOL_MAX`, `DB_POOL_IDLE_MS`), con defaults razonables.

**Éxito**: en un reinicio, las peticiones en vuelo terminan, la BD se desconecta
limpia y el readiness drena antes de cerrar.

## Fuera de alcance (diferido)

| Tema | Motivo |
|------|--------|
| Rate-limit/caché en Redis (horizontal) | Prematuro en single-org/local |
| Load test 1000+ usuarios | Requiere entorno de carga; posterior |
| Autoscaling / orquestador | Necesita deploy en nube |

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/lib/db.ts` | Modificado | Pool `max`/`idleTimeoutMillis` por env |
| `back/src/lib/cron.ts` | Modificado | `startAutomationsCron` devuelve el handle del intervalo |
| `back/src/lib/observability.ts` | Modificado | Estado `draining` + `/ready` 503 al drenar |
| `back/src/index.ts` | Modificado | Captura server/cron, `shutdown()` y señales |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Shutdown se cuelga esperando conexiones | Media | Timeout de seguridad (`SHUTDOWN_TIMEOUT_MS`, default 10s) que fuerza `exit` |
| Señales en Windows (dev) no idénticas a prod | Baja | Se registran `SIGTERM`+`SIGINT`; verificación de wiring por código/arranque |
| Pool demasiado pequeño/grande | Baja | Defaults (max 10) y override por env |

## Criterios de éxito

- [x] `SIGTERM`/`SIGINT` disparan apagado ordenado (log, cierre server, `$disconnect`, stop cron). *(verificado por código; señal real validable en Linux)*
- [x] Durante el apagado, `/ready` responde `503` (draining) — flag + handler.
- [x] Timeout de seguridad (`SHUTDOWN_TIMEOUT_MS`, unref) fuerza la salida.
- [x] Pool pg configurable por `DB_POOL_MAX`/`DB_POOL_IDLE_MS`.
- [x] `vitest` (352) y `tsc --noEmit` (back) verdes; el server arranca limpio.
