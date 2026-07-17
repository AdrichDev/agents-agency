# Proposal — aa-agent-skills-install-execute

## Intent

Convertir el marketplace de skills (tabla `Skill`, 108 filas) en una facultad
**instalable y ejecutable** de los agentes de producto de AA, al estilo de los
agentes/subagentes de Claude Code: el agente ve el nombre+descripción de sus
skills instaladas y, durante la conversación, invoca la relevante (progressive
disclosure — las instrucciones completas se cargan bajo demanda, nunca todas a
la vez), y actúa sobre ellas.

Visión de fondo (usuario): construir sistemas agénticos autónomos ya cableados
(instalación + ejecución + datos) donde lo único que se enchufa al final es el
modelo de razonamiento LLM. Este cambio cablea la capa de skills de esa visión.

**Selección curada por-agente (no auto-instalación).** Las skills NO se
instalan todas por defecto. Al crear el agente se ELIGE el subconjunto pequeño
de skills relevante a SU función (no las 108 del catálogo), y ese conjunto es
editable después desde el panel. El invariante "instalada ⇒ ejecutable" aplica
a las skills que el operador elige instalar en ESE agente; el cap de 15
skills/agente refuerza que es una selección curada, no una instalación masiva.

## Invariante rector: instalada ⇒ ejecutable

**TODA skill instalada en un agente es ejecutable, sin excepción.** No existe la
categoría "instalada pero inerte". Igual que un subagente de Claude Code puede
usar CUALQUIER skill que tenga instalada, aquí toda `AgentSkill` es actuable:

- **Baseline universal (nivel instrucción)**: cualquier skill instalada carga
  sus instrucciones curadas bajo demanda vía una tool genérica `usar_skill`, y
  el agente actúa sobre ellas usando sus capacidades base. Esto cubre el 100%
  del marketplace — igual que la mayoría de skills de Claude Code, que son solo
  un SKILL.md que guía comportamiento sin traer tools propias.
- **Capa de tools reales (encima del baseline)**: además, una skill puede
  aportar tools ejecutables según lo que DECLARE:
  - `toolsProvider` (F1, ya cableado): integraciones gmail/calendar/jira/slack/
    ecommerce.
  - MCP (F2b, extensión posterior): tools externas vía server MCP curado.
  - Una skill sin tools declaradas se ejecuta a nivel instrucción usando las
    capacidades base del agente (RAG, backend de datos, integraciones ya
    conectadas). Sigue siendo ejecutable.

## Nota explícita — reversión parcial de dirección

`aa-agent-backend-foundation` OCULTÓ el paso Skills del wizard (T4.3) y retiró
la tab Skills del panel (design.md §C), con el argumento de que las skills
ejecutables solo re-expresaban lo que Integraciones ya daba. Este cambio
**revierte deliberadamente esa dirección**: las skills vuelven como facultad
instalable Y ejecutable de primera clase — y ahora con una semántica más fuerte
(instalada ⇒ ejecutable) que la que existía cuando se ocultaron. NO se revierte
lo demás: el paso "Datos del negocio", el backend `managed_db` y la estructura
de tabs se mantienen; Skills vuelve como tab ADICIONAL. La decisión de F4.3 de
conservar motor, datos y marketplace intactos es lo que hace barata la
reversión: `Skill`/`AgentSkill`, `buildSkillStatus`, el path de skills del
engine y `/skills` siguen vivos.

## Problemas que resuelve

1. **No hay superficie de instalación.** `skillIds` solo se acepta al CREAR el
   agente (`createAgentSchema`, `back/src/routes/agents.ts`; `createAgent`
   crea `AgentSkill` en `service.ts:134`), y el wizard ya no lo expone. No
   existe endpoint para añadir/quitar skills a un agente existente. Resultado
   real: **0 filas `AgentSkill` en prod** — todo el pipeline de ejecución está
   construido y sin uso.
2. **El marketplace es un catálogo muerto.** 108 skills scrapeadas con
   `tools Json` y `repoUrl` que ningún agente puede usar.
3. **Instalar ≠ ejecutar (a corregir).** Hoy solo serían ejecutables las
   skills con `toolsProvider` mapeado a una de las 5 familias; cualquier otra
   quedaría "informativa" — una línea de texto fija en el prompt
   (`buildSystemPrompt`, `engine.ts:189-202`) sin progressive disclosure (o
   siempre en el prompt, o nada). El invariante "instalada ⇒ ejecutable"
   elimina esa categoría inerte: `usar_skill` da ejecución a nivel instrucción
   a todas.

## Scope

### Sí — Nivel 1 (esta fase): instalación + motor de ejecución universal

Nivel 1 entrega la superficie de instalación Y el motor de instrucciones
JUNTOS, porque F2a (instrucciones + `usar_skill`) es precisamente lo que hace
que "instalar = ejecutable". No tiene sentido entregar la instalación sin el
motor que garantiza el invariante.

- **Selección curada**: al crear el agente, el wizard (`SkillsStep`, opcional)
  elige el subconjunto de skills relevante a su función → `AgentSkill`.
  `PUT /api/agents/:id/skills` edita ese conjunto después (reemplazo
  declarativo sobre `AgentSkill`), validado, transaccional, cap 15. Nunca se
  instala el catálogo entero.
- **Motor de instrucciones (núcleo)**: `Skill.instructions` (snapshot curado)
  + tool genérica `usar_skill` que carga el cuerpo bajo demanda (modelo
  Skill-tool de Claude Code); el prompt lleva 1 línea por skill instalada. Gate
  humano de curación (anti prompt-injection). Esto GARANTIZA el invariante:
  toda skill instalada, como mínimo, es ejecutable a nivel instrucción.
- Ejecución de tools de `toolsProvider` sin cambios (F1 ya cablea gmail/
  calendar/jira/slack/ecommerce) — se suma al baseline de instrucción.
- Tab **Skills** restaurada en el panel (`front/app/agents/[id]/page.tsx`):
  selector de marketplace + estado per-skill reutilizando `buildSkillStatus`
  (ya servido por `getAgentDetail`, `service.ts:391,425`). El estado indica el
  TIPO de ejecución (instrucción / instrucción+provider), no "ejecutable vs
  inerte".
- Re-activar `SkillsStep` en el wizard como paso OPCIONAL (skippable) — el
  schema zod ya acepta `skillIds` con default `[]`.

### Sí — Nivel 2 (fase posterior, depende de Nivel 1): tools externas MCP

- **F2b — skills MCP ejecutables curadas**: `Skill.mcpUrl` + cliente MCP con
  allowlist, tools namespaced `skill__*`, secretos per-agente cifrados, kill
  switch. Para skills que necesitan ACCIONES externas reales más allá de
  instrucción+providers. Materializa el "Phase 2 sketch" ya escrito en
  aa-skills-executable-contract/design.md.

### No — fuera de scope

- Ejecución de código arbitrario de los repos de skills (nunca: ver Riesgos).
  El baseline es texto (instrucciones); las tools reales son providers (F1) o
  MCP remoto curado (F2b).
- Auto-instalación de skills por el propio LLM (instala el operador).
- Instalar el catálogo entero por defecto en un agente: la selección es curada
  y explícita por-agente, siempre acotada por el cap de 15.
- Marketplace multi-tenant self-serve (instala la agencia desde el panel).
- Borrado o refactor del contrato F1 `toolsProvider` (se extiende, no se
  sustituye).

## Corrección de documentación (F1)

El comentario de `schema.prisma:231` y el proposal de F1 mencionan `notion`
como una de las claves de `TOOLS_BY_PROVIDER`, pero la clave real implementada
es **`jira`** (`back/src/lib/agent/tools.ts:83-106`). Este cambio usa `jira` en
toda la documentación y anota la discrepancia para su corrección.

## Risks

- **Prompt injection desde el marketplace.** `repoUrl` apunta a repos GitHub
  arbitrarios: un SKILL.md hostil cargado por `usar_skill` puede intentar
  manipular al agente. Como el baseline UNIVERSAL ahora es cargar instrucciones,
  este riesgo aplica a toda skill instalada, no a un subconjunto. Mitigación:
  `instructions` es un snapshot curado por un admin (nunca fetch en runtime),
  cap de tamaño, framing de contenido no confiable en el output de `usar_skill`,
  y las reglas de sistema (estilo/honestidad/handoff) preceden y prevalecen.
- **Aislamiento de credenciales MCP (F2b).** Repetir el patrón
  `OPERATOR_SERVICE_TOKEN` único cruzaría tenants: los secretos MCP son
  per-agente y cifrados `enc:v1:` (`encryptToken`,
  `back/src/lib/integrations/oauth.ts`).
- **Inflado de contexto.** Con instalada⇒ejecutable, cada skill mete al menos 1
  línea de índice al prompt y expone `usar_skill`. Mitigación: cap
  `MAX_INSTALLED_SKILLS = 15`, descripciones compactas, el cuerpo solo entra
  bajo demanda (no todas las instrucciones a la vez), namespacing `skill__*` y
  la dedup existente (`buildAgentTools`, `engine.ts:104-114`).
- **Reversión de UX.** El panel acaba de quitar la tab Skills; volver a
  añadirla exige coordinar con la reestructura de tabs (redirect legado
  `?tab=skills`) sin reintroducir confusión: la tab muestra ejecución real, no
  un catálogo decorativo.
- **Retrocompat.** Hoy 0 `AgentSkill` en prod: el cambio es invisible hasta
  instalar la primera skill (regresión cero, criterio de F1).

## Dependencies

- aa-skills-executable-contract (F1) — SHIPPED: `Skill.toolsProvider`,
  `logicalProviderForSkill` / `capabilitiesForSkills` / `buildSkillStatus`
  (`back/src/lib/agent/skill-capabilities.ts`), curación
  `PATCH /api/skills/:id/tools-provider` (`back/src/routes/skills.ts`).
- aa-agent-backend-foundation — SHIPPED en rama: estructura de tabs, patrón de
  gating condicional de tools (`enabledBackendCapabilities`, `engine.ts:80-86`)
  que el motor de skills imita.
- Engine y executor: `buildAgentTools` / `buildSystemPrompt` / `runToolLoop`
  (`back/src/lib/agent/engine.ts`), `executeTool`
  (`back/src/lib/agent/executor.ts`).
- `encryptToken`/`decryptToken` (`back/src/lib/integrations/oauth.ts`) —
  cifrado de secretos per-skill en F2b.
- Front conservado: `front/components/agents/SkillsTab.tsx`,
  `front/components/agent-wizard/SkillsStep.tsx`, `useWizardSkills.ts`,
  `useSkillsMarketplace.ts`.
