# Proposal — Upgrade React 18 → 19 en AA front (aa-front-react-19)

**Nivel Gru: 3 — Grande.** Major de React, App Router (Next 15 ya instalado). Reversible (deps).
**Estado: APROBADO (2026-06-28) — F4 (última) del plan de alineación de versiones (#7).**

## Contexto

Con Next 15 ya en AA front (F3), falta subir React 18.3.1 → 19 para alinear con CRM front
(React 19.0.0 + Next 15.5). React 19 es el target de Next 15 App Router.

Breaking surface React 19 en AA front (dimensionado):
- NO usa APIs eliminadas: `defaultProps` (func comps), `PropTypes`, `findDOMNode`, `ReactDOM.render`, string refs.
- Riesgo principal: tipos más estrictos de `@types/react@19` (ReactNode, JSX namespace, ref como prop).

## Intención

Subir `react`/`react-dom` y `@types/react`/`@types/react-dom` a ^19; validar typecheck + `next build`.

## Decisiones técnicas

- `react`+`react-dom` → `^19`; `@types/react`+`@types/react-dom` → `^19`.
- Corregir solo los errores de tipo que aparezcan por `@types/react@19` (mínimos, sin cambiar lógica).
- Validación: `npm run typecheck` + `npm run build`.

## Alcance

1. `front/package.json`: react, react-dom, @types/react, @types/react-dom → ^19.
2. Fixes de tipos mínimos si `@types/react@19` los exige.

## Fuera de alcance

- Adoptar APIs nuevas de React 19 (Actions, use(), etc.) — no es necesario para alinear.
- Cambios funcionales.

## Riesgos

- `@types/react@19` endurece tipos → posibles errores de tsc a corregir. Mitigación: fixes locales.
- Algún dep de terceros con peer React <19 → warning; validar build.
