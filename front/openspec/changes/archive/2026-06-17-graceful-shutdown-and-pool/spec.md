# Spec — Graceful Shutdown & DB Pool

## Requirement: Apagado ordenado ante señales

El proceso del backend DEBE manejar `SIGTERM` y `SIGINT` cerrando de forma
ordenada: dejar de aceptar conexiones nuevas, esperar a que terminen las
peticiones en vuelo, parar el cron de automatizaciones y desconectar Prisma. Un
timeout de seguridad DEBE forzar la salida si el drenado no termina a tiempo.

### Scenario: SIGTERM con peticiones en vuelo
- **WHEN** el proceso recibe `SIGTERM`
- **THEN** el servidor deja de aceptar nuevas conexiones
- **AND** espera a que las peticiones en vuelo terminen
- **AND** para el cron y ejecuta `prisma.$disconnect()`
- **AND** el proceso termina con código 0

### Scenario: Drenado que no termina
- **WHEN** el apagado supera `SHUTDOWN_TIMEOUT_MS`
- **THEN** el proceso fuerza la salida para no quedar colgado

## Requirement: Readiness en modo draining

Durante el apagado, `GET /ready` DEBE responder `503` para que un balanceador deje
de enrutar tráfico antes del cierre. `GET /health` (liveness) PUEDE seguir
respondiendo `200` mientras el proceso viva.

### Scenario: Readiness durante el apagado
- **WHEN** el proceso está en apagado (draining) y llega `GET /ready`
- **THEN** responde `503` con estado de draining

## Requirement: Pool de conexiones configurable

El cliente Prisma (adaptador pg) DEBE permitir configurar el tamaño del pool
(`max`) y el `idleTimeoutMillis` por variables de entorno, con defaults
razonables.

### Scenario: Override del pool por entorno
- **WHEN** se define `DB_POOL_MAX` y/o `DB_POOL_IDLE_MS`
- **THEN** el pool pg usa esos valores
- **AND** si no se definen, usa los defaults (max 10)
