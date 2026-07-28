# Validación — aa-front-next-15

Historia: como AA front alineado, quiero Next 15 sin romper el build ni las pages existentes.

## Criterios de aceptación (AC)

- **AC1**: `next` en `^15`; instalado sin errores de peer-deps bloqueantes.
- **AC2**: `npm run typecheck` (tsc --noEmit) limpio.
- **AC3**: `npm run build` (next build) completa sin error.
- **AC4**: Las pages client (`useSearchParams`) siguen funcionando (no requieren cambios async).
- **AC5**: Si Next 15 exige React 19, se combina F4 y se documenta (no se deja un estado que no buildea).

## Por tarea (Given-When-Then + test)

### T.1 — deps
- **Given** package.json con next ^15, **When** `npm install`, **Then** instala. _Test: comando._

### T.2 — typecheck + build
- **Given** Next 15 instalado, **When** `npm run typecheck` y `npm run build`, **Then** ambos OK.
  _Test: comandos (gate principal, no hay unit suite)._

## Verificación
- [ ] typecheck limpio · `next build` OK.
