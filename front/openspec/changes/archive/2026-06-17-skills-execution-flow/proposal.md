# Proposal — skills-execution-flow

Canal objetivo: **todos** (widget / api / telegram / whatsapp comparten el mismo
pipeline `chatWithAgent`, así que esta fase aplica a todos a la vez).

## Estado real encontrado (evidencia, no suposición)

Antes de proponer nada, esto es lo que el código hace HOY:

1. **Las skills asignadas son DECORATIVAS.** En `runAgent`
   (`back/src/lib/agent/engine.ts:38-45`) las skills del agente solo se
   serializan como texto (`- nombre: descripción`) y se inyectan en el system
   prompt bajo "Skills instaladas". No producen ninguna capacidad ejecutable.
2. **Las tools ejecutables salen de las INTEGRACIONES, no de las skills.** En
   `engine.ts:29` las tools del tool-calling se calculan con
   `toolsForProviders(agent.integrations.map(i => i.provider))`. La relación
   `agent.skills` no participa en el cálculo de tools.
3. **El campo `Skill.tools` (Json `[{name, description}]`) nunca llega al
   executor.** Lo rellena el scraper desde READMEs de GitHub
   (`back/src/lib/github-skills/scraper.ts:263 extractToolsFromReadme`,
   persistido en `schema.prisma:85`), pero no hay ningún mapeo de
   `Skill.tools` → handlers ejecutables. Son metadatos de marketplace.
4. **El tool-calling real SÍ existe y funciona** para integraciones conectadas:
   `engine.ts:60-97` ejecuta el bucle agéntico de OpenAI (hasta
   `MAX_ITERATIONS = 8`), `executor.ts:30-47` enruta cada tool al handler real
   (`withToken` resuelve provider lógico→físico con `getValidToken`), y las
   tools de calendario YA existen: `list_calendar_events` y
   `create_calendar_event` (`tools.ts:106-130`, handlers en `executor.ts:45-46`,
   provider físico `google` vía `PHYSICAL_TO_LOGICAL.google = [gmail, calendar]`
   en `tools.ts:150`).
5. **La trazabilidad ya está soportada.** `runAgent` acumula `ToolCallRecord[]`
   y `chatWithAgent` los persiste en `Message.toolCalls`
   (`engine.ts:186`, columna `schema.prisma:163`).

**Conclusión del estado real:** un agente con integración Google conectada
PUEDE crear eventos hoy, porque las tools vienen de la integración. Pero la
skill de calendario del marketplace que el cliente asignó en el wizard NO aporta
nada a esa capacidad: el vínculo "skill asignada → tool ejecutable" no existe.
El gap es la **conexión skill↔tool↔integración**, no el motor de ejecución.

## Intención

Que las skills asignadas a un agente sean **ejecutables de extremo a extremo**,
no decorativas. La skill debe ser el contrato que declara "este agente puede
hacer X", y ese contrato debe traducirse a tools reales del executor cuando la
integración requerida esté conectada.

Caso canónico de referencia (E2E): agente con **skill de calendario** + **Google
conectado** → el usuario escribe (en widget o por Telegram/WhatsApp) "quiero una
cita el jueves a las 10" → el agente consulta disponibilidad
(`list_calendar_events`), confirma los datos faltantes (fecha, hora, nombre,
contacto) y crea el evento (`create_calendar_event`) en Google Calendar.

Éxito = asignar la skill de calendario y conectar Google es **suficiente** para
que el agente reserve citas reales por cualquier canal, con trazabilidad en
`Message.toolCalls`; y si la integración no está conectada, el agente lo dice y
el panel del agente lo avisa.

## Alcance (in-scope)

- **Mapa skill → capacidad ejecutable.** Definir un catálogo que asocie skills
  (por `use` y/o `name`, p.ej. `use = "CALENDARIO"`) a un conjunto de tools
  lógicas existentes (`calendar`, `gmail`, `slack`...) y al provider físico que
  requieren. Este mapa es la pieza nueva; reutiliza `TOOLS_BY_PROVIDER`,
  `LOGICAL_TO_PHYSICAL`/`toPhysicalProvider` y `getValidToken` (P2), sin
  renombrar claves lógicas (AD4).
- **Activación de tools por skill asignada + integración conectada.** En
  `runAgent`, calcular las tools no solo desde `agent.integrations` sino también
  desde `agent.skills`: para cada skill asignada, si su provider requerido está
  entre las integraciones conectadas, exponer sus tools al tool-calling.
- **Skill asignada con integración faltante.** Si una skill requiere una
  conexión no conectada: (a) no se exponen sus tools; (b) se añade una nota al
  system prompt para que el agente, si el usuario pide esa capacidad, responda
  indicando que falta conectar el proveedor (sin inventar que lo hizo); (c) el
  panel del agente avisa visualmente del estado "skill asignada, integración
  pendiente".
- **Booking de citas como caso E2E de referencia.** Flujo de confirmación de
  datos antes de `create_calendar_event` (fecha, hora, nombre, contacto). Enlace
  con `lead-flow` cuando aplique: la cita confirmada puede materializar/actualizar
  un `Lead` (nombre + contacto ya capturados por el flujo) reutilizando la lógica
  de `back/src/lib/lead-flow.ts`.
- **Trazabilidad.** Aprovechar `Message.toolCalls` (ya existe) para registrar
  cada llamada de tool originada por una skill. Sin nuevas columnas.
- **Indicador en el panel del agente** del estado de cada skill:
  ejecutable (integración conectada) vs pendiente de conexión.

## Fuera de alcance (out-of-scope)

- Ejecución de código arbitrario de los repos del marketplace
  (MCP/AGENT/EXTENSION/PLUGIN scrapeados de GitHub). Esta fase solo conecta
  skills a tools ya implementadas en el executor.
- Sandboxing / aislamiento de skills externas.
- Instalar dinámicamente nuevas tools no implementadas en `executor.ts`.
- Cambiar el motor de tool-calling (ya funciona).
- Resolución de fechas en lenguaje natural compleja más allá de lo que el modelo
  ya hace; se delega en el LLM con el contexto adecuado.

## Enfoque

1. **Catálogo skill→tools** (`back/src/lib/agent/skill-tools.ts` o ampliación de
   `tools.ts`): mapa `use`/`name` de skill → `{ logicalProviders, tools }`.
   Punto único de verdad, en línea con `service-map.ts`.
2. **Integración en `runAgent`** (`engine.ts:29`): unir las tools derivadas de
   `agent.integrations` con las derivadas de `agent.skills` que tengan su
   provider conectado; deduplicar por nombre de tool.
3. **System prompt enriquecido** (`engine.ts:38-50`): además de listar skills,
   marcar cuáles están operativas y cuáles requieren conectar un proveedor, para
   que el agente no prometa acciones que no puede ejecutar.
4. **Flujo de booking** sobre las tools de calendario ya existentes: guía de
   confirmación de datos + enlace opcional con `lead-flow` al confirmar cita.
5. **Front**: en el panel del agente (la pestaña de skills / `IntegrationsPanel`
   en `front/app/agents/[id]/page.tsx:95`), badge de estado por skill.
6. **Tests** (vitest back): el cálculo de tools incluye las de la skill cuando la
   integración está conectada y las excluye cuando no; el caso E2E de booking
   con mocks de `calendar` y `getValidToken`.

## Dependencias entre changes

- **Depende de P2 (oauth-integrations):** sin Google realmente conectado y
  `getValidToken` operativo, el caso de calendario no es ejecutable. Esta fase
  asume P2 entregado.
- **Habilita `ecommerce-flow-improvements`:** el handoff a humano, los
  recordatorios de cita y otros flujos de ese change se apoyan en el mecanismo
  skill→tool definido aquí.
- **Comparte pipeline con P1 (telegram-whatsapp-bots):** como los bots delegan
  en `chatWithAgent` (`back/src/routes/channels.ts:321,448`), la ejecutabilidad
  de skills funciona automáticamente en Telegram/WhatsApp sin trabajo extra.

## Riesgos / preguntas abiertas

- **Granularidad del mapeo:** ¿la skill se mapea por `use` (CALENDARIO) o por
  `name` exacto? Riesgo de falsos positivos si dos skills comparten `use`. Se
  asume mapeo por `use` con posibilidad de override por `name`.
- **Skills sin tool real:** la mayoría de skills del marketplace (MCP scrapeados)
  no tienen handler en el executor. Deben quedar como "informativas" (siguen en
  el prompt) sin pretender ser ejecutables, para no engañar al usuario.
- **Confirmación de datos de cita:** dejar la captura de fecha/hora al LLM puede
  producir ISO inválidos; mitigar validando `startIso`/`endIso` antes de llamar
  a `create_calendar_event` y devolviendo error legible.
- **Coherencia con lead-flow:** el flujo de lead actual
  (`lead-flow.ts:50 nextLeadFlowStep`) intercepta mensajes antes del agente;
  hay que decidir si la cita usa esos datos o pide los suyos para no duplicar
  preguntas.
- **Sin cambios de schema** (no destructivo): se reutilizan `Skill.tools`,
  `AgentSkill`, `Integration` y `Message.toolCalls`. Rollback = revertir código.
