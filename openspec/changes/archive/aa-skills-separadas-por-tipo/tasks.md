# Tasks — aa-skills-separadas-por-tipo

Front puro. `front npx tsc --noEmit` (+ HITL visual, no hay harness de componentes en front).
Sin backend, sin migración. DONE con verde.

## F1 — Fila de vistas por tipo

- [x] **T1.1 — Segmentos VIEW_OPTIONS en SkillsTab.** Importar `VIEW_OPTIONS` de
  `useSkillsMarketplace`; renderar la fila de segmentos (icono+label) en la cabecera del
  Marketplace (`SkillsTab.tsx:258`), activa por `market.activeView.key`, onClick →
  `market.handleViewChange(opt)`. Mantener el filtro por `use` como secundario.
  - Test: `front tsc` verde; al cambiar de vista se filtra por tipo (server-side vía hook).

## F2 — Descripción de la vista activa

- [x] **T2.1 — Línea de descripción.** Mostrar `market.activeView.description` bajo los
  segmentos (resuelve "no sé qué es MCP").

## F3 — Etiqueta por ítem

- [x] **T3.1 — Simplificar `(TYPE · USE)`** por ítem: mantener TYPE visible en vista
  "Todos", simplificar a `USE` cuando hay tipo seleccionado (o dejar como está si es más
  limpio). No crítico.

## Verificaciones finales

- [x] **T4.1 — Typecheck** (`front tsc`) verde.
- [ ] **T4.2 — Verificación visual (HITL):** abrir la pestaña Skills de un agente, ver las
  pestañas por tipo, filtrar por MCP/Agentes, leer la descripción. — ⏳ GATE HUMANO: el código ya está (`front/components/agents/SkillsTab.tsx:260` recorre `VIEW_OPTIONS` y `:274` pinta `market.activeView.description`). Falta abrir la pestaña Skills en el navegador y confirmarlo a la vista.
- [x] **T4.3 — Engram:** persistir (la separación por tipo ya existía en el hook; solo se
  expuso en SkillsTab).

## Notas
- El hook `useSkillsMarketplace` NO se modifica (solo se consume `activeView`/
  `handleViewChange`/`VIEW_OPTIONS`).
- GET /api/skills ya acepta `type` — nada de backend.

## Cierre — 28/07/2026

Cierre con una única acción humana pendiente (T4.2, comprobación visual de la separación de skills por tipo). El código del selector de vistas está verificado en `SkillsTab.tsx`.
