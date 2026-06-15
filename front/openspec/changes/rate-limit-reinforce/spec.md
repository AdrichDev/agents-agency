# Spec — Rate Limit Reinforce

## Requirement: Limitador para operaciones costosas

Las operaciones de coste alto (scraping masivo de skills, generación de estudios
de mercado con IA + Places, generación de landings con IA) DEBEN estar protegidas
por un limitador específico (`heavyLimiter`) más estricto que el límite global.

### Scenario: Exceso en operación costosa
- **WHEN** un cliente supera el límite de `heavyLimiter` en `POST /api/skills` (discover)
- **THEN** responde `429` con un mensaje de "demasiadas solicitudes"

### Scenario: Endpoints cubiertos
- **WHEN** se revisan los endpoints costosos
- **THEN** `skills` POST, `market-studies` POST `/`+`/:id/generate`+`/:id/sections/:key/regenerate`
  y `landing` generate tienen `heavyLimiter`

## Requirement: Límites configurables por entorno

Los límites de los limitadores DEBEN poder configurarse por variables de entorno
(`RATE_LIMIT_*`), manteniendo los defaults actuales si no se definen.

### Scenario: Override por env
- **WHEN** se define `RATE_LIMIT_HEAVY=20`
- **THEN** `heavyLimiter` permite 20 por ventana
- **AND** sin la env usa el default (10)
