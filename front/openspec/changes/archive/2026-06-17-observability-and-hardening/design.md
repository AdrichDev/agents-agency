# Design — Observability & Hardening

## Decisiones de arquitectura

### ADR-1 — pino como logger central (vs winston / console)
`pino` por bajo overhead (logging asíncrono) y JSON nativo apto para shippers.
`pino-pretty` solo en desarrollo (transport condicionado a `NODE_ENV`). Se evita
`console.*` disperso: las rutas usan `req.log` (inyectado por `pino-http`) o el
`logger` exportado. Rationale: salida estructurada y consistente, redacción
central de secretos, base lista para enchufar Sentry como destino.

### ADR-2 — Correlation id en `x-request-id`
`pino-http` con `genReqId`: reusa `x-request-id` entrante (trazas que cruzan
servicios/proxies) o genera un UUID. Se escribe en el header de respuesta y se
incluye en el cuerpo de error (`requestId`) para que el cliente lo reporte.

### ADR-3 — Liveness vs readiness separadas
`/health` no toca dependencias (responde mientras el proceso viva). `/ready`
hace `SELECT 1` vía Prisma; si falla devuelve `503` para que un orquestador no
enrute tráfico. Ambas montadas ANTES del gate `/api` → públicas. Se excluyen del
`autoLogging` para no inundar de ruido.

### ADR-4 — Error handler como último middleware
Express trata un middleware de 4 args como error handler. Debe ir tras todos los
routers. Mapea `status`/`statusCode` del error (default 500); en `4xx` propaga el
mensaje, en `5xx` devuelve genérico. Crash guards de proceso
(`unhandledRejection`/`uncaughtException`) registran y mantienen el proceso para
diagnóstico (en prod, un supervisor decidiría reiniciar).

### ADR-5 — Source maps de navegador desactivados explícitos
Next.js ya no emite source maps de navegador en prod por defecto, pero se fija
`productionBrowserSourceMaps: false` de forma explícita en `next.config` como
contrato verificable (pilar 1).

## Concerns front / back

- **Back (Express)**: `lib/logger.ts` (instancia pino) + `lib/observability.ts`
  (middlewares y handlers) + wiring en `index.ts`. Orden de middlewares:
  `helmet → httpLogger → /health,/ready → json → /api limiter → auth gate →
  routers → notFound(/api) → errorHandler`.
- **Front (Next.js)**: solo `next.config` (config de build). Sin cambios de UI.

## Punto de extensión: Sentry / APM (diferido)
`logger.ts` es el único punto donde añadir un transport/`Sentry.init` guarded por
`SENTRY_DSN` (no-op si ausente). El `errorHandler` ya centraliza la captura, así
que enchufar `Sentry.captureException(err)` ahí es aditivo y de bajo riesgo.

## Plan de rollback
Cambio puramente aditivo (sin migraciones ni cambios de datos). Rollback =
revertir el commit: se quitan logger/observability y el wiring; la API vuelve al
comportamiento previo. Sin estado persistente afectado.
