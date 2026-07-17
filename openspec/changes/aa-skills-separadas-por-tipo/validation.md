# Validation — aa-skills-separadas-por-tipo

## User story

Como operador que añade skills a un agente, quiero ver el marketplace **separado por tipo**
(Skills, Agentes, MCP, Extensiones, Plugins) con una explicación de cada uno, para no ver
todo mezclado y entender qué estoy añadiendo (p.ej. qué es un MCP).

## Acceptance criteria

- **AC1**: La pestaña Skills del agente muestra una fila de vistas por tipo (Todos, Skills,
  Agentes, Extensiones, Plugins, MCP) con icono y label, cableada al filtrado por `type`
  que ya existe en el hook (server-side).
- **AC2**: Al seleccionar una vista, el listado se filtra por ese tipo y se muestra la
  descripción de la vista (resuelve "no sé qué es MCP").
- **AC3**: El filtro por `use` existente se mantiene y combina con el tipo.
- **AC4 (regresión cero)**: el hook `useSkillsMarketplace` no se modifica; añadir/quitar/
  guardar skills (`PUT /api/agents/:id/skills`) sigue funcionando igual.

## Given-When-Then

**Escenario 1 (AC1+AC2):**
Given la pestaña Skills de un agente
When selecciono la vista "MCP"
Then el listado muestra solo skills de tipo MCP y aparece la descripción "Model Context
Protocol — servidores MCP compatibles".

**Escenario 2 (AC3):**
Given la vista "Skills" seleccionada
When además elijo el filtro de uso "EMAIL"
Then el listado combina tipo=SKILL y use=EMAIL.

## Test por tarea
- T1.1 → `front tsc` verde; segmentos cableados a handleViewChange (filtro server-side por tipo).
- T2.1 → descripción de la vista activa visible.
- T3.1 → etiqueta por ítem simplificada/coherente.

Regla del repo: DONE con `front tsc` verde + verificación visual HITL (no hay harness de
componentes en front).
