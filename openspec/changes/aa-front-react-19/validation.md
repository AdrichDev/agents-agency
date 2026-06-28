# Validación — aa-front-react-19

Historia: como AA front alineado a CRM, quiero React 19 sin romper el build.

## Criterios de aceptación (AC)
- **AC1**: react/react-dom y @types correspondientes en ^19.
- **AC2**: `npm run typecheck` limpio (fixes de tipos mínimos si @types/react@19 los exige).
- **AC3**: `npm run build` (next build) OK.

## Por tarea (Given-When-Then + test)
### T.1 — deps + tipos
- **Given** react ^19 + @types ^19, **When** typecheck, **Then** limpio (corrigiendo errores de tipo locales). _Test: tsc._
### T.2 — build
- **Given** React 19, **When** `next build`, **Then** OK. _Test: comando._

## Verificación
- [ ] typecheck limpio · next build OK.
