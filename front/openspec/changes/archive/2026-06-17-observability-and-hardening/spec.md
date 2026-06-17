# Spec — Observability & Hardening

## Requirement: Logging estructurado por petición

El backend DEBE emitir un log estructurado por cada petición HTTP mediante un
logger central (`pino`). Cada petición DEBE llevar un identificador de
correlación propagado en el header `x-request-id`. Los campos sensibles
(`authorization`, `cookie`, `set-cookie`, `password`, `token`, `secret`,
`apiKey`) DEBEN redactarse.

### Scenario: Petición genera log con correlation id
- **WHEN** llega cualquier petición HTTP a la API
- **THEN** la respuesta incluye un header `x-request-id` (reusa el entrante si lo
  hay, o genera un UUID)
- **AND** se emite un log con método, ruta, status y `responseTime`
- **AND** el nivel es `error` para 5xx, `warn` para 4xx, `info` en el resto

### Scenario: Los secretos no aparecen en los logs
- **WHEN** una petición trae `Authorization` o `Cookie`
- **THEN** el log muestra esos campos como `[redacted]`

## Requirement: Sondas de salud

El backend DEBE exponer `GET /health` (liveness) y `GET /ready` (readiness),
ambas públicas y fuera del gate de autenticación de `/api`. Estas rutas NO DEBEN
generar ruido en los logs de request.

### Scenario: Liveness
- **WHEN** se hace `GET /health`
- **THEN** responde `200` con `{ status: "ok", uptime, timestamp }`

### Scenario: Readiness con BD disponible
- **WHEN** se hace `GET /ready` y la BD responde a `SELECT 1`
- **THEN** responde `200` con `{ status: "ready", db: "up" }`

### Scenario: Readiness con BD caída
- **WHEN** se hace `GET /ready` y la consulta a la BD falla
- **THEN** responde `503` con `{ status: "not-ready", db: "down" }`
- **AND** se registra el error con contexto

## Requirement: Manejo de errores centralizado y a prueba de crash

La API DEBE tener un manejador de errores final que registre el error y devuelva
un JSON seguro. En respuestas `5xx` NO DEBE filtrar detalles internos. El proceso
DEBE registrar `unhandledRejection` y `uncaughtException` en lugar de terminar de
forma silenciosa.

### Scenario: Error interno en una ruta
- **WHEN** un handler lanza una excepción no controlada
- **THEN** se registra el error completo del lado servidor con `requestId`
- **AND** el cliente recibe `500` con un mensaje genérico y su `requestId`

### Scenario: Error de cliente con status propio
- **WHEN** se lanza un error con `status`/`statusCode` en rango `4xx`
- **THEN** el cliente recibe ese status y el mensaje del error

### Scenario: Ruta /api inexistente
- **WHEN** se solicita una ruta bajo `/api` que no existe (con sesión válida)
- **THEN** responde `404` con `{ error: "Not Found" }`

## Requirement: Hardening del frontend

El build de producción del frontend NO DEBE emitir source maps de navegador y
NINGUNA variable `NEXT_PUBLIC_*` DEBE contener secretos.

### Scenario: Build de producción sin source maps
- **WHEN** se ejecuta `next build` en modo producción
- **THEN** no se generan ni sirven `.map` de navegador (`productionBrowserSourceMaps: false`)

### Scenario: Auditoría de variables públicas
- **WHEN** se revisan las variables `NEXT_PUBLIC_*`
- **THEN** ninguna expone llaves privadas, tokens ni credenciales
