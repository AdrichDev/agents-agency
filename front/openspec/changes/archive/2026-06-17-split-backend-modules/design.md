# Design — Split Backend Modules

## Decisión
Patrón "barrel": el fichero original pasa a re-exportar submódulos cohesivos.
- `stats.ts` → `stats/` (kpis, series, billing, top-agents) + `stats.ts` re-export.
- `scraper.ts` → separar GitHub / Google / clasificación IA, barrel en el original.
- `channels.ts` (router) → extraer handlers Telegram y WhatsApp a módulos, el router los monta.
Comportamiento idéntico; solo reorganización física. Verificación por tests.

## Rollback
Revertir el commit.
