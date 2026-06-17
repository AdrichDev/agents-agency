# Spec — API Rollout Batch 1

## Requirement: Routers config/sectors/budgets bajo el patrón estándar

Los routers `config`, `sectors` y `budgets` DEBEN usar `asyncHandler`,
`validate` y `HttpError` (cimientos de `api-foundations`), preservando su
comportamiento observable (rutas, status y semántica) y devolviendo errores con
el envelope consistente.

### Scenario: Validación inválida uniforme
- **WHEN** se envía un body inválido a `POST /api/config`, `POST /api/sectors` o `POST /api/budgets`
- **THEN** la respuesta es `400` con `error` (string) y `details` de Zod

### Scenario: Error async no cuelga la petición
- **WHEN** un handler de estos routers lanza un error
- **THEN** el error llega al `errorHandler` central y el cliente recibe respuesta

## Requirement: Mapeo de errores Prisma en budgets

`POST /api/budgets` con un `quoteNumber` duplicado DEBE responder `409`.
`PUT /api/budgets/:id/status` sobre un presupuesto inexistente DEBE responder `404`.

### Scenario: Número de presupuesto duplicado
- **WHEN** se crea un presupuesto con un `quoteNumber` ya existente (Prisma `P2002`)
- **THEN** responde `409` con mensaje claro

### Scenario: Actualizar status de presupuesto inexistente
- **WHEN** se hace `PUT /api/budgets/:id/status` con id inexistente (Prisma `P2025`)
- **THEN** responde `404`

## Requirement: Validación de status en budgets

`PUT /api/budgets/:id/status` DEBE validar el body (`status` string no vacío)
antes de actualizar.

### Scenario: Status faltante
- **WHEN** se hace `PUT /api/budgets/:id/status` sin `status`
- **THEN** responde `400` (VALIDATION_ERROR)
