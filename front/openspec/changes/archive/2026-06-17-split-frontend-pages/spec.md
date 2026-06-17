# Spec — Split Frontend Pages

## Requirement: Extracción de componentes sin cambio de comportamiento
Las páginas >500 líneas DEBEN extraer sus componentes internos a ficheros propios,
manteniendo el mismo render, props y estado observable.

### Scenario: Build y tipos intactos
- **WHEN** se extraen componentes de las páginas grandes
- **THEN** `next build` y `tsc --noEmit` quedan verdes
- **AND** el render y la lógica de cada página no cambian
