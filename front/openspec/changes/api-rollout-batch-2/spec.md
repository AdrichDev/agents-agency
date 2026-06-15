# Spec — API Rollout Batch 2

## Requirement: Routers agents/skills/automations/stats bajo el patrón estándar

Los routers `agents`, `skills`, `automations` y `stats` DEBEN usar `asyncHandler`
y expresar sus errores 4xx con `HttpError` (o `validate` para body), preservando
comportamiento observable y middlewares (auth/role/limiters).

### Scenario: Validación de body inválida
- **WHEN** se envía un body inválido a una ruta `POST/PATCH/PUT` de estos routers
- **THEN** la respuesta es `400` con `error` string + `details`

### Scenario: Validación de query inválida (stats)
- **WHEN** `GET /api/stats` recibe parámetros de query inválidos
- **THEN** responde `400` con `error` string + `details`

### Scenario: Recurso no encontrado
- **WHEN** se pide un agent/automation/skill inexistente
- **THEN** responde `404` vía `HttpError`

### Scenario: Error async no cuelga la petición
- **WHEN** un handler de estos routers lanza
- **THEN** el error llega al `errorHandler` central

## Requirement: Middlewares preservados

La migración NO DEBE alterar los middlewares de cada ruta (p. ej. `requireRole`,
limiters de IA). El orden DEBE ser `[auth/role/limiter] → [validate] →
asyncHandler(handler)`.

### Scenario: Ruta con rol requerido
- **WHEN** una ruta protegida por `requireRole` se migra
- **THEN** sigue exigiendo el rol antes de ejecutar el handler
