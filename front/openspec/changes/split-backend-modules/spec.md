# Spec — Split Backend Modules

## Requirement: División preservando la API pública
Los ficheros >500 líneas DEBEN dividirse en submódulos cohesivos, manteniendo
intactos los símbolos exportados desde la ruta de import original (barrel re-export).

### Scenario: Importadores y tests intactos
- **WHEN** se divide `stats.ts`/`scraper.ts`/`channels.ts`
- **THEN** los imports existentes (`@/lib/stats`, etc.) siguen resolviendo los mismos símbolos
- **AND** `vitest` (352) sigue verde
