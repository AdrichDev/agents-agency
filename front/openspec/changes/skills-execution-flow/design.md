# Design — skills-execution-flow

Canal objetivo: **todos** (widget / api / telegram / whatsapp comparten `chatWithAgent`).
Fecha: 2026-06-12
Estado: design-ready
Fuente: `proposal.md` + `spec.md` (R1-R8) + código real (engine.ts, tools.ts, executor.ts,
service-map.ts, lead-flow.ts, schema.prisma) + decisiones P4 (D-P4-1..3) + design P2
(`oauth-integrations/design.md`: AD4 `LOGICAL_TO_PHYSICAL`, `getValidToken`, `service-map`).

---

## 0. Decisiones de arquitectura (ADR resumido)

| ID | Decisión | Alternativa rechazada | Razón |
|---|---|---|---|
| AD1 | Pieza nueva única: `back/src/lib/agent/skill-capabilities.ts`. Catálogo estático `SKILL_USE_TO_PROVIDER` + `NAME_OVERRIDES` + función pura `capabilitiesForSkills(skills, connectedProviders)`. | Ampliar `tools.ts`; o `skill-tools.ts` (nombre de tasks.md) | `tools.ts` define el catálogo físico de tools; mezclar el mapa skill→capacidad rompe SRP. Módulo separado, puro y testeable sin Prisma. Nombre `skill-capabilities` (D-P4 reciente) supersede `skill-tools` de tasks.md (ver §11). |
| AD2 | Catálogo por `Skill.use` (UPPERCASE) con override por `Skill.name` (substring, case-insensitive). Semilla: `CALENDARIO/CALENDAR→calendar`, `EMAIL/GMAIL→gmail`, `SLACK→slack`, `NOTION→notion`. Sin entrada → informativa. | Mapeo por `name` exacto; o por `tools` scrapeadas | D-P4-1. `use` agrupa la intención funcional; `name` desambigua falsos positivos. Las tools scrapeadas (`Skill.tools`) son metadatos de marketplace sin handler → no son fuente de ejecutabilidad. NUNCA fingir ejecutabilidad. |
| AD3 | `capabilitiesForSkills` devuelve `{ executableProviders, missingConnections, informationalSkills }`. Una sola función alimenta motor (tools+prompt) y, vía respuesta tipada, el front (badges). | Tres funciones (`toolsForSkills`/`skillStatus`/...) | Una pasada determinista sobre `skills × connectedProviders`. El front la reusa importando un helper TS espejo o consumiendo el shape `skillStatus` del GET ya existente (§6). |
| AD4 | Reutilizar `LOGICAL_TO_PHYSICAL`/`toPhysicalProvider` de `service-map.ts` (P2) para resolver `provider lógico → físico`. El catálogo de skills mapea a claves **lógicas** (`calendar`, `gmail`...), nunca físicas. | Mapear skill→provider físico directo | Coherencia con AD4 de P2 (no renombrar claves lógicas). Una skill `calendar` se resuelve a fila física `google` con `toPhysicalProvider("calendar")="google"`. |
| AD5 | Unión de tools en `runAgent` = `toolsForProviders(integrations) ∪ toolsForSkillProviders(executableProviders)`, dedup por `tool.name`, primera ocurrencia (integraciones) gana. | Recalcular todo desde skills | R2. La integración conectada ya expone sus tools; la skill solo **habilita** las suyas si su físico está conectado. Dedup evita duplicar `create_calendar_event` cuando hay integración Google + skill calendario. |
| AD6 | Booking E2E SIN motor nuevo: prompt guidance + tools `list_calendar_events`/`create_calendar_event` existentes + validación ISO en el handler `create_calendar_event` (executor). | Máquina de estados de booking dedicada | R4. El loop agéntico ya razona la confirmación de datos. El único refuerzo determinista es validar `startIso`/`endIso` antes de la API real (evita ISO inválidos del LLM). |
| AD7 | Datos de contacto del booking se toman del `Lead` activo (inyectados en el system prompt como hechos conocidos) para no re-preguntar. El upsert de `Lead` al confirmar cita reusa la rama `lead.upsert` ya existente en `chatWithAgent`. | Pedir nombre/email dentro del booking | R4 "Lead data reuse". `nextLeadFlowStep` corre ANTES de `runAgent` (D-P4-2 intacto); cuando el flujo está en `assisting` el nombre ya está en `leadFlow.customerName`. |
| AD8 | Sin endpoint nuevo. El GET `/api/agents/:id` (index.ts:124) ya incluye `integrations` (con `provider`) y `skills.skill`. El back añade un campo derivado `skillStatus` a esa respuesta; el front no hace requests extra. | `GET /api/agents/:id/skill-status` | Lo más simple (tarea 4.1). Toda la info ya viaja en el GET; solo falta derivar el estado server-side con la misma función pura del motor. |
| AD9 | Sin cambios de schema. Reutiliza `Skill.use`/`name`/`tools`, `AgentSkill`, `Integration.provider`, `Message.toolCalls`. | Columna `Skill.executable` o tabla de mapeo | El catálogo es código (estático, versionado, testeable). Persistirlo añade migración y deriva sin ganancia. Rollback = revertir código. |

---

## 1. Arquitectura de módulos

```
back/src/lib/agent/
  skill-capabilities.ts   # NUEVO. SKILL_USE_TO_PROVIDER, NAME_OVERRIDES,
                          #   capabilitiesForSkills() puro, toolsForSkillProviders(),
                          #   buildSkillStatus() para el GET
  tools.ts                # SOLO LECTURA. TOOLS_BY_PROVIDER, toolsForProviders,
                          #   PHYSICAL_TO_LOGICAL (google→[gmail,calendar])
  executor.ts             # +validación ISO en create_calendar_event (§4)
  engine.ts               # runAgent: unión de tools + system prompt diferenciado (§3)
back/src/lib/integrations/
  service-map.ts          # SOLO LECTURA. LOGICAL_TO_PHYSICAL, toPhysicalProvider
back/src/index.ts         # GET /api/agents/:id: + campo skillStatus derivado (§6)
front/
  components/agent-wizard/SkillsStep.tsx   # badge informativo "necesitará conexión X"
  app/agents/[id]/page.tsx (panel skills)  # badge con estado real (§7)
```

Responsabilidades (SRP):
- **`skill-capabilities.ts`** — sin Prisma ni Express. Recibe `skills` (forma mínima
  `{ id, name, use }[]`) y `connectedProviders: string[]` (físicos), devuelve capacidades.
  Función pura → testeable directo.
- **`engine.ts`** — orquesta: deriva `connectedProviders` de `agent.integrations`, llama
  `capabilitiesForSkills`, une tools, construye el prompt diferenciado.
- **`executor.ts`** — valida ISO antes de `calendar.createEvent`.
- **`index.ts`** — añade `skillStatus` al GET reusando `buildSkillStatus`.

---

## 2. Catálogo y función pura — `skill-capabilities.ts`

```ts
import { TOOLS_BY_PROVIDER } from "@/lib/agent/tools";
import { toPhysicalProvider } from "@/lib/integrations/service-map";
import type { ToolDefinition } from "@/lib/agent/types";

/** use (UPPERCASE) → proveedor lógico de tools.ts */
export const SKILL_USE_TO_PROVIDER: Record<string, string> = {
  CALENDARIO: "calendar",
  CALENDAR: "calendar",
  EMAIL: "gmail",
  GMAIL: "gmail",
  SLACK: "slack",
  NOTION: "notion",
};

/** Override por substring del name (case-insensitive). Gana sobre use. */
export const NAME_OVERRIDES: Array<{ match: string; provider: string }> = [
  { match: "calendar", provider: "calendar" },
  { match: "calendario", provider: "calendar" },
  { match: "gmail", provider: "gmail" },
  { match: "slack", provider: "slack" },
  { match: "notion", provider: "notion" },
];

export interface SkillInput { id: string; name: string; use: string }

/** Resuelve el proveedor lógico de UNA skill, o null si es informativa. */
export function logicalProviderForSkill(skill: SkillInput): string | null {
  const name = (skill.name ?? "").toLowerCase();
  const override = NAME_OVERRIDES.find((o) => name.includes(o.match));
  if (override) return override.provider;
  const use = (skill.use ?? "").toUpperCase();
  return SKILL_USE_TO_PROVIDER[use] ?? null;
}

export interface SkillCapabilities {
  /** proveedores lógicos ejecutables (su físico está conectado) */
  executableProviders: string[];
  /** skills mapeadas cuyo físico NO está conectado */
  missingConnections: Array<{ skillId: string; name: string; provider: string; physical: string }>;
  /** skills sin entrada en el catálogo (siguen siendo informativas) */
  informationalSkills: Array<{ skillId: string; name: string }>;
}

/**
 * Función PURA. connectedProviders = providers FÍSICOS de agent.integrations.
 * No toca Prisma ni red.
 */
export function capabilitiesForSkills(
  skills: SkillInput[],
  connectedProviders: string[]
): SkillCapabilities {
  const connected = new Set(connectedProviders);
  const executable = new Set<string>();
  const missing: SkillCapabilities["missingConnections"] = [];
  const info: SkillCapabilities["informationalSkills"] = [];

  for (const s of skills) {
    const logical = logicalProviderForSkill(s);
    if (!logical) { info.push({ skillId: s.id, name: s.name }); continue; }
    const physical = toPhysicalProvider(logical);          // calendar → google
    if (connected.has(physical)) executable.add(logical);
    else missing.push({ skillId: s.id, name: s.name, provider: logical, physical });
  }
  return { executableProviders: [...executable], missingConnections: missing, informationalSkills: info };
}

/** Tools derivadas de las skills ejecutables (sin KNOWLEDGE_TOOL, sin dedup global). */
export function toolsForSkillProviders(executableProviders: string[]): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const lp of executableProviders) out.push(...(TOOLS_BY_PROVIDER[lp] ?? []));
  return out;
}
```

**Edge cases cubiertos:**
- Skill huérfana (skill borrada del marketplace pero `AgentSkill` vivo): el motor filtra
  `agent.skills` por `s.skill != null` antes de llamar a la función → no entra como
  informativa ni rompe (R7 "Deleted Marketplace Skill").
- Sin skills → `capabilitiesForSkills([], ...)` devuelve listas vacías → sin sección de
  prompt, sin tools extra → regresión cero (R8).
- Dedup entre dos skills que mapean al mismo `calendar` → `Set` colapsa a un proveedor.

---

## 3. Motor — cambios en `runAgent` (engine.ts)

### 3.1 Unión de tools (líneas ~24-36)

```ts
const agent = await prisma.agent.findUniqueOrThrow({
  where: { id: agentId },
  include: { integrations: true, skills: { include: { skill: true } } },
});

const connectedProviders = agent.integrations.map((i: any) => i.provider); // físicos
const skillInputs = agent.skills
  .filter((s: any) => s.skill)                              // R7: ignora huérfanas
  .map((s: any) => ({ id: s.skillId, name: s.skill.name, use: s.skill.use }));

const caps = capabilitiesForSkills(skillInputs, connectedProviders);

// Unión integraciones ∪ skills ejecutables, dedup por name (integraciones ganan).
const baseTools = toolsForProviders(connectedProviders);
const skillTools = toolsForSkillProviders(caps.executableProviders);
const seen = new Set(baseTools.map((t) => t.name));
const mergedDefs = [...baseTools];
for (const t of skillTools) if (!seen.has(t.name)) { seen.add(t.name); mergedDefs.push(t); }

const tools = mergedDefs.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));
```

Nota: como `google` conectado ya expande a `[gmail, calendar]` vía `PHYSICAL_TO_LOGICAL`
en `toolsForProviders`, una skill `calendar` con Google conectado NO añade tools nuevas
(dedup las absorbe). El valor de la skill ejecutable está en el **prompt** (§3.2): le dice
al agente que ESA capacidad está activa. Si en el futuro hay un provider lógico sin
integración 1:1 (p.ej. skill que use solo `calendar` sin que Google exponga gmail), la
unión lo cubre.

### 3.2 System prompt diferenciado (líneas ~38-50)

Tres bloques, solo si hay skills (R8: sin skills → sin sección):

```ts
const execNames = agent.skills
  .filter((s: any) => s.skill && caps.executableProviders.includes(logicalProviderForSkill(...)))
  .map((s: any) => `- ${s.skill.name}: ${s.skill.description}`);

const missingNotes = caps.missingConnections
  .map((m) => `- ${m.name}: requiere conectar "${m.physical}" en Integraciones. ` +
              `Si el usuario te pide esta capacidad, explícale honestamente que falta esa conexión; NO inventes que la ejecutaste.`);

const infoNotes = caps.informationalSkills
  .map((s) => { const sk = agent.skills.find((x:any)=>x.skillId===s.skillId)?.skill;
                return `- ${sk.name}: ${sk.description}`; });

const skillSections = [
  execNames.length && `Skills ejecutables (PUEDES usar sus herramientas ahora mismo):\n${execNames.join("\n")}`,
  missingNotes.length && `Capacidades que requieren conexión pendiente:\n${missingNotes.join("\n")}`,
  infoNotes.length && `Skills informativas (contexto, sin acción ejecutable):\n${infoNotes.join("\n")}`,
].filter(Boolean);
```

Estas secciones sustituyen al bloque actual `skillNotes` / "Skills instaladas". Se concatenan
en el `system` con `.filter(Boolean).join("\n\n")` igual que hoy.

**Regla anti-alucinación (R3):** el bloque `missingNotes` es la instrucción
máquina-legible que el spec exige (nombre de skill + provider físico faltante + mandato de
honestidad). El agente nunca debe afirmar que ejecutó una capacidad sin conexión.

---

## 4. Booking E2E — guidance + validación (sin motor nuevo)

### 4.1 Fragmento de system prompt de booking

Se añade SOLO si `caps.executableProviders.includes("calendar")`:

```
Reserva de citas: cuando el usuario quiera una cita, sigue este flujo antes de
crear nada:
1. Comprueba disponibilidad con list_calendar_events para el rango pedido.
2. Confirma con el usuario: título/motivo, fecha y hora exactas (inicio y fin).
3. NO vuelvas a pedir nombre ni email si ya los conoces (ver datos del contacto abajo).
4. Crea el evento con create_calendar_event usando ISO 8601 (startIso < endIso).
5. Confirma al usuario la cita creada con fecha y hora legibles.
```

### 4.2 Inyección de datos de contacto conocidos (no re-preguntar, R4)

`chatWithAgent` ya carga `leadFlow` desde `conversation.metadata` y, cuando existe, el
`Lead` de la conversación. Antes de `runAgent`, se construye un bloque de hechos:

```ts
const lead = await prisma.lead.findUnique({ where: { conversationId: conversation.id } });
const knownContact = [
  leadFlow.customerName && `nombre: ${leadFlow.customerName}`,
  lead?.email && `email: ${lead.email}`,
  lead?.phone && `teléfono: ${lead.phone}`,
].filter(Boolean).join(", ");
// se pasa a runAgent como contexto → prompt: "Datos del contacto ya conocidos: {knownContact}. Úsalos, no los vuelvas a pedir."
```

`runAgent` recibe un parámetro opcional `contextFacts?: string` (retrocompatible: por
defecto `undefined` → sin bloque, regresión cero). El orden `nextLeadFlowStep → runAgent`
NO cambia (D-P4-2): el booking ocurre dentro de `runAgent` (rama no `handled` del flujo),
cuando el flujo ya pasó `awaiting_name` y `customerName` está poblado.

### 4.3 Validación ISO en el handler (executor.ts)

`create_calendar_event` valida ANTES de llamar a `calendar.createEvent`:

```ts
function assertValidRange(startIso: string, endIso: string) {
  const s = Date.parse(startIso), e = Date.parse(endIso);
  if (Number.isNaN(s)) throw new Error(`startIso no es ISO 8601 válido: "${startIso}"`);
  if (Number.isNaN(e)) throw new Error(`endIso no es ISO 8601 válido: "${endIso}"`);
  if (e <= s) throw new Error(`endIso (${endIso}) debe ser posterior a startIso (${startIso})`);
}
```

El `throw` se captura en el `try/catch` del loop (engine.ts:86-90), se serializa como
`{ error }` al modelo y el loop continúa (R4 "Invalid datetime" → el agente pide
aclaración). No crashea el loop.

### 4.4 Upsert de Lead al confirmar cita

Reutiliza la rama `prisma.lead.upsert({ where: { conversationId } })` ya existente en
`chatWithAgent`. Cuando un booking se confirma con datos de contacto, la cita NO duplica
Leads porque la clave es `conversationId` (único). No se crea lógica nueva de Lead; el
booking se apoya en el `Lead` ya materializado por el flujo (o lo deja intacto si el flujo
aún no capturó contacto).

---

## 5. Trazabilidad (R6)

Sin cambios. El loop ya hace `toolCalls.push({ tool, input, output })` por cada llamada y
`chatWithAgent` persiste `Message.toolCalls`. Las tools de booking (`list_calendar_events`,
`create_calendar_event`) pasan por el mismo `executeTool` → quedan registradas idénticas a
las de integración. `LogsPanel` las renderiza igual (mismo shape `ToolCallRecord`).

---

## 6. Backend API — `skillStatus` en GET /api/agents/:id (AD8)

`buildSkillStatus` (en `skill-capabilities.ts`) deriva el shape de UI a partir de
`capabilitiesForSkills`:

```ts
export interface SkillStatusItem {
  skillId: string;
  name: string;
  state: "executable" | "requires_connection" | "informational";
  provider?: string;   // físico, solo en requires_connection (p.ej. "google")
}

export function buildSkillStatus(
  skills: SkillInput[],
  connectedProviders: string[]
): SkillStatusItem[] { /* mapea caps → items por skill */ }
```

En `index.ts`, tras el `findUnique`:

```ts
const skillStatus = buildSkillStatus(
  agent.skills.filter((s:any)=>s.skill).map((s:any)=>({ id: s.skillId, name: s.skill.name, use: s.skill.use })),
  agent.integrations.map((i:any)=>i.provider)
);
res.json({ ...agent, skillStatus });
```

El front consume `agent.skillStatus` directamente — cero requests extra (tarea 4.1).

---

## 7. Frontend

### 7.1 Panel del agente — pestaña skills (D-P4-3)

Hoy las skills no tienen pestaña propia visible (TABS no incluye "skills"); las skills viven
en `agent.skills`. Diseño: añadir una sub-sección de skills (o reutilizar la pestaña
`integraciones`) que liste `agent.skillStatus` con badge real:

| `state` | Badge | Acción |
|---|---|---|
| `executable` | ✓ "Ejecutable" (verde) | — |
| `requires_connection` | ⚠ "Conecta {provider}" (ámbar) | link a pestaña Integraciones (`?tab=integraciones`) |
| `informational` | ℹ "Informativa" (gris) | — |

El front no recalcula nada: lee `state` y `provider` de `skillStatus`. El CTA de
`requires_connection` cambia `tab` a `integraciones` (mismo patrón que `IntegrationsPanel`).

### 7.2 Wizard `SkillsStep.tsx` (D-P4-3, badge informativo)

El wizard NO conoce el estado de conexión (el agente aún no existe / no se evalúa conexión).
Badge meramente informativo derivado del catálogo client-side: "necesitará conexión {X}".
Se necesita un espejo TS mínimo del catálogo en el front (o exponerlo vía un endpoint
`/api/skill-catalog`). Decisión: **espejo TS estático** en
`front/lib/skill-capabilities.ts` (solo `SKILL_USE_TO_PROVIDER` + `NAME_OVERRIDES` +
`logicalProviderForSkill`), sin estado de conexión. Por cada skill del catálogo, si
`logicalProviderForSkill` ≠ null → badge "Necesitará conexión {provider}". Si null → sin
badge (informativa). No bloquea la selección (R5).

Shape añadido a `Skill` (front type) — ninguno: se calcula desde `skill.use`/`skill.name`
ya presentes en el catálogo del wizard.

---

## 8. Contrato de runAgent (firma)

```ts
// antes
runAgent(agentId, userMessage, history)
// después (retrocompatible: contextFacts opcional)
runAgent(agentId, userMessage, history, contextFacts?: string)
```

`chatWithAgent` pasa `contextFacts` con los datos de contacto conocidos (§4.2) cuando
existan. Los callers de canales (`channels.ts`) NO cambian: usan `chatWithAgent`, no
`runAgent` directo. Regresión cero para quien no pase `contextFacts`.

---

## 9. Estrategia de tests (Vitest back + Playwright front)

| Capa | Qué | Cómo |
|---|---|---|
| Unit puro | `logicalProviderForSkill` | use `CALENDARIO`→calendar; name "Google Calendar Bot" con use GENERAL→calendar (override gana); use desconocido→null |
| Unit puro | `capabilitiesForSkills` | skill calendar + google conectado → executableProviders incluye `calendar`; sin google → missingConnections con physical `google`; dos skills→calendar dedup a un proveedor; skill sin mapeo → informationalSkills |
| Unit puro | `toolsForSkillProviders` | `["calendar"]` → `list_calendar_events`+`create_calendar_event` |
| Unit | unión/dedup en motor | builder de tools: google conectado + skill calendar → `create_calendar_event` aparece UNA vez |
| Unit | system prompt builder | skill ejecutable → bloque "PUEDES usar"; skill sin conexión → bloque honestidad con provider; sin skills → sin sección (R8) |
| Unit | validación ISO | `assertValidRange`: ISO inválido lanza; `end<=start` lanza; rango válido pasa |
| Unit | huérfana (R7) | `agent.skills` con `skill=null` → no rompe, no añade tools |
| E2E mock | booking | mock `getValidToken`+`calendar.*`: mensaje reserva → `list_calendar_events` → `create_calendar_event` → `toolCalls` registrados |
| E2E mock | lead reuse | Lead con email → `contextFacts` incluye email → prompt no re-pide (asserción sobre el prompt construido) |
| Playwright | panel skills | mock GET con `skillStatus` → badges Ejecutable / Conecta google / Informativa |

Gate: `cd back && npm test` + `cd front && npm run build` en verde.

---

## 10. Riesgos / cuestiones abiertas

1. **Espejo de catálogo en front (§7.2).** El wizard necesita el mapa sin pasar por el
   back. Duplicar `SKILL_USE_TO_PROVIDER` en `front/lib/` crea dos fuentes de verdad.
   Mitigación: el espejo del front es SOLO para el badge informativo (no decide
   ejecutabilidad); la verdad ejecutable vive en el back (`skillStatus`). Aceptable;
   alternativa futura: endpoint `/api/skill-catalog`.
2. **Google expande a [gmail, calendar].** Una skill `email` con Google conectado expone
   tools de gmail aunque el cliente solo quería calendario. Es comportamiento actual de
   `toolsForProviders` (P2), no introducido aquí. Documentado, fuera de alcance afinar.
3. **Resolución de fecha natural** ("jueves a las 10") se delega al LLM. La validación ISO
   solo garantiza formato, no semántica de zona horaria. Riesgo de TZ incorrecto; mitigar
   pasando la fecha/hora actual y TZ del negocio en `contextFacts` si se observa deriva.
4. **`logicalProviderForSkill` con override por substring** puede dar falso positivo (skill
   "Slackline guide" → slack). Riesgo bajo dado el catálogo de marketplace; ampliar
   `NAME_OVERRIDES` a regex con límites de palabra si aparece.
5. **Sin pestaña "skills" en TABS.** El panel de skills se ubica en `integraciones` o una
   nueva pestaña; decisión de UI menor, no bloquea el contrato de datos (`skillStatus` ya
   viaja en el GET).

---

## 11. Discrepancias spec ↔ código / tasks

1. **Nombre de módulo y firmas.** `tasks.md` (1.1) y `spec.md` nombran `skill-tools.ts`
   con `toolsForSkills`/`skillStatus`. La decisión P4 (D-P4-1, esta tarea) usa
   `skill-capabilities.ts` con `capabilitiesForSkills`. **Resolución:** prevalece la
   decisión P4 (más reciente). `tasks.md` debe ajustarse (1.1→`skill-capabilities.ts`,
   1.2→`toolsForSkillProviders`, 1.3→`buildSkillStatus`). Las tools de booking quedan
   igual.
2. **`spec.md` "Skill Status in Agent Panel"** habla de SkillsStep mostrando el mismo badge
   con estado de conexión. **Realidad:** el wizard no tiene estado de conexión del agente
   (D-P4-3). Resolución: wizard = badge informativo ("necesitará conexión X"); panel del
   agente = badge con estado real. Coherente con D-P4-3, matiza el spec.
3. **`spec.md` Booking** menciona `attendees`; `create_calendar_event` ya soporta
   `attendees` (tools.ts:125). Sin cambio.
4. **Orden lead-flow.** Spec asume booking dentro de `runAgent`; `nextLeadFlowStep` corre
   antes y puede interceptar ("handled"). Cuando intercepta, no hay booking ese turno
   (correcto: aún capturando nombre/contacto). El booking opera en la rama no-handled.
   Sin conflicto; documentado (D-P4-2).
