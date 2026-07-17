# Proposal — aa-skills-separadas-por-tipo

Hijo H5 del plan maestro `aa-agentes-rediseno-operativo` (P1).

## Corrección de premisa (verificada)

La auditoría dijo "SkillsTab mezcla SKILL/AGENT/MCP/EXTENSION/PLUGIN, sin separar por
tipo". Verificado: la **maquinaria de separación YA EXISTE** en
`front/hooks/useSkillsMarketplace.ts`:
- `VIEW_OPTIONS` (`:58-65`): Todos / Skills / Agentes / Extensiones / Plugins / MCP, cada
  uno con `icon`, `type` y **`description`** (incl. "MCP — Model Context Protocol").
- `activeView` + `handleViewChange` (`:90,160`) + `load()` que manda `type` al backend
  (`:118`) → **filtra por tipo server-side**. Ya exportados por el hook (`:258,274`).

El bug: **`SkillsTab.tsx` (la pestaña Skills del agente) NO renderiza esas vistas** —
solo cablea el filtro por `use` (`SkillsTab.tsx:278-292`), nunca `activeView`/
`VIEW_OPTIONS`. El tipo solo aparece como texto gris `(TYPE · USE)` (`:315`). O sea: la
separación existe en el hook (y probablemente en la página global de skills) pero **no se
expuso en la pestaña del agente**.

## Scope (front puro, SIN backend)

- **F1 Surface de vistas por tipo:** en la sección Marketplace de `SkillsTab.tsx`, renderar
  las `VIEW_OPTIONS` como una fila de pestañas/segmentos (icono + label), cableadas a
  `market.activeView` + `market.handleViewChange` (ya server-side por `type`). Encima del
  filtro por `use` existente (que se mantiene como filtro secundario).
- **F2 Claridad de tipo:** mostrar la `description` de la vista activa (una línea) para que
  el usuario entienda qué es cada tipo — resuelve el "no sé qué es MCP". Reusar
  `VIEW_OPTIONS[].description`.
- **F3 (opcional):** mantener/limpiar la etiqueta `(TYPE · USE)` por ítem — con las
  pestañas ya no hace falta gritar el TYPE; dejar el `use` como sub-etiqueta.

## Fuera de scope
- Backend de skills (GET /api/skills ya acepta `type`; nada que tocar).
- Discover/addRepo/addWebsite (acciones de importación) — no es esta pestaña.

## Risks
- Bajo. Front, reutiliza estado ya existente y probado en el hook. Verificar que el
  cambio de vista resetea página/query como ya hace `handleViewChange` (`:160-164`).

## Dependencies
- `front/components/agents/SkillsTab.tsx`, `front/hooks/useSkillsMarketplace.ts`
  (`VIEW_OPTIONS`, `activeView`, `handleViewChange` — solo consumir, no modificar).
