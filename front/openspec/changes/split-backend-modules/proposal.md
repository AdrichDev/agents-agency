# Propuesta — Split Backend Modules (>500 líneas)

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Calidad/mantenibilidad

## Intención

Dividir ficheros de backend que superan la regla de 500 líneas, **preservando la
API pública** (re-export desde la ruta original / barrel) para que importadores y
tests no cambien. Verificable por los 352 tests.

Ficheros: `back/src/lib/stats.ts` (836), `back/src/lib/github-skills/scraper.ts`
(724), `back/src/routes/channels.ts` (501).

## Criterios de éxito
- [x] Cada fichero queda <500 líneas (o el barrel re-exporta submódulos).
- [x] Exports públicos intactos; importadores/tests sin cambios.
- [x] `vitest` (352) y `tsc --noEmit` verdes.
