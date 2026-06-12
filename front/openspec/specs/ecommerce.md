# Spec — Ecommerce Flow Improvements

**Estado**: Archived from P5 — ecommerce-flow-improvements (2026-06-12)

**Objetivo**: Mejoras de flujo ecommerce: recomendación vía RAG, FAQ con fuentes, lead con intención, handoff a humano, estado de pedido.

---

## R1 — Recomendación de producto vía RAG

Cuando el agente tiene knowledge base, el system prompt lo instruye a recomendar productos/servicios relevantes usando `search_knowledge`, citando la fuente en la respuesta.

**R1-1 — Bloque de instrucción RAG**

```
GIVEN un agente con al menos un KnowledgeChunk
WHEN runAgent construye el system prompt
THEN inyecta un bloque de instrucción explícito:
     recomendar productos/servicios basándose en search_knowledge
     citar la fuente en cada recomendación
```

**R1-2 — Enriquecimiento de tools.ts**

```
GIVEN la herramienta search_knowledge
WHEN se describe en tools.ts
THEN la descripción especifica que el resultado incluye source
 AND el agente debe citarlo en respuestas de FAQ/recomendación
```

**R1-3 — Comportamiento sin knowledge**

```
GIVEN un agente sin ningún KnowledgeChunk registrado
WHEN runAgent construye el system prompt
THEN el bloque de instrucción de recomendación NO se inyecta (regresión cero)
```

**R1-4 — Comportamiento cuando search_knowledge no devuelve resultados**

```
GIVEN search_knowledge vacío o distancia alta (sin resultados relevantes)
WHEN el agente responde a pregunta sobre producto
THEN responde con instrucciones base sin inventar productos
 AND no afirma que tiene catálogo si no hay chunks
```

---

## R2 — FAQ con citas de fuentes

Las respuestas basadas en knowledge incluyen la referencia al documento o URL de origen.

**R2-1 — Campo source en resultados**

```
GIVEN searchKnowledge(query) en embeddings.ts
WHEN devuelve resultados
THEN cada fila incluye { source, content, distance }
 (searchKnowledge YA devuelve source hoy; no requiere cambio en embeddings.ts)
```

**R2-2 — Presentación de fuentes**

```
GIVEN una fuente que es URL
WHEN el agente cita en respuesta
THEN la presenta como referencia: "según https://empresa.com/faq"

GIVEN una fuente que es nombre de documento
WHEN el agente cita
THEN la cita como nombre: "según documento: Política de Envíos"
```

**R2-3 — Chunk sin source**

```
GIVEN un KnowledgeChunk con source = "" o NULL
WHEN el agente usa ese chunk para responder
THEN responde con el contenido del chunk sin citar fuente
 AND no produce error ni advertencia al usuario (degradación silenciosa)
```

**R2-4 — Prohibición de alucinación de fuente**

```
GIVEN una respuesta del agente
WHEN cita una fuente
THEN esa fuente DEBE haber sido devuelta por search_knowledge
 AND el agente MUST NOT inventar fuentes no devueltas
```

---

## R3 — Lead con intención de compra

Al capturar un lead, se registra la intención detectada (producto/servicio de interés) en `Conversation.metadata`.

**R3-1 — INTENT_TOOL: record_lead_intent**

```
GIVEN una conversación activa con conversationId
WHEN el agente detecta intención de compra
THEN llama record_lead_intent(conversationId, intent_description)
 AND la herramienta escribe metadata.leadIntent en Conversation
 AND sin conversationId, devuelve { recorded: false }
```

**R3-2 — Panel de leads muestra intención**

```
GIVEN LeadsPanel.tsx en tab "leads"
WHEN renderiza la tabla de leads
THEN incluye columna con metadata.leadIntent
 AND visualiza la intención capturada para cada lead
```

---

## R4 — Handoff a humano + horario comercial

**R4-1 — HANDOFF_TOOL: request_human_handoff**

```
GIVEN una conversación que requiere escalación a humano
WHEN el agente llama request_human_handoff()
THEN:
     se persiste metadata.handoff en Conversation
     se hace upsert de Lead con status="handoff"
     se intenta notificar Slack (graceful degradation si falla)
```

**R4-2 — isWithinBusinessHours**

```
GIVEN ecommerceConfig con horario comercial (startHour, endHour, timezone)
WHEN se valida si es horario comercial
THEN:
     usa Intl para timezone awareness
     si timezone inválido, fallback a 24/7 (sin error)
     devuelve boolean
```

**R4-3 — Notificación Slack**

```
GIVEN que metadata.handoff se persiste
WHEN se intenta enviar notificación a Slack
THEN:
     usa send_slack_message / getValidToken si está disponible
     si falla: degradación silenciosa, sin throw
     si Slack no está conectado: degradación silenciosa
```

---

## R5 — Estado de pedido — placeholder (generic API)

**R5-1 — fetchOrderStatus**

```
GIVEN ecommerceConfig con orderStatusUrl y apiKey
WHEN el agente llama get_order_status(orderId)
THEN:
     HTTP GET a orderStatusUrl con orderId como query param
     Bearer token = descifrado de apiKey con decryptToken
     timeout configurable
     devuelve respuesta raw sin asumir formato (JSON pass-through)
```

**R5-2 — ECOMMERCE_TOOL: get_order_status**

```
GIVEN una petición de estado de pedido
WHEN el agente calla get_order_status(orderId)
THEN:
     si ecommerceConfig no existe: { configured: false }
     si orderStatusUrl está vacío: { configured: false }
     si API devuelve error: { error, message } (honestidad)
     si API cae o timeout: { error, message } (honestidad)
```

**R5-3 — Tool union condicionada**

```
GIVEN engine.ts en runAgent
WHEN construye la lista de tools
THEN incluye ECOMMERCE_TOOL solo si:
     agent.ecommerceConfig.orderStatusUrl está configurado
     (no intenta llamar a API si no está configurada)
```

---

## R6 — Schema y migración

**R6-1 — Agent.ecommerceConfig**

```
GIVEN schema.prisma
WHEN se define Agent.ecommerceConfig
THEN:
     tipo: Json @default("{}")
     contiene: { orderStatusUrl?, apiKey?, businessHours?, slackChannel? }
```

**R6-2 — Migración SQL idempotente**

```
GIVEN back/prisma/migrate-ecommerce-config.sql
WHEN se ejecuta
THEN:
     ADD COLUMN IF NOT EXISTS Agent.ecommerceConfig Json DEFAULT '{}'
     idempotente (no falla si columna ya existe)
     rollback documentado: DROP COLUMN
```

---

## R7 — Backend API

**R7-1 — PATCH /api/agents/:id/ecommerce-config**

```
GIVEN una petición PATCH con payload ecommerceConfig
WHEN el endpoint procesa
THEN:
     valida con zod
     cifra apiKey con encryptToken (si no está ya cifrado)
     merge sin borrar secreto (preserva existentes)
     devuelve respuesta con apiKey enmascarada
```

**R7-2 — GET /api/agents/:id/leads**

```
GIVEN una petición GET /api/agents/:id/leads
WHEN el endpoint retorna leads
THEN:
     incluye metadata.leadIntent (si existe)
     incluye metadata.handoff (si existe)
     incluye badge "handoff" en lead si status="handoff"
```

**R7-3 — GET /api/agents/:id (agente)**

```
GIVEN una petición GET /api/agents/:id
WHEN el endpoint retorna datos del agente
THEN:
     incluye ecommerceConfig (con apiKey enmascarada)
     inyecta "ecommerce" en buildSkillStatus si orderStatusUrl presente
     frontend usa para renderizar badge de skill ecommerce
```

---

## R8 — Frontend

**R8-1 — LeadsPanel.tsx**

```
GIVEN tab "leads" en app/agents/[id]/page.tsx
WHEN se renderiza el panel de leads
THEN:
     tabla con columnas: nombre, email, intención, badge handoff
     metadata.leadIntent visible por fila
     badge rojo "Handoff" si status="handoff"
```

**R8-2 — EcommerceConfigPanel.tsx**

```
GIVEN tab "integraciones" con sección ecommerce
WHEN se renderiza EcommerceConfigPanel
THEN:
     campos: orderStatusUrl, apiKey (password, enmascarada), horario comercial, canal Slack
     botón "Guardar" → PATCH /api/agents/:id/ecommerce-config
     validación basic de URL
```

---

## R9 — Helpers y firmas

**R9-1 — executeTool retrocompatible**

```
GIVEN executeTool(agentId, name, input, conversationId?)
WHEN se llama
THEN:
     conversationId es parámetro opcional
     si no se pasa, tool se ejecuta sin persistencia de metadata
     si se pasa, metadata se registra en Conversation
```

**R9-2 — Helpers de metadata**

```
GIVEN helper mergeConversationMetadata(conversation, key, value)
WHEN se llama
THEN:
     actualiza conversation.metadata[key] con nuevo valor
     es idempotente
```

**R9-3 — chatWithAgent propaga conversationId**

```
GIVEN chatWithAgent(agentId, messageText, conversationId?)
WHEN se llama
THEN:
     propaga conversationId a executeTool
     permite registrar metadata de tools (leadIntent, handoff)
```

---

## Cases borde

**CB-1 — Timeout en fetch de estado de pedido**

```
GIVEN orderStatusUrl que no responde dentro del timeout
WHEN se llama get_order_status
THEN:
     devuelve { error: "Timeout", message: "..." }
     sin crash
```

**CB-2 — API de pedidos devuelve formato no JSON**

```
GIVEN orderStatusUrl que devuelve HTML o texto plano
WHEN se llama get_order_status
THEN:
     devuelve respuesta raw (pass-through)
     agente interpreta según su conocimiento
```

**CB-3 — EcommerceConfig parcialmente configurado**

```
GIVEN ecommerceConfig con orderStatusUrl pero sin apiKey
WHEN se llama get_order_status
THEN:
     falla con { error, message }
     sin crash
```

**CB-4 — Handoff sin Slack conectado**

```
GIVEN metadata.handoff se persiste
  AND no existe Integration(provider=slack) para el agente
WHEN se intenta notificar
THEN:
     degradación silenciosa
     Conversation.metadata.handoff se persiste igual
     usuario ve badge "handoff"
     no se notifica Slack (ignorado, sin error)
```

---

## Technical Debt

**P6 — Playwright e2e**

- [ ] Config ecommerce visible/editable (apiKey enmascarada).
- [ ] Tab leads con intención y badge handoff (mockeado).
  - Estimated effort: 16h. Priority: low (deferred to integration testing).

---

## Implementation Status

- [x] RAG prompt con bloque de recomendación + source
- [x] `search_knowledge` ya devuelve source (no cambio necesario)
- [x] INTENT_TOOL (`record_lead_intent`) siempre disponible
- [x] Intención → `metadata.leadIntent` en Conversation
- [x] HANDOFF_TOOL (`request_human_handoff`) siempre disponible
- [x] Handoff → `metadata.handoff` + Lead.status="handoff"
- [x] Notificación Slack con degradación silenciosa
- [x] isWithinBusinessHours (Intl, fallback 24/7)
- [x] fetchOrderStatus (generic HTTP Bearer)
- [x] ECOMMERCE_TOOL (`get_order_status`) con condición orderStatusUrl
- [x] Order status → skill en buildSkillStatus si configured
- [x] Schema: Agent.ecommerceConfig Json @default("{}")
- [x] Migración SQL idempotente
- [x] PATCH /api/agents/:id/ecommerce-config (cifrado apiKey)
- [x] GET /api/agents/:id/leads (leadIntent + handoff metadata)
- [x] GET /api/agents/:id (ecommerceConfig enmascarado)
- [x] LeadsPanel.tsx con intención y handoff
- [x] EcommerceConfigPanel.tsx con formulario
- [x] Helpers `mergeConversationMetadata`, `getConversationMetadata`
- [x] Vitest coverage (todos verdes)
- [ ] Playwright e2e (P6)

---

## Note on GET /api/agents gate

**CRITICAL FIX (applied by orchestrator)**: GET /api/agents/:id NO debe exponer ecommerceConfig completo en lista de agentes. Enmascara apiKey y devuelve solo lo necesario. Status actual: FIXED.
