# Design — ecommerce-flow-improvements

Canal objetivo: **todos** (widget / api / telegram / whatsapp comparten `chatWithAgent`).
Fecha: 2026-06-12
Estado: design-ready
Fuente: `proposal.md` + `spec.md` (R1-R5) + código real verificado (embeddings.ts,
lead-flow.ts, engine.ts, executor.ts, tools.ts, skill-capabilities.ts, crypto.ts,
oauth.ts, schema.prisma, index.ts, agents/[id]/page.tsx) + designs de dependencias
verificadas (`skills-execution-flow`, `oauth-integrations`, `n8n-automations`).

---

## 0. Decisiones de arquitectura (ADR resumido)

| ID | Decisión | Alternativa rechazada | Razón |
|---|---|---|---|
| AD1 | **Sin cambios en `embeddings.ts`.** `searchKnowledge` (embeddings.ts:22-32) ya devuelve `{ source, content, distance }[]`. R1/R2 se resuelven solo en el prompt y en la descripción de `search_knowledge`. | Ampliar la query SELECT | El `source` ya viaja por fila. Verificado en código. Tocar embeddings sería trabajo muerto. |
| AD2 | **Una columna nueva mínima: `Agent.ecommerceConfig Json @default("{}")`.** Migración SQL manual idempotente `migrate-ecommerce-config.sql`, convención `DO $$ ... ADD COLUMN IF NOT EXISTS`. Rollback `DROP COLUMN`. | Reusar `widgetTemplateConfig` (sin migración) | `widgetTemplateConfig` es config visual del widget; mezclar horario/handoff/orderStatus rompe SRP y `normalizeWidgetTemplateConfig` lo filtraría. Una sola columna agrupa toda la config de ecommerce (R4 + R5). |
| AD3 | **Intención de lead y handoff viven en `Conversation.metadata`** (Json existente), NO en columnas de `Lead`. `metadata.leadIntent` (string opcional) y `metadata.handoff` (bool). `Lead.status = "handoff"` reusa la columna `status` ya existente. | Columnas `Lead.interest` / `Lead.handoffAt` | R3/R4 piden lo menos invasivo. `metadata` ya se usa para `leadFlow`. Solo `Lead.status` (ya existe) cambia de valor. Cero migración para R3/R4. |
| AD4 | **`get_order_status` se añade como provider lógico `ecommerce` en `TOOLS_BY_PROVIDER` + handler en `executor.ts`**, y se registra en `skill-capabilities.ts` (`SKILL_USE_TO_PROVIDER`/`NAME_OVERRIDES`). NO usa `withToken`/OAuth: su "conexión" es la presencia de `ecommerceConfig.orderStatusUrl`, no una fila `Integration`. | Tool fuera del catálogo skill→tool; o tabla `OrderStatusConfig` aparte | Reutiliza el mecanismo skill→tool de P4 (no crea paralelo). La ejecutabilidad depende de config del agente, no de `Integration`, así que el handler la lee de `Agent.ecommerceConfig` directamente. |
| AD5 | **Handoff Slack reutiliza la tool `send_slack_message` y `getValidToken`** del executor existente (P2). La notificación se dispara desde un helper de handoff en `chatWithAgent`/engine que llama `executeTool(agentId, "send_slack_message", {...})` cuando Slack está conectado y `handoffSlackChannel` configurado. | Cliente Slack nuevo o webhook propio | R4-6/R4-8. No duplica el camino de auth ni el de tools. Falla silenciosa cuando `getValidToken` lanza (ya cubierto por el try/catch del executor). |
| AD6 | **Detección de handoff/intención: prompt-guided + marcadores en metadata mediante tools livianas**, no heurística de regex frágil. Se añade una tool `request_human_handoff` (sin auth) que el agente invoca cuando el usuario pide persona; su handler persiste `metadata.handoff` y dispara Slack. La intención se captura con `record_lead_intent(intent)`. | Heurística regex en `lead-flow.ts` | El loop agéntico ya razona la intención del usuario mejor que un regex. Las tools son el canal determinista LLM→backend (mismo patrón que `create_calendar_event`). Resuelve D2 del spec a favor de LLM-guided. |
| AD7 | **Cifrado de `orderStatusApiKey` reutiliza `encryptToken`/`decryptToken`** (oauth.ts, prefijo `enc:v1:`). El back cifra al guardar en `PATCH /api/agents/:id/ecommerce-config`; el handler de `get_order_status` descifra con `decryptToken`. | `crypto.ts` `encrypt`/`decrypt` directo (devuelve objeto) | `encryptToken` ya envuelve el objeto en string `enc:v1:<base64>`, idéntico a `Integration.accessToken`. Coherencia total con el resto de secretos del proyecto. |
| AD8 | **Endpoint nuevo `GET /api/agents/:id/leads`** que devuelve leads + `conversation.metadata` (intención, handoff). **Panel front nuevo (tab "leads")** en `agents/[id]/page.tsx`. NO existe panel de leads hoy (verificado: 0 endpoints, 0 componentes). | Reutilizar tab existente | R3-4/R4-9 exigen visualizar intención y handoff; no hay superficie previa. Se añade tab a `TABS` (patrón ya establecido). |
| AD9 | **`request_human_handoff` y `record_lead_intent` son tools "siempre disponibles"** (como `KNOWLEDGE_TOOL`), no dependen de provider conectado. `get_order_status` es condicional (provider `ecommerce`). | Todas condicionales | Handoff e intención deben funcionar en cualquier agente (incluso sin skills/integraciones). Order status sí requiere config externa. |

---

## 1. Arquitectura de módulos

```
back/
  prisma/
    schema.prisma                 # +Agent.ecommerceConfig Json @default("{}")
    migrate-ecommerce-config.sql  # NUEVO. ADD COLUMN IF NOT EXISTS idempotente + rollback documentado
  src/lib/agent/
    tools.ts            # +ECOMMERCE_TOOL group (get_order_status); +HANDOFF_TOOL, +INTENT_TOOL siempre disponibles
    executor.ts         # +handlers get_order_status / request_human_handoff / record_lead_intent
    handoff.ts          # NUEVO. buildConversationSummary(), notifySlackHandoff(), isWithinBusinessHours()
    order-status.ts     # NUEVO. fetchOrderStatus(config, orderId): llamada HTTP genérica + parseo raw
    skill-capabilities.ts  # +ECOMMERCE/ORDER_STATUS → "ecommerce" en SKILL_USE_TO_PROVIDER
    engine.ts           # runAgent: incluye tools siempre-disponibles + prompt R1/R3/R4; persistencia handoff
  src/index.ts          # +GET /api/agents/:id/leads; +PATCH /api/agents/:id/ecommerce-config (cifra apiKey)
front/
  app/agents/[id]/page.tsx        # +tab "leads"; +sección ecommerceConfig en config
  components/LeadsPanel.tsx        # NUEVO. tabla leads con intención + badge handoff
  components/EcommerceConfigPanel.tsx  # NUEVO. horario / orderStatusUrl / handoffSlackChannel / apiKey
```

Responsabilidades (SRP):
- **`order-status.ts`** — sin Prisma: recibe `{ url, apiKey }` ya descifrado + `orderId`, hace `fetch`, devuelve `{ ok, status?, raw?, error? }`. Función testeable con `fetch` mockeado.
- **`handoff.ts`** — `isWithinBusinessHours(config, now)` pura (testeable sin red); `buildConversationSummary(messages, lead, intent)` pura; `notifySlackHandoff(agentId, channel, summary)` llama `executeTool(...send_slack_message)`.
- **`executor.ts`** — solo enruta las tools nuevas a sus módulos.
- **`engine.ts`** — añade tools siempre-disponibles a la unión, añade fragmentos de prompt, no contiene lógica de negocio nueva (la delega a `handoff.ts`/`order-status.ts`).

---

## 2. R1 — Recomendación de producto vía RAG (prompt-only)

### 2.1 Detección de "agente con knowledge"

`runAgent` ya carga `agent` pero NO cuenta chunks. Se añade una consulta barata:

```ts
const knowledgeCount = await prisma.knowledgeChunk.count({ where: { agentId } });
const hasKnowledge = knowledgeCount > 0;
```

(O reutilizar `agent._count.knowledge` si el include ya lo trae — en `runAgent` no lo trae, así que `count` directo. Una query barata por turno; aceptable.)

### 2.2 Fragmento de system prompt (solo si `hasKnowledge`)

Se añade a `systemParts` ANTES del bloque genérico `"Usa search_knowledge..."`:

```
Recomendación basada en conocimiento: usa search_knowledge para encontrar
productos, servicios o información del negocio relevantes a lo que pide el
usuario. Cada resultado incluye un campo "source" (URL o documento de origen).
- Cuando recomiendes un producto/servicio o respondas una FAQ basándote en un
  resultado, CITA la fuente al final con el formato (fuente: <source>).
- Si "source" viene vacío para un resultado, úsalo sin citar fuente (no inventes una).
- Si search_knowledge no devuelve resultados relevantes, responde con tus
  instrucciones base. NO inventes productos ni afirmes que tienes catálogo.
- NUNCA cites una fuente que search_knowledge no haya devuelto.
```

- **R1-4 / R2 (regresión cero):** si `hasKnowledge === false`, el bloque NO se inyecta.
- Cumple R1-1..R1-4 y R2-1..R2-4 con un único bloque (R2 es el mismo mecanismo, source ya se propaga).

### 2.3 Descripción de `search_knowledge` (R2-1)

Se enriquece la `description` de `KNOWLEDGE_TOOL` en `tools.ts`:

```ts
description:
  "Busca en la base de conocimiento del agente (web y documentos del cliente). " +
  "Cada resultado incluye 'source' (URL o documento de origen). Cita la fuente al " +
  "responder FAQ o recomendar productos. Úsala antes de responder preguntas sobre el negocio.",
```

Sin cambio de schema ni de `searchKnowledge`. Verificado: la tool ya devuelve `source` tal cual al modelo (el handler retorna las filas completas).

---

## 3. R3 — Lead con intención de compra

### 3.1 Almacenamiento (AD3)

`Conversation.metadata` se extiende (sin migración):

```json
{ "leadFlow": { "step": "...", "customerName": "..." },
  "leadIntent": "plan Pro",
  "handoff": false }
```

### 3.2 Captura: tool `record_lead_intent` (AD6)

`tools.ts` define `INTENT_TOOL` (siempre disponible):

```ts
export const INTENT_TOOL: ToolDefinition = {
  name: "record_lead_intent",
  description:
    "Registra el producto, servicio, plan o categoría concreta que interesa al usuario " +
    "cuando lo menciona explícitamente. Úsala una sola vez cuando detectes intención de compra clara.",
  input_schema: {
    type: "object",
    properties: { intent: { type: "string", description: "Ej: 'plan Pro', 'zapatillas running'" } },
    required: ["intent"],
  },
};
```

Fragmento de prompt (siempre, en `systemParts`):

```
Cuando el usuario exprese interés en un producto, servicio, plan o categoría
concretos, llama a record_lead_intent con una descripción breve de su interés.
No preguntes datos de contacto que ya conoces (ver datos del contacto).
```

### 3.3 Handler y persistencia (R3-1, R3-2, R3-5)

`executeTool` necesita poder escribir en la `Conversation`. Hoy `executeTool(agentId, name, input)` NO recibe `conversationId`. **Cambio de firma mínimo:**

```ts
// antes
executeTool(agentId, name, input)
// después (retrocompatible: conversationId opcional)
executeTool(agentId, name, input, conversationId?)
```

`runAgent` debe recibir y propagar `conversationId`. Hoy `runAgent(agentId, userMessage, history, contextFacts?)` no lo tiene. **Se añade `conversationId?` opcional** y `chatWithAgent` lo pasa (ya tiene `conversation.id`). Retrocompatible: los tests/callers que no lo pasen siguen funcionando, las tools `record_lead_intent`/`request_human_handoff` solo persisten si `conversationId` está presente (si no, devuelven `{ recorded: false }` sin romper).

Handler:

```ts
record_lead_intent: async (agentId, input, conversationId) => {
  if (!conversationId) return { recorded: false };
  await mergeConversationMetadata(conversationId, { leadIntent: input.intent });
  return { recorded: true, intent: input.intent };
},
```

`mergeConversationMetadata` (helper en `handoff.ts` o `db`): lee `metadata`, hace spread, persiste. **R3-5:** solo se escribe cuando la tool se llama; si no hay intención, el campo no existe (omitido, no nulo).

### 3.4 Encadenamiento con lead-flow (R3-3, R3-6)

`record_lead_intent` NO toca `lead-flow.ts` ni `Lead`. Solo escribe `metadata.leadIntent`. El flujo de contacto (`nextLeadFlowStep`) sigue intacto y corre ANTES de `runAgent` (no se duplica ninguna pregunta). La intención es best-effort: si el LLM no llama la tool, la conversación continúa normal (R3-6).

**R3-2 (intención asociada al lead):** el lead se materializa por `conversationId` (único). El panel de leads (AD8) hace join lead↔conversation y lee `metadata.leadIntent`. No se copia a una columna de `Lead`.

---

## 4. R4 — Handoff a humano + horario comercial

### 4.1 Config (AD2) — `Agent.ecommerceConfig`

```json
{
  "businessHours": {
    "timezone": "Europe/Madrid",
    "schedule": [ { "day": 1, "open": "09:00", "close": "18:00" }, ... ]
  },
  "handoffSlackChannel": "#soporte",
  "orderStatusUrl": "https://api.cliente.com/orders",
  "orderStatusApiKey": "enc:v1:<base64>"
}
```

`day`: 0=domingo … 6=sábado (convención `Date.getDay`). Ausente/malformado → fallback 24/7.

### 4.2 `isWithinBusinessHours(config, now)` — pura (R4-1, R4-5, R4-D)

```ts
export function isWithinBusinessHours(config: EcommerceConfig | undefined, now = new Date()): boolean {
  const bh = config?.businessHours;
  if (!bh?.timezone || !Array.isArray(bh.schedule) || bh.schedule.length === 0) return true; // 24/7
  try {
    // Convertir 'now' a hora local del timezone con Intl (sin librería externa)
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: bh.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(now);
    // ... derivar day (0-6) y "HH:MM"; comparar contra la franja de ese día
    return /* dentro de alguna franja del día */;
  } catch {
    console.warn(`[handoff] businessHours inválido (tz=${bh.timezone}); fallback 24/7`);
    return true; // R4-D: TZ inválida → fallback, warning, sin error al usuario
  }
}
```

Sin dependencia nueva: `Intl.DateTimeFormat` con `timeZone` resuelve IANA. TZ inválida lanza → catch → fallback 24/7.

### 4.3 Tool `request_human_handoff` (siempre disponible, AD6/AD9)

```ts
export const HANDOFF_TOOL: ToolDefinition = {
  name: "request_human_handoff",
  description:
    "Escala la conversación a una persona del equipo. Llámala cuando el usuario pida " +
    "hablar con un humano/agente, o cuando no puedas resolver su petición. " +
    "Después informa al usuario según el resultado que devuelva la herramienta.",
  input_schema: {
    type: "object",
    properties: { reason: { type: "string", description: "Motivo breve del escalado" } },
    required: [],
  },
};
```

Fragmento de prompt (siempre):

```
Escalado a humano: si el usuario pide hablar con una persona/agente o no puedes
resolver su caso, llama a request_human_handoff. La herramienta te dirá si el
equipo está en horario (confirma que tomarán el caso) o fuera de horario
(informa del horario y di que contactarán en el próximo horario disponible).
Nunca prometas atención inmediata fuera de horario.
```

### 4.4 Handler de handoff (R4-3, R4-4, R4-5, R4-6, R4-7, R4-8)

```ts
request_human_handoff: async (agentId, input, conversationId) => {
  const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId }, select: { ecommerceConfig: true } });
  const cfg = agent.ecommerceConfig as EcommerceConfig;
  const within = isWithinBusinessHours(cfg);

  if (conversationId) {
    // R4-3: persistir handoff en metadata
    await mergeConversationMetadata(conversationId, { handoff: true });
    // R4-3: upsert Lead status=handoff (create mínimo si no existe — caso borde "handoff sin lead")
    const meta = await getConversationMetadata(conversationId);
    await prisma.lead.upsert({
      where: { conversationId },
      create: { agentId, conversationId, customerName: meta.leadFlow?.customerName ?? "Visitante", status: "handoff" },
      update: { status: "handoff" },
    });
    // R4-6/R4-8: notificar Slack si conectado y canal configurado (falla silenciosa)
    if (cfg?.handoffSlackChannel) {
      try {
        const summary = await buildConversationSummary(conversationId);  // lead + intent + últimos N msgs
        await executeTool(agentId, "send_slack_message", { channel: cfg.handoffSlackChannel, text: summary }, conversationId);
      } catch (e) {
        console.error("[handoff] Slack notify falló (degradación silenciosa):", e);
      }
    }
  }
  return { handed_off: true, withinBusinessHours: within, businessHours: cfg?.businessHours ?? null };
}
```

- **R4-6:** reutiliza `send_slack_message` → `withToken("slack", ...)` → `getValidToken` (P2). Si Slack no conectado, `getValidToken` lanza `IntegrationMissingError` → cae en el catch → degradación silenciosa (R4-7/R4-8).
- **R4-5/R4-4:** el handler NO redacta el mensaje al usuario; devuelve `withinBusinessHours` + `businessHours` y el LLM compone la respuesta según el prompt (dentro: "un humano tomará el caso"; fuera: informa horario). Esto evita hardcodear copy y respeta el idioma del usuario.
- **R4-8:** el handoff en metadata/lead se persiste ANTES del intento Slack → siempre queda registrado aunque Slack falle.

### 4.5 `buildConversationSummary(conversationId)` (R4-6 payload)

Pura respecto a red (solo lee Prisma). Construye:

```
Handoff solicitado · Agente: {agent.name}
Contacto: {lead.customerName} {lead.email ?? ""} {lead.phone ?? ""}
Intención: {metadata.leadIntent ?? "—"}
Últimos mensajes:
- usuario: ...
- asistente: ...
(últimos N=6 mensajes de la conversación)
```

### 4.6 Detección de "flujo no resoluble" (R4-2-b)

No se implementa un detector determinista; el prompt instruye al LLM a llamar `request_human_handoff` cuando no pueda resolver. Coherente con AD6 (LLM-guided). El límite de iteraciones (`MAX_ITERATIONS=8`) sigue siendo el cierre de seguridad.

---

## 5. R5 — Estado de pedido (placeholder extensible)

### 5.1 Tool `get_order_status` (condicional, provider `ecommerce`)

`tools.ts`:

```ts
ecommerce: [
  {
    name: "get_order_status",
    description:
      "Consulta el estado de un pedido en el sistema del negocio. Requiere orderId. " +
      "Si el negocio no tiene configurada la consulta de pedidos, lo indicará: en ese caso " +
      "explícalo honestamente y ofrece escalar a una persona. Nunca inventes un estado.",
    input_schema: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
    },
  },
],
```

### 5.2 Registro skill→tool (R5-5, AD4)

`skill-capabilities.ts`:

```ts
export const SKILL_USE_TO_PROVIDER = {
  ...,
  ECOMMERCE: "ecommerce",
  ORDER_STATUS: "ecommerce",
};
NAME_OVERRIDES.push({ match: "pedido", provider: "ecommerce" }, { match: "order", provider: "ecommerce" });
```

**Diferencia clave con P4:** `ecommerce` NO mapea a una fila `Integration`. Su ejecutabilidad la decide la presencia de `ecommerceConfig.orderStatusUrl`, no `connectedProviders`. Por tanto:

- En `engine.ts`, las tools de `ecommerce` se añaden a la unión **si `ecommerceConfig.orderStatusUrl` está presente** (no por `capabilitiesForSkills`). Se hace con una condición explícita en `runAgent`, paralela a la guía de booking:

```ts
const ecom = agent.ecommerceConfig as EcommerceConfig;
if (ecom?.orderStatusUrl) {
  for (const t of TOOLS_BY_PROVIDER.ecommerce) if (!seen.has(t.name)) { seen.add(t.name); mergedDefs.push(t); }
}
```

- En `buildSkillStatus`/panel: una skill `ecommerce` sin `orderStatusUrl` aparece como `requires_connection` (CTA: configurar endpoint de pedidos), con `orderStatusUrl` → `executable`. Para no romper la firma pura de `capabilitiesForSkills` (que solo conoce `connectedProviders`), se trata `ecommerce` como "conectado" inyectando `"ecommerce"` en la lista de `connectedProviders` que se pasa a `buildSkillStatus` cuando `orderStatusUrl` existe (en `index.ts`). Mínimamente invasivo, sin tocar la función pura.

### 5.3 Handler `get_order_status` (R5-1..R5-4)

```ts
get_order_status: async (agentId, input) => {
  const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId }, select: { ecommerceConfig: true } });
  const cfg = agent.ecommerceConfig as EcommerceConfig;
  if (!cfg?.orderStatusUrl) {
    return { configured: false, message: "No tengo acceso configurado al sistema de pedidos de este negocio." }; // R5-4
  }
  const apiKey = cfg.orderStatusApiKey ? decryptToken(cfg.orderStatusApiKey) : undefined;
  return fetchOrderStatus({ url: cfg.orderStatusUrl, apiKey }, input.orderId); // R5-2/R5-3
},
```

### 5.4 `fetchOrderStatus` (order-status.ts) — genérico (R5-6)

```ts
export async function fetchOrderStatus(
  cfg: { url: string; apiKey?: string }, orderId: string
): Promise<{ ok: boolean; raw?: unknown; error?: string }> {
  try {
    const url = `${cfg.url}${cfg.url.includes("?") ? "&" : "?"}orderId=${encodeURIComponent(orderId)}`;
    const res = await fetch(url, {
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: `El sistema de pedidos respondió ${res.status}` }; // R5-3
    const raw = await res.json().catch(() => res.text());
    return { ok: true, raw }; // R5-6: respuesta raw, sin asumir formato
  } catch (e) {
    console.error("[order-status] fallo consultando endpoint:", e);
    return { ok: false, error: "No pude consultar el estado del pedido en este momento" }; // R5-3
  }
}
```

- **R5-3:** error (timeout/4xx/5xx) → `{ ok: false, error }` → el LLM responde honestamente y ofrece handoff (prompt lo guía).
- **R5-6:** auth por `Bearer` por defecto (genérico); si un cliente necesita header distinto, es extensión futura documentada como riesgo. El `orderId` va por query param (convención más común y genérica).

### 5.5 Fragmento de prompt (solo si `orderStatusUrl` presente)

```
Estado de pedidos: cuando el usuario pregunte por un pedido, pídele el número y
llama a get_order_status. Comunica el estado según lo que devuelva la herramienta.
Si la herramienta indica que no está configurada o falla, dilo honestamente y
ofrece escalar a una persona con request_human_handoff. Nunca inventes un estado.
```

---

## 6. Backend API

### 6.1 `PATCH /api/agents/:id/ecommerce-config` (cifra apiKey, AD7)

```ts
const schema = z.object({
  businessHours: z.object({
    timezone: z.string(),
    schedule: z.array(z.object({ day: z.number().min(0).max(6), open: z.string(), close: z.string() })),
  }).optional(),
  handoffSlackChannel: z.string().optional(),
  orderStatusUrl: z.string().url().optional().or(z.literal("")),
  orderStatusApiKey: z.string().optional(), // texto plano entrante → se cifra aquí
});
```

- Si `orderStatusApiKey` llega en texto plano y no vacío → `encryptToken(...)` antes de persistir.
- Si llega vacío/omitido → conservar el valor cifrado existente (merge con `ecommerceConfig` actual, no sobrescribir el secreto con vacío).
- La respuesta del GET del agente **NUNCA** devuelve `orderStatusApiKey` en claro: se enmascara (`"***"` si existe, omitido si no). Patrón de no-exposición de secretos.

### 6.2 `GET /api/agents/:id/leads` (R3-4, R4-9, AD8)

```ts
app.get("/api/agents/:id/leads", async (req, res) => {
  const leads = await prisma.lead.findMany({
    where: { agentId: req.params.id },
    orderBy: { createdAt: "desc" },
    include: { conversation: { select: { metadata: true } } },
  });
  const items = leads.map((l) => ({
    id: l.id, customerName: l.customerName, email: l.email, phone: l.phone,
    status: l.status, createdAt: l.createdAt,
    intent: (l.conversation?.metadata as any)?.leadIntent ?? null,   // R3-4
    handoff: (l.conversation?.metadata as any)?.handoff === true,    // R4-9
  }));
  res.json({ leads: items });
});
```

### 6.3 GET `/api/agents/:id` — `ecommerceConfig` y `skillStatus` ecommerce

Incluir `ecommerceConfig` (con apiKey enmascarada, §6.1) en la respuesta. Inyectar `"ecommerce"` en `connectedProviders` para `buildSkillStatus` si `orderStatusUrl` presente (§5.2).

---

## 7. Frontend

### 7.1 Tab "leads" (AD8) — `LeadsPanel.tsx`

`TABS` añade `"leads"`. Tabla: nombre, email/teléfono, intención (`intent ?? "—"`), badge handoff:

| `status`/campo | UI |
|---|---|
| `handoff === true` | badge ámbar "Handoff" |
| `intent` presente | columna "Intención" muestra el texto |
| `intent` ausente | columna vacía silenciosa (R3-5) |

Datos vía `GET /api/agents/:id/leads`. Sin lógica de cálculo en front.

### 7.2 Config ecommerce — `EcommerceConfigPanel.tsx`

Ubicación: **dentro del tab `integraciones`** (junto a `IntegrationsPanel`), o sección plegable en config. Decisión: sección en `integraciones` (es config de capacidades externas, coherente con OAuth y ChannelConnect). Campos:

- Horario comercial: timezone (select IANA) + filas día/open/close.
- Canal Slack de handoff (`handoffSlackChannel`): input texto (`#soporte`).
- Endpoint de pedidos (`orderStatusUrl`): input URL.
- API key de pedidos (`orderStatusApiKey`): input password; muestra "configurada" si el GET devuelve `"***"`, permite reemplazar.

PATCH a `/api/agents/:id/ecommerce-config`. La apiKey solo se envía si el usuario la cambia.

### 7.3 Indicador de handoff (R4-9)

Cubierto por el badge "Handoff" en `LeadsPanel`. Opcional: contador de handoffs pendientes en el header del tab.

---

## 8. Schema y migración

`schema.prisma`, modelo `Agent`:

```prisma
ecommerceConfig Json @default("{}")
```

`back/prisma/migrate-ecommerce-config.sql` (idempotente, convención existente):

```sql
-- Migración: Agent.ecommerceConfig (horario, handoff Slack, order status).
-- Idempotente. Ejecutar: npx prisma db execute --file prisma/migrate-ecommerce-config.sql
-- Rollback: ALTER TABLE "Agent" DROP COLUMN IF EXISTS "ecommerceConfig";
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "ecommerceConfig" JSONB NOT NULL DEFAULT '{}';
```

Después: `npm run db:push` (regenera el cliente Prisma). R3/R4-metadata y R5-handler no requieren más DDL.

---

## 9. Contratos de firma (retrocompatibilidad)

```ts
// executor.ts
executeTool(agentId, name, input, conversationId?)   // +conversationId opcional
// engine.ts
runAgent(agentId, userMessage, history, contextFacts?, conversationId?)  // +conversationId opcional
```

`chatWithAgent` pasa `conversation.id` a `runAgent`, que lo propaga a `executeTool`. Callers que no pasen `conversationId` (tests existentes, canales que usan `chatWithAgent`) siguen funcionando: las tools `record_lead_intent`/`request_human_handoff` devuelven `{ recorded:false }`/`{ handed_off:true }` sin persistir cuando falta. Regresión cero verificada contra el código actual de `engine.ts`.

---

## 10. Estrategia de tests (Vitest back + Playwright front; sin red)

| Capa | Qué | Cómo |
|---|---|---|
| Unit prompt | R1: bloque RAG presente con `hasKnowledge`, ausente sin chunks | mock `knowledgeChunk.count`; inspeccionar `system` construido |
| Unit tool desc | R2-1: `search_knowledge.description` menciona `source` y citar | aserción sobre `KNOWLEDGE_TOOL.description` |
| Unit handler | R3: `record_lead_intent` con `conversationId` → `metadata.leadIntent`; sin `conversationId` → `{recorded:false}` | mock `mergeConversationMetadata`/Prisma |
| Unit pura | R4-1/R4-D: `isWithinBusinessHours` — dentro de franja true; fuera false; TZ inválida → true + warn; config vacía → true | `now` fijo + tz fijo, sin red |
| Unit handler | R4-3/R4-6/R4-8: `request_human_handoff` → `metadata.handoff` + `Lead.status=handoff`; Slack mock OK notifica; `getValidToken` lanza → degrada sin throw | mock `executeTool send_slack_message`, mock Prisma upsert |
| Unit summary | R4-6: `buildConversationSummary` incluye lead, intent, últimos N msgs | mock Prisma |
| Unit pura | R5-2/R5-3/R5-6: `fetchOrderStatus` — 200 → `{ok,raw}`; 500 → `{ok:false,error}`; timeout/throw → `{ok:false}` | `fetch` mockeado |
| Unit handler | R5-4: `get_order_status` sin `orderStatusUrl` → `{configured:false}` | mock Prisma `ecommerceConfig={}` |
| Unit crypto | AD7: PATCH cifra apiKey con `encryptToken`; handler descifra con `decryptToken` | round-trip con `CHANNEL_ENCRYPTION_KEY` de test |
| Unit api | R3-4/R4-9: GET `/leads` mapea `intent`/`handoff` desde `conversation.metadata` | mock Prisma findMany |
| Playwright | R7.1: tab "leads" muestra intención + badge handoff (GET mockeado) | route mock |
| Playwright | R7.2: panel ecommerceConfig visible/editable; apiKey enmascarada | route mock |
| Gate | `cd back && npm test` + `cd front && npm run build` en verde | — |

---

## 11. Orden de implementación (tasks)

1. **Schema + migración** (§8): `ecommerceConfig` + `migrate-ecommerce-config.sql` + `db:push`. (Habilita R4/R5.)
2. **R1/R2 prompt** (§2): `hasKnowledge` + bloque RAG en `engine.ts`; descripción `search_knowledge`. + tests. (Independiente, bajo riesgo.)
3. **Firmas + helper metadata** (§9, §3.3): `conversationId` opcional en `runAgent`/`executeTool`; `mergeConversationMetadata`/`getConversationMetadata`. (Base de R3/R4.)
4. **R3 intención** (§3): `INTENT_TOOL` + handler + prompt. + tests.
5. **R4 handoff** (§4): `handoff.ts` (`isWithinBusinessHours`, `buildConversationSummary`), `HANDOFF_TOOL` + handler + prompt + Slack reuse. + tests.
6. **R5 order status** (§5): `order-status.ts`, `ECOMMERCE_TOOL`, registro skill→tool, handler, condición de unión en `engine.ts`, prompt. + tests.
7. **Backend API** (§6): `PATCH /ecommerce-config` (cifrado + enmascarado), `GET /leads`, `ecommerceConfig` en GET agente. + tests.
8. **Front** (§7): `LeadsPanel`, `EcommerceConfigPanel`, tab "leads". + Playwright.
9. **Gate**: `cd back && npm test`, `cd front && npm run build`, typechecks en verde.

---

## 12. Discrepancias spec ↔ código

1. **Panel de leads inexistente.** El spec (R3-4, R4-9) asume "la vista de leads del panel". **Verificado: NO existe** ni endpoint (`GET /api/agents/:id/leads`) ni componente front de leads (0 coincidencias en `front/app`). El design lo crea desde cero (AD8, §6.2, §7.1). El spec subestima este alcance — es trabajo nuevo, no ajuste.
2. **`executeTool`/`runAgent` sin `conversationId`.** El spec (R3-1, R4-3) asume que la tool puede escribir en `Conversation.metadata`/`Lead`, pero `executeTool(agentId, name, input)` no recibe `conversationId` hoy. El design añade el parámetro opcional retrocompatible (§9). Discrepancia menor de fontanería, resuelta sin romper firmas.
3. **`source` en RAG: confirmado, sin cambio.** El spec ya lo anota (sección "Hallazgo sobre RAG"); el design lo ratifica (AD1). `searchKnowledge` devuelve `source` por fila — cero cambios en `embeddings.ts`.
4. **`ecommerce` no es una `Integration`.** El spec R5-5 dice "registrar en `SKILL_USE_TO_PROVIDER`" como si fuera un provider OAuth. Pero `get_order_status` no usa `getValidToken`/`Integration`: su "conexión" es `ecommerceConfig.orderStatusUrl`. El design lo resuelve tratando `ecommerce` como provider lógico especial cuya ejecutabilidad depende de config, no de `connectedProviders` (AD4, §5.2). Matiza el spec sin contradecirlo.
5. **D1/D2/D4 del spec resueltos:** D1 → columna nueva `ecommerceConfig` (AD2). D2 → LLM-guided vía tools (AD6). D4 → crear `Lead` mínimo `customerName="Visitante"` con `status=handoff` (§4.4). D3 → cita inline `(fuente: <source>)` (§2.2).

---

## 13. Riesgos / cuestiones abiertas

1. **Auth genérica de order status (Bearer).** `fetchOrderStatus` asume `Authorization: Bearer`. Clientes con API key en header custom o query param distinto no encajan sin extensión. Mitigación: documentado; ampliar `ecommerceConfig` con `orderStatusAuthHeader` en fase futura si aparece la necesidad.
2. **`Intl.DateTimeFormat` para horario.** Resuelve IANA sin librería, pero la lógica de derivar día+hora de `formatToParts` es delicada (locale `en-GB`, `weekday: short`). Riesgo de off-by-one en el mapeo día→0-6. Mitigación: tests con `now` y tz fijos cubren los bordes (§10).
3. **Query `knowledgeChunk.count` por turno.** Añade una consulta por mensaje en `runAgent`. Coste bajo (índice por `agentId`), pero por turno. Mitigación aceptable; alternativa: incluir `_count.knowledge` en el `findUniqueOrThrow` del agente y leerlo de ahí (1 query en vez de 2).
4. **LLM-guided handoff/intención (AD6).** Depende de que el modelo llame las tools. Si no las llama, no hay marcado. Riesgo inherente a delegar en el LLM; el prompt es explícito y los modelos function-calling lo cumplen bien. No hay fallback determinista (decisión consciente: regex frágil rechazado en AD6).
5. **Enmascarado de `orderStatusApiKey`.** El GET nunca devuelve el secreto en claro; el front no puede mostrarlo, solo reemplazarlo. Asegurar que el merge en PATCH no borre el secreto al guardar el resto de la config (§6.1) — punto crítico de seguridad a cubrir con test (§10 "Unit crypto").
6. **Solape `ecommerce` con `connectedProviders`.** Inyectar `"ecommerce"` en la lista para `buildSkillStatus` es un hack acotado a `index.ts`; no contamina la función pura. Si crecen los providers "config-based", convendría un segundo argumento `extraExecutableProviders` en `buildSkillStatus`. Documentado, no implementado ahora.
