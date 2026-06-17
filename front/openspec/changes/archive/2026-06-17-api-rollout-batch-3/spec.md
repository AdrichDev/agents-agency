# Spec — API Rollout Batch 3

## Requirement: landing bajo el patrón estándar

`landing` DEBE usar `asyncHandler` y expresar errores 4xx con `HttpError`/
`validate`, preservando la lógica de generación y los middlewares.

### Scenario: Body inválido en landing
- **WHEN** una ruta de creación/edición de `landing` recibe body inválido
- **THEN** responde `400` con `error` string + `details`

### Scenario: Recurso de landing inexistente
- **WHEN** se pide un proyecto/landing inexistente
- **THEN** responde `404` vía `HttpError`

### Scenario: Error async no cuelga la petición
- **WHEN** un handler de `landing` lanza
- **THEN** el error llega al `errorHandler` central

## Requirement: knowledge e integrations envueltos

Los handlers async de `knowledge` e `integrations` DEBEN ir en `asyncHandler` y
sus 404 expresarse con `HttpError`, sin alterar flujos (OAuth) ni middlewares.

### Scenario: 404 consistente
- **WHEN** se pide un recurso inexistente en knowledge/integrations
- **THEN** responde `404` vía `HttpError`

## Requirement: contacts/market-studies sin cambios

`contacts` y `market-studies` NO se migran en este change (excepción documentada
por coste de reescritura de tests vs valor). Su comportamiento NO DEBE cambiar.

### Scenario: Sin regresión en routers excluidos
- **WHEN** corre la suite de tests
- **THEN** `contacts` y `market-studies` siguen verdes sin modificaciones
