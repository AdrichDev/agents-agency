# Validation — aa-agent-skills-install-execute

## User story

Como creador de agentes de la agencia, quiero elegir para cada agente solo las
skills relevantes a lo que ese agente hará (una selección curada, no el catálogo
entero), instalarlas al crearlo o editarlas después desde el panel, y que el
agente use CUALQUIERA de esas skills él solo durante la conversación cuando
vienen a cuento — igual que un subagente de Claude Code ve sus skills por
nombre+descripción e invoca la relevante — para ampliar lo que sabe hacer sin
tocar código ni recrearlo.

## Invariante principal (AC0): instalada ⇒ ejecutable

**Toda skill que el operador instala en un agente es ejecutable, sin
excepción.** No existe la categoría "instalada pero inerte". El nivel de
ejecución depende de lo que la skill declare, pero ninguna instalada es
decorativa:

- Skill sin tools declaradas → ejecutable a nivel instrucción: el agente carga
  sus instrucciones vía `usar_skill` y actúa con sus capacidades base.
- Skill con `toolsProvider` (F1) → instrucción + tools del provider.
- Skill con MCP (F2b) → instrucción + tools externas.

## Acceptance criteria — Nivel 1

- AC1: la selección es CURADA por-agente. Al crear el agente el wizard
  (`SkillsStep`, opcional) elige un subconjunto de skills → `AgentSkill`.
  `PUT /api/agents/:id/skills` edita ese conjunto (reemplazo declarativo):
  instala, reemplaza y vacía (`[]`); responde el `skillStatus` resultante. No
  se instala el catálogo entero.
- AC2: skillIds inexistentes → 400 con los ids inválidos listados; agente
  inexistente → 404; más de `MAX_INSTALLED_SKILLS = 15` → 400. Nada se
  persiste a medias (transacción).
- AC3 (motor de instrucciones, núcleo): una skill instalada aporta 1 línea
  (nombre+descripción) al system prompt; el cuerpo completo (`instructions`
  curadas, o `description`/`use` como fallback) solo entra cuando el LLM llama
  `usar_skill` (progressive disclosure). `usar_skill` sobre una skill NO
  instalada en ese agente devuelve error honesto, nunca contenido.
- AC4: instalada una skill con `toolsProvider` válido y su integración física
  conectada, el loop del agente gana las tools de ese provider ADEMÁS de su
  baseline de instrucción; con la integración desconectada la skill sigue
  siendo ejecutable (baseline) y la tab muestra `requiere conectar <provider>`.
- AC5: **Retrocompat / regresión cero** — un agente sin `AgentSkill` (todos los
  de prod hoy) produce exactamente las mismas tools (sin `usar_skill`) y el
  mismo system prompt (sin índice) que antes de este cambio; nada cambia hasta
  instalar la primera skill.
- AC6: la tab Skills del panel lista las skills ELEGIDAS del agente con su
  estado real por TIPO de ejecución (reutilizando `agent.skillStatus` de
  `getAgentDetail` — el front no infiere capacidades), permite buscar en el
  marketplace y AÑADIR/quitar del conjunto y guardar; ningún badge significa
  "inerte"; el enlace legado `?tab=skills` vuelve a abrir la tab.
- AC7: el wizard ofrece `SkillsStep` como paso OPCIONAL: se puede crear un
  agente sin tocarlo (no bloquea `blockedReason()`), y si se eligen skills se
  persisten vía el `skillIds` ya aceptado por `createAgentSchema`.

## Acceptance criteria — Nivel 2 (fase posterior, gate: Nivel 1 archivado)

- AC8 (F2b): una skill MCP curada monta tools namespaced `skill__*` solo con
  host en allowlist, kill switch abierto y secreto per-agente presente, ADEMÁS
  de su baseline de instrucción; un server caído o fuera de allowlist degrada
  la skill a su baseline de instrucción sin romper el chat.
- AC9: ninguna vía ejecuta código de terceros dentro de AA ni SQL/código libre
  del LLM; los secretos MCP son per-agente y cifrados `enc:v1:` (nunca token
  global). Un `PUT` que reinstala una skill NO borra su secreto MCP.

## Given-When-Then

**Escenario 1 (AC0/AC3): instalada ⇒ ejecutable, skill de solo instrucción**
Given un agente con la skill "Guía de devoluciones" (sin `toolsProvider`, con
`instructions` curadas) elegida e instalada, y 0 tools de provider por ese
concepto
When el usuario pregunta "¿cómo devuelvo un pedido?"
Then el system prompt del turno contiene SOLO la línea
`- Guía de devoluciones: <descripción>` (no el cuerpo)
And el LLM llama `usar_skill` con esa skill y recibe el cuerpo truncado con
framing de contenido no confiable
And responde ejecutando la skill (aplicando la guía) con sus capacidades base,
sin que el cuerpo persista fuera del output de tool.

**Escenario 2 (AC1/AC4): selección curada + tools de provider**
Given un agente de reservas con la integración Google conectada
When el operador, al crearlo, elige en `SkillsStep` solo "Agenda"
(`toolsProvider="calendar"`) y "Recordatorios" (solo instrucción) — no el
catálogo entero
Then ambas quedan instaladas y ejecutables
And en conversación "Agenda" aporta `list_calendar_events`/
`create_calendar_event` además de su baseline, y "Recordatorios" se ejecuta a
nivel instrucción
And al quitar "Agenda" desde el panel (`PUT` con el resto) sus tools calendar
desaparecen del loop.

**Escenario 3 (AC5): regresión cero**
Given cualquier agente de prod actual (0 filas `AgentSkill`)
When se despliega este cambio y el agente atiende una conversación
Then las tools montadas y el system prompt son byte-idénticos a los previos al
despliegue (sin `usar_skill`, sin índice de skills).

## Test por tarea (Nivel 1)

- T1.1 (migración): `Skill.instructions` aditiva validada en BD local
  desechable (patrón `agent-data-backend.migration.test.ts`).
- T1.2/T1.3 (motor): `back/tests/skill-instructions.test.ts` — `SKILL_TOOL`
  presente; `buildAgentTools` monta `usar_skill` sólo con ≥1 skill instalada;
  `buildSystemPrompt` añade el índice 1-línea/skill + guía de uso (funciones
  puras).
- T1.4 (handler): mismo fichero — `usar_skill` sobre skill instalada devuelve
  cuerpo truncado con framing; sobre skill NO instalada → error honesto;
  fallback a `description` cuando `instructions` es null.
- T1.5 (curación): validación/cap/clear/gate de
  `PATCH /api/skills/:id/instructions`.
- T2.1 (servicio): `back/tests/agent-skills-install.test.ts` —
  set/replace/vaciar el conjunto, 404 agente, 400 ids inválidos (con lista),
  400 cap, dedupe, transaccionalidad (fallo → 0 cambios), shape `skillStatus`
  por TIPO de ejecución.
- T2.2 (ruta): mismo fichero — validación zod del body, 200 con `skillStatus`.
- T2.3 (regresión): asserts puros sobre `buildAgentTools`/`buildSystemPrompt`
  con `skills=[]` → salida idéntica a la actual (complementa
  `tests/skill-capabilities.test.ts` de F1).
- T3.1 (tab restaurada): typecheck front + paso manual: `?tab=skills` abre la
  tab, sin remap.
- T3.2 (badges): typecheck + verificación visual con Playwright: los tipos de
  ejecución renderizan y `requiere conectar` enlaza a Integraciones; ningún
  estado "inerte".
- T3.3 (editor del set): typecheck + paso manual: buscar → añadir → Guardar →
  badge actualizado con la respuesta del PUT.
- T4.1 (wizard): spec Playwright — crear agente SALTANDO el paso (no bloquea) y
  crear agente eligiendo un subconjunto de skills (aparecen en ReviewStep y
  quedan instaladas y ejecutables).

Regla del repo: tarea DONE solo con su test verde; sin spec, cambios
revertidos.
