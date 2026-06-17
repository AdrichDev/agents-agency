# Spec — CI Pipeline

## Requirement: Verificación automática en push y PR

El repositorio DEBE ejecutar verificaciones automáticas en cada push a `master`
y en cada Pull Request. El pipeline DEBE fallar (check en rojo) si cualquier
comprobación de backend o frontend falla.

### Scenario: Push con código correcto
- **WHEN** se hace push a `master` con tipos, tests y build correctos
- **THEN** el workflow ejecuta los jobs back y front
- **AND** todos los checks quedan en verde

### Scenario: Pull Request con tipos rotos
- **WHEN** se abre un PR cuyo `tsc --noEmit` falla (back o front)
- **THEN** el job correspondiente falla
- **AND** el check de GitHub queda en rojo

### Scenario: Pull Request con test roto
- **WHEN** se abre un PR con un test de `vitest` fallando en backend
- **THEN** el job back falla y bloquea el merge

## Requirement: Job de backend

El pipeline DEBE incluir un job que instale dependencias con `npm ci` y ejecute
`npm run typecheck` y `npm test` en `back/`. El job NO DEBE requerir una base de
datos (los tests mockean Prisma).

### Scenario: Backend verifica tipos y tests sin BD
- **WHEN** corre el job back
- **THEN** `npm ci` instala deps (incluido `prisma generate` vía postinstall)
- **AND** `npm run typecheck` y `npm test` se ejecutan sin conexión a PostgreSQL

## Requirement: Job de frontend

El pipeline DEBE incluir un job que instale dependencias con `npm ci` y ejecute
`npm run typecheck` y `npm run build` en `front/`.

### Scenario: Frontend verifica tipos y build
- **WHEN** corre el job front
- **THEN** `npm run typecheck` y `npm run build` (`next build`) completan sin error

## Requirement: Toolchain reproducible

El repositorio DEBE fijar la versión de Node mediante `.nvmrc`, y CI DEBE usar esa
misma versión.

### Scenario: Versión de Node consistente
- **WHEN** CI o un desarrollador preparan el entorno
- **THEN** usan la versión de Node declarada en `.nvmrc`
