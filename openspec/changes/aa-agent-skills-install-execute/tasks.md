# Tasks — aa-agent-skills-install-execute

Orden crítico Nivel 1: **motor de instrucciones (garantiza el invariante) →
endpoint de instalación → panel → wizard → verificación**. Nivel 2 (F2b, tools
MCP externas) es fase POSTERIOR y no arranca hasta cerrar y archivar Nivel 1.
Cada tarea está DONE solo cuando su test está verde (convención del repo).
`[reusa]` = se apoya en código existente; `[nuevo]` = se crea de cero.

Invariante que estas tareas deben cumplir: **toda skill instalada (elegida de
forma curada para ese agente) es ejecutable** — como mínimo a nivel instrucción
vía `usar_skill`, y con tools reales si declara `toolsProvider`/MCP.

## NIVEL 1

### Fase 1 — Motor de instrucciones (núcleo del invariante, F2a)

- [x] T1.1 [nuevo] `prisma/schema.prisma`: `Skill.instructions String?`
  (`instrucciones`) + `instructionsUpdatedAt DateTime?`; migración aditiva
  (ningún DROP). null permitido = skill instalable sin cuerpo curado (baseline
  cae a `description`/`use`).
  Test: migración validada en BD local desechable (patrón
  `agent-data-backend.migration.test.ts`).
- [x] T1.2 [nuevo] `back/src/lib/agent/tools.ts`: `SKILL_TOOL` (`usar_skill`)
  con descripción de invocación contextual (carga instrucciones de una skill
  instalada cuando la petición del usuario encaja con su descripción).
  Test: forma parte de `skill-instructions.test.ts`.
- [x] T1.3 [reusa] `back/src/lib/agent/engine.ts`: `buildAgentTools` monta
  `SKILL_TOOL` solo si el agente tiene ≥1 skill instalada (patrón
  `enabledBackendCapabilities`, `engine.ts:80-86`). `buildSystemPrompt` añade
  el índice compacto (1 línea/skill instalada) + instrucción de uso de
  `usar_skill` + framing anti-inyección.
  Test: gating de `SKILL_TOOL` + índice del prompt (funciones puras) en
  `skill-instructions.test.ts`.
- [x] T1.4 [reusa] `back/src/lib/agent/executor.ts`: handler `usar_skill` —
  verifica `AgentSkill` del agente (skill NO instalada → error honesto, nunca
  contenido), trunca a 8000 chars, envuelve con framing de contenido no
  confiable; fallback a `description`/`use` cuando `instructions` es null
  (garantiza ejecutabilidad de toda skill instalada).
  Test: handler (instalada/no instalada/truncado/framing/fallback) en
  `skill-instructions.test.ts`.
- [x] T1.5 [nuevo] `back/src/routes/skills.ts`:
  `PATCH /api/skills/:id/instructions` (set/clear, cap 32 KB, 400/404 — mismo
  patrón estricto que `tools-provider`, `:94-120`). Gate humano de curación.
  Azúcar: acción `importInstructions` que trae `SKILL.md` de `repoUrl` UNA vez
  como BORRADOR a revisión; nunca publica sin curación.
  Test: `skill-instructions.test.ts` (validación, cap, clear, gate).

### Fase 2 — Endpoint de instalación (edita el set curado)

- [x] T2.1 [nuevo] `back/src/lib/agent/service.ts`: `setAgentSkills(agentId,
  skillIds)` — valida agente (404) y existencia de todos los skillIds (400 con
  lista de inválidos), dedupe, cap `MAX_INSTALLED_SKILLS = 15`, transacción
  `deleteMany` + `createMany` sobre `AgentSkill`; devuelve `skillStatus` vía
  `buildSkillStatus` [reusa] con las integraciones del agente.
  Test: `agent-skills-install.test.ts` — set/replace/vaciar, 404, 400 ids
  inválidos, 400 cap, dedupe, shape de `skillStatus`.
- [x] T2.2 [nuevo] `back/src/routes/agents.ts`: `PUT /:id/skills` con schema
  zod (`skillIds: z.array(z.string().min(1))`), `validate.body`,
  `asyncHandler` → `setAgentSkills` (patrón de `PATCH /:id/backend`).
  Test: casos de ruta en `agent-skills-install.test.ts` (validación zod, 200
  con `skillStatus`).
- [x] T2.3 [reusa] Regresión cero: agente sin `AgentSkill` produce tools
  (sin `usar_skill`) y system prompt (sin índice) idénticos a los actuales.
  Test: asserts sobre `buildAgentTools`/`buildSystemPrompt` con `skills=[]`.

### Fase 3 — Panel: tab Skills restaurada como editor del set

- [x] T3.1 [reusa] `front/app/agents/[id]/page.tsx`: añadir
  `{ id: "skills", label: "Skills" }` a `TABS` y eliminar el remap legado de
  `?tab=skills`.
  Test: typecheck front + paso manual (enlace `?tab=skills` abre la tab).
- [x] T3.2 [reusa] `front/components/agents/SkillsTab.tsx`: sección
  "Instaladas" (las skills ELEGIDAS de este agente) con badges por TIPO de
  ejecución desde `agent.skillStatus` (`instrucción` / `instrucción +
  <provider>` conectado / `requiere conectar <provider>`); botón quitar; enlace
  a Integraciones cuando falta el provider. Ningún estado significa "inerte".
  Test: typecheck + verificación visual (patrón
  crm-front-playwright-visual-check).
- [x] T3.3 [reusa] `SkillsTab.tsx`: sección "Marketplace" con buscador paginado
  (`useSkillsMarketplace.ts`) para AÑADIR al conjunto (selección curada, no en
  bloque) + quitar en memoria + Guardar → `PUT /api/agents/:id/skills`;
  refresco de `skillStatus` con la respuesta.
  Test: typecheck + paso manual elegir→guardar→badge correcto.

### Fase 4 — Wizard: SkillsStep opcional (selección curada inicial)

- [x] T4.1 [reusa] `front/app/agents/new/page.tsx`: reinsertar `SkillsStep`
  DESPUÉS de "Datos del negocio", rotulado opcional ("elige las skills que este
  agente necesita para su función") y skippable; `blockedReason()` NO lo
  valida. `ReviewStep` muestra las skills elegidas. Cero cambios de back
  (`createAgentSchema` ya acepta `skillIds`; `createAgent` ya persiste,
  `service.ts:134`).
  Test: typecheck front + spec Playwright del wizard (paso skippable; creación
  con y sin skills elegidas).

### Fase 5 — Verificación Nivel 1

- [x] T5.1 `cd back && npm test && npm run typecheck` (suite verde, sin
  regresiones). VERIFICADO 2026-07-17: 892 passed / 3 skipped; typecheck 0 errores. 8 fallos en `openai-agent-client.test.ts` PRE-EXISTENTES y ajenos (0 diff en `openai.ts`).
- [x] T5.2 `cd front && npm run typecheck`. VERIFICADO 2026-07-17: EXIT 0, limpio.
- [ ] T5.3 Invariante verificado: instalar una skill de SOLO instrucciones
  (sin `toolsProvider`) y comprobar que el agente la invoca vía `usar_skill` y
  actúa sobre sus instrucciones; instalar una con `toolsProvider="calendar"` +
  Google conectado y comprobar que además monta las tools calendar.
- [ ] T5.4 Retrocompat: con 0 `AgentSkill`, chat de un agente existente sin
  cambio observable.
- [x] T5.5 `sdd-verify` (2026-07-17): VERDICT **PASS** (Nivel 1, AC0-AC7 contra código real, Engram #941). 0 critical / 2 warning / 1 suggestion. back+front typecheck 0, 32 tests N1 verdes. Falta code-review humano + commit (HITL). Hallazgo: N2 back YA committeado dormido (kill-switch `MCP_SKILLS_ENABLED` OFF), no "sin empezar" — regresión-cero N1 intacta.

## NIVEL 2 — F2b: tools externas MCP (fase posterior, NO arranca sin Nivel 1 archivado)

### Fase 6 — Skills MCP ejecutables curadas

- [ ] T6.1 [nuevo] `prisma/schema.prisma`: `Skill.mcpUrl`, `Skill.mcpTransport`
  (`http|sse`); `AgentSkill.secretEncrypted` (cifrado `enc:v1:` con
  `encryptToken` [reusa] — per-agente, jamás token global). Migración aditiva.
  Test: migración en BD local desechable.
- [ ] T6.2 [reusa] `setAgentSkills` (D8): preservar `secretEncrypted` de las
  skills que sobreviven al reemplazo del `PUT` (upsert de las que siguen en vez
  de delete+create), o endpoint aparte para el secreto.
  Test: el `PUT` que reinstala una skill NO borra su secreto.
- [ ] T6.3 [nuevo] `back/src/lib/mcp/client.ts`: cliente/pool MCP con allowlist
  `MCP_SKILL_ALLOWED_HOSTS`, timeout duro (def. 10 s), kill switch
  `MCP_SKILLS_ENABLED` (default OFF → degrada a baseline de instrucción,
  fail-soft), cache TTL del listado de tools.
  Test: `mcp-skill-client.test.ts` contra server MCP fake (allowlist, timeout,
  kill switch).
- [ ] T6.4 [reusa] `engine.ts`: montar tools MCP namespaced
  `skill__<slug>__<tool>` (sin colisión con dedup de integraciones);
  `executor.ts`: router de prefijo `skill__` → cliente MCP con secreto
  per-agente descifrado.
  Test: namespacing + routing + fail-soft server caído.
- [ ] T6.5 [reusa] `skill-capabilities.ts:buildSkillStatus`: badge
  `instrucción + MCP` / `MCP pendiente` (falta secreto) + `SkillsTab.tsx`.
  Test: casos nuevos en `skill-capabilities.test.ts` + typecheck front.

### Fase 7 — Verificación Nivel 2

- [ ] T7.1 Suites back verdes + typecheck front.
- [ ] T7.2 `prisma migrate status` OK en prod (código mergeado ≠ funcionando).
- [ ] T7.3 Red-team básico de prompt injection: SKILL.md hostil curado en
  sandbox NO consigue saltarse reglas de sistema (handoff, honestidad).
- [ ] T7.4 Aislamiento: secreto MCP de un agente jamás usable desde otro; host
  fuera de allowlist bloqueado.
- [ ] T7.5 `sdd-verify` / `/code-review` antes de commit.
