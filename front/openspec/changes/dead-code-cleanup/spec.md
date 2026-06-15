# Spec — Dead Code Cleanup

## Requirement: Eliminar código muerto verificado

El código exportado sin ningún uso y los scripts scratch DEBEN eliminarse, sin
afectar el comportamiento del sistema.

### Scenario: Build y tests intactos
- **WHEN** se elimina `requireAuth`, `isSentryEnabled`, el re-export `z` y los
  scripts scratch
- **THEN** `tsc --noEmit` y `vitest` siguen verdes

## Requirement: Detección continua de código muerto

El CI DEBE ejecutar `knip` (al menos ficheros y dependencias) de forma NO
bloqueante, con una config que declare los entry points para minimizar falsos
positivos.

### Scenario: knip informa sin bloquear
- **WHEN** corre el job de CI
- **THEN** knip reporta en el log y el job no falla por ello
