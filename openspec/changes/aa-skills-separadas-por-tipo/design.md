# Design — aa-skills-separadas-por-tipo

Front puro. Solo se consume estado ya existente del hook. Sin backend, sin migración.

## §A. Evidencia

- `useSkillsMarketplace.ts:58-65` `VIEW_OPTIONS[]` = `{key,label,icon,type,description}`.
- `activeView` (`:90`), `handleViewChange(view)` (`:160-164`, resetea page+q), `load()`
  manda `type=activeView.type` (`:118`). Ambos exportados (`:258,274`).
- `SkillsTab.tsx` consume `market` (`:129`) pero NO usa `activeView`/`handleViewChange`;
  solo `q/page/skills/uses/selectedUse` (`:258-293`).
- Por ítem: `(TYPE · USE)` texto gris (`:315`).

## §B. F1 — Fila de vistas por tipo (marketplace)

En `SkillsTab.tsx`, en la cabecera de la sección Marketplace (antes del input de búsqueda,
`:258`), añadir una fila de segmentos:

```
Marketplace
[🌍 Todos] [🛒 Skills] [🤖 Agentes] [🔌 Extensiones] [📦 Plugins] [🌐 MCP]
{descripción de la vista activa}            ← §F2
[buscar…] [Todas][EMAIL][DB]…              ← filtro por USE existente (secundario)
```

- Renderizar `market.activeView` vs `VIEW_OPTIONS` (importar de `useSkillsMarketplace`).
  Segmento activo = `market.activeView.key === opt.key` → estilo `chip-accent`; resto
  `chip`. onClick → `market.handleViewChange(opt)`.
- `handleViewChange` ya resetea page y q y dispara `load(1)` por el efecto
  (`useSkillsMarketplace.ts:150-154`). No añadir lógica.
- Mantener el filtro por `use` (chips existentes `:278-292`) como filtro secundario que
  combina con el tipo (el `load()` manda ambos `type` + `use`).

## §C. F2 — Descripción de la vista activa

Bajo la fila de segmentos, una línea con `market.activeView.description` (texto slate
pequeño). Resuelve "no sé qué es MCP/Agente". Cambia al cambiar de vista.

## §D. F3 — Etiqueta por ítem

Con las pestañas, el TYPE por ítem ya no necesita gritarse. Opciones (elige la más limpia):
- Dejar `(TYPE · USE)` como está (mínimo cambio), o
- Reducir a solo `USE` como sub-etiqueta (el tipo lo da la pestaña activa).
Preferir mantener el TYPE visible si la vista es "Todos" (donde sí ayuda) y simplificar a
`USE` cuando hay un tipo seleccionado. No es crítico.

## §E. Tests

- `front npx tsc --noEmit` verde.
- Si el harness de front admite test de componente: al hacer click en la vista "MCP",
  `handleViewChange` se llama con la opción MCP y la descripción de MCP se muestra. (Si no
  hay harness de componentes en front — como en H3 — basta tsc + verificación visual HITL.)

Regla del repo: DONE solo con test verde (o tsc + HITL si no hay harness de componentes).
