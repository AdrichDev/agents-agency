# Propuesta — Dead Code Cleanup

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **1** (Pequeña) · Calidad

## Intención

Eliminar código muerto verificado (detectado con `knip`, descartando falsos
positivos) y añadir `knip` al CI de forma informativa para detectarlo de forma
continua.

Muerto confirmado (verificado a mano, sin usos):
- `requireAuth` (back/src/lib/auth.ts) — definido pero nunca montado (el gate usa
  `getSessionUser` inline).
- `isSentryEnabled` (back/src/lib/sentry.ts) — export sin uso.
- `export { z }` (back/src/lib/http.ts) — re-export sin uso.
- Scripts scratch en la raíz de back: `test_sectors.ts`, `updateConfig.cjs`.

NO se tocan los falsos positivos de knip: `public/widget.js` (se sirve estático),
`scripts/*` (tooling manual), `@prisma/client`/`pino-pretty` (uso en runtime), ni
los ~51 exports de tipos (usados internamente / posible API).

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/lib/auth.ts` | Modificado | Quitar `requireAuth` |
| `back/src/lib/sentry.ts` | Modificado | Quitar `isSentryEnabled` |
| `back/src/lib/http.ts` | Modificado | Quitar `export { z }` |
| `back/test_sectors.ts`, `back/updateConfig.cjs` | Borrado | Scratch |
| `back/knip.json` | Nuevo | Config con entry points (reduce falsos positivos) |
| `.github/workflows/ci.yml` | Modificado | Paso `knip` no bloqueante (files+deps) |

## Criterios de éxito

- [x] Código muerto verificado eliminado; `tsc` + `vitest` (352) verdes.
- [x] `knip.json` con entry points; CI ejecuta knip no bloqueante.
- [x] Sin tocar falsos positivos (widget.js, scripts, prisma).
