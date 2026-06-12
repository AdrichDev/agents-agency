# Spec — Skills Execution Flow

**Estado**: Archived from P4 — skills-execution-flow (2026-06-12)

**Objetivo**: Skills asignadas ejecutables E2E: catálogo skill→tools sobre TOOLS_BY_PROVIDER + getValidToken; caso canónico booking de cita en Google Calendar desde widget/telegram/whatsapp.

---

## R1 — Catálogo skill → tools

El sistema MUST mantener un catálogo determinista, estático que mapee cada skill (matched por `Skill.use` field, con override opcional por `Skill.name`) a un conjunto de logical provider keys y sus herramientas correspondientes.

**R1-1 — Estructura del catálogo**

```
GIVEN un skill con use = "CALENDARIO"
WHEN el catálogo es consultado para ese skill
THEN devuelve { logicalProviders: ["calendar"], tools: ["list_calendar_events", "create_calendar_event"] }
```

**R1-2 — Skill desconocido**

```
GIVEN un skill cuyo valor use NO está en el catálogo
WHEN el catálogo es consultado
THEN devuelve no providers y no tools
 AND el skill se clasifica como "informative"
```

**R1-3 — Tabla canónica SKILL_USE_TO_PROVIDER**

Implementación: `back/src/lib/agent/skill-capabilities.ts`

| Skill Use | Logical Provider | Tools |
|---|---|---|
| `CALENDARIO` / `CALENDAR` | `calendar` | `list_calendar_events`, `create_calendar_event` |
| `EMAIL` / `GMAIL` | `gmail` | `send_email`, `search_emails`, `get_email` |
| `SLACK` | `slack` | `send_slack_message`, `search_messages` |
| `NOTION` | `notion` | `create_page`, `append_block`, `query_database` |

**NAME_OVERRIDES**: substring por `Skill.name`, case-insensitive, para resolver providers cuando el `use` no está explícito.

---

## R2 — Integración en el motor (runAgent)

Cuando `runAgent` comienza, el conjunto efectivo de herramientas MUST ser la unión de:
(a) herramientas de integraciones conectadas (lógica existente `toolsForProviders`)
(b) herramientas de skills asignados cuyo provider requerido aparece en `agent.integrations`

**R2-1 — Derivación de capabilities en runAgent**

```
GIVEN un agente con skills asignadas e integraciones conectadas
WHEN runAgent inicia
THEN:
     deriva connectedProviders de agent.integrations
     llama capabilitiesForSkills(skills, connectedProviders)
     une toolsForProviders(integraciones) con toolsForSkillProviders(caps.executableProviders)
     deduplica por tool.name (integraciones ganan en conflicto)
     filtra skills huérfanas (s.skill == null)
```

**R2-2 — Función capabilitiesForSkills**

```
GIVEN skills asignadas y connectedProviders (lista de provider strings)
WHEN se llama capabilitiesForSkills(...)
THEN devuelve { executableProviders, missingConnections, informationalSkills }:
     executableProviders = skills cuyo provider está en connectedProviders
     missingConnections = skills cuyo provider falta
     informationalSkills = skills sin entrada en catálogo
```

**R2-3 — Función buildSkillStatus**

```
GIVEN skills e integraciones conectadas
WHEN se llama buildSkillStatus(...)
THEN devuelve:
     [{ skillId, name, state: "executable"|"requires_connection"|"informational", provider? }]
```

**R2-4 — Prompt diferenciado**

```
GIVEN el system prompt de runAgent
WHEN se inyectan instructions
THEN:
     skills operativas = ejecutables con tools disponibles
     skills con integración pendiente = require provider
     system prompt instruye: "NO afirmes que ejecutaste; pide conectar si falta integración"
```

---

## R3 — Flujo de booking de citas (E2E)

Un agente con skill `CALENDARIO` y `google` conectado MUST soportar booking E2E.

**R3-1 — Validación de ISO 8601**

```
GIVEN un tool call a create_calendar_event con startIso y endIso
WHEN se procesan los parámetros
THEN:
     se valida que ambos sean ISO 8601 válidos
     se valida que endIso > startIso
     si alguno es inválido, devuelve error legible al modelo (no crash)
     error no se persiste en BD, permite retry
```

**R3-2 — Confirmación de datos**

```
GIVEN el usuario solicita una cita
WHEN el agente recibe el request
THEN:
     system prompt incluye guía de confirmación
     agente DEBE confirmar: fecha, hora, nombre, contacto
     ANTES de llamar create_calendar_event
```

**R3-3 — Reutilización de datos de lead-flow**

```
GIVEN un Lead capturado previamente con nombre/contacto
WHEN el agente procesa la cita
THEN:
     contextFacts inyectado en runAgent desde chatWithAgent
     agente reutiliza nombre/contacto capturado
     NO re-pregunta
```

**R3-4 — Test unitario E2E mockeado**

```
GIVEN mocks de calendar + getValidToken + Prisma
WHEN se simula: mensaje de reserva → list_calendar_events → create_calendar_event
THEN:
     toolCalls se registran
     Lead se crea si es necesario (upsert)
     sin error
```

---

## R4 — Frontend

**R4-1 — Endpoint que exponga skillStatus**

```
GIVEN GET /api/agents/:id
WHEN el endpoint retorna la data del agente
THEN:
     incluye campo skillStatus = buildSkillStatus(skills, connectedProviders)
```

**R4-2 — Badges en panel del agente**

```
GIVEN una skill renderizada en front/app/agents/[id]/page.tsx (pestaña "skills")
WHEN se renderiza el badge
THEN:
     "Ejecutable" (verde) si state = "executable"
     "Conecta {provider}" (amarillo) si state = "requires_connection"
     "Informativa" (gris) si state = "informational"
```

**R4-3 — CTA desde aviso de skill pendiente**

```
GIVEN un skill con state = "requires_connection"
WHEN el usuario ve el aviso
THEN:
     botón "Conecta {provider}" cambia tab a "integraciones"
     la UI navega al panel de ese provider
```

---

## R5 — Catálogo de providers a nivel de lógica

Mapping mínimo requerido en `skill-capabilities.ts`:

```typescript
const SKILL_USE_TO_PROVIDER: Record<string, string> = {
  CALENDARIO: 'calendar',
  CALENDAR: 'calendar',
  EMAIL: 'gmail',
  GMAIL: 'gmail',
  SLACK: 'slack',
  NOTION: 'notion',
  // ... más según demanda
}

const TOOLS_BY_PROVIDER = {
  calendar: ['list_calendar_events', 'create_calendar_event'],
  gmail: ['send_email', 'search_emails', 'get_email'],
  slack: ['send_slack_message', 'search_messages'],
  notion: ['create_page', 'append_block', 'query_database'],
  // ... según providers conectados
}
```

---

## R6 — Deduplicación de herramientas

Si dos skills mapean al mismo provider, las herramientas se deduplicarán por name.

```
GIVEN dos skills que ambas mapean a logical provider "calendar"
WHEN runAgent construye la lista de tools
THEN cada tool name aparece exactamente una vez
```

---

## R7 — Honest system prompt para skills desconectadas

Para cada skill asignado cuyo provider requerido NO está conectado, el system prompt MUST incluir instrucción legible indicando el nombre del skill y el provider faltante.

```
GIVEN skill "CALENDARIO" asignado pero "google" no conectado
WHEN el usuario pregunta "¿puedes reservarme una cita?"
THEN el agente responde explicando que el calendario no está conectado
 AND sin pretender haber creado un evento
```

---

## Cases de borde

**CB-1 — Integración desconectada después de asignar skill**

```
GIVEN skill "CALENDARIO" fue asignado mientras "google" estaba conectado
  Y luego "google" fue removido
WHEN runAgent es llamado luego
THEN las herramientas de calendar están ausentes
 AND el system prompt nota sobre conexión faltante está presente
```

**CB-2 — Skill sin entrada en catálogo**

```
GIVEN un skill con use = "UNKNOWN_PROVIDER"
WHEN capabilitiesForSkills lo procesa
THEN es clasificado como "informational"
 AND su nombre/descripción aparecen en el system prompt
 AND MUST NOT ser tratado como ejecutable
```

**CB-3 — Skill.skill == null (huérfano)**

```
GIVEN un AgentSkill con skill == null (referencia borrada)
WHEN runAgent filtra huérfanos en R2-1
THEN ese AgentSkill es excluído
 AND no introduce tools ni aparece en skillStatus
```

---

## Technical Debt

**P5 — Playwright e2e**

- [ ] Panel del agente muestra estado de skill (ejecutable / pendiente) con datos mockeados.
  - Estimated effort: 12h. Priority: low (deferred to integration testing).

---

## Implementation Status

- [x] Catálogo `SKILL_USE_TO_PROVIDER` + `TOOLS_BY_PROVIDER`
- [x] Función `capabilitiesForSkills` (proveedores ejecutables, pendientes, informativos)
- [x] Función `buildSkillStatus` para UI
- [x] Integración en `runAgent` de engine.ts
- [x] System prompt diferenciado (skills operativas vs. pendientes)
- [x] Validación ISO 8601 para `startIso`/`endIso` en booking
- [x] Guía de confirmación de datos en system prompt
- [x] Lead-flow integration (reutilización de nombre/contacto)
- [x] Endpoint GET /api/agents/:id con skillStatus
- [x] Frontend badges por estado de skill
- [x] CTA "Conecta {provider}" desde aviso pendiente
- [x] Vitest: 28 tests nuevos en skill-capabilities.test.ts
- [x] Total 128 tests, todos verdes
- [ ] Playwright e2e (P5)
