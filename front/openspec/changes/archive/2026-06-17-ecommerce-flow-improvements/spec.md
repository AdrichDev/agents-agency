# Spec — ecommerce-flow-improvements

Canal objetivo: todos (widget / api / telegram / whatsapp — pipeline común `chatWithAgent`).
Fecha: 2026-06-12
Estado: spec-ready
Fuente: `proposal.md` + código real (embeddings.ts, lead-flow.ts, engine.ts, schema.prisma, service-map.ts) + design skills-execution-flow.

---

## Hallazgo sobre RAG y source

`searchKnowledge` (embeddings.ts:24-31) **ya devuelve `source` por fila**:
```ts
prisma.$queryRaw<{ source: string; content: string; distance: number }[]>`
  SELECT "source", "content", "embedding" <=> ... AS distance
```
`KnowledgeChunk.source` existe en schema. La columna se propaga HOY en la respuesta de la función.
**No se requiere cambio en embeddings.ts para R1 ni R2.** Solo ajustar el prompt y la descripción de la tool `search_knowledge` para que el agente use el campo `source` al responder.

---

## R1 — Recomendación de producto vía RAG

### Descripción
Cuando el agente tiene knowledge base, el system prompt lo instruye a recomendar productos/servicios relevantes usando los resultados de `search_knowledge`, citando la fuente (`KnowledgeChunk.source`) en la respuesta.
Sin knowledge chunks para ese agente → comportamiento actual sin cambio.

### Requisitos

- **R1-1** El system prompt de `runAgent` incluye, si el agente tiene al menos un `KnowledgeChunk`, un bloque de instrucción explícita: recomendar productos/servicios basándose en `search_knowledge` y citar la fuente en cada recomendación.
- **R1-2** Si `search_knowledge` devuelve resultados con `source`, el agente los incluye en el texto de respuesta con el formato: `(fuente: <source>)` o equivalente natural.
- **R1-3** Si `search_knowledge` no devuelve resultados relevantes (knowledge vacío o distancia alta), el agente responde con sus instrucciones base sin inventar productos. No afirma que tiene catálogo si no hay chunks.
- **R1-4** Si el agente no tiene ningún `KnowledgeChunk` registrado, el bloque de instrucción de recomendación NO se inyecta en el system prompt (regresión cero para agentes sin knowledge).

### Escenarios

**Escenario R1-A — Recomendación con fuente**
```
DADO  un agente con KnowledgeChunks cargados (source = "https://tienda.com/catalogo")
Y     el usuario pregunta "¿qué producto me recomiendas para X?"
CUANDO `search_knowledge` devuelve chunks con source
ENTONCES la respuesta del agente incluye la referencia a la fuente
Y     no inventa información que no esté en los chunks
```

**Escenario R1-B — Sin knowledge**
```
DADO  un agente sin KnowledgeChunks
CUANDO el usuario pregunta por un producto
ENTONCES el agente responde con sus instrucciones base
Y     el system prompt no contiene el bloque de recomendación RAG
```

**Escenario R1-C — Knowledge vacío en runtime**
```
DADO  un agente con KnowledgeChunks
Y     `search_knowledge` no devuelve resultados relevantes para la query
CUANDO el usuario pregunta por un producto
ENTONCES el agente no inventa productos ni afirma disponibilidad no confirmada
```

---

## R2 — FAQ con citas de fuentes

### Descripción
Las respuestas basadas en knowledge incluyen la referencia al documento o URL de origen (`KnowledgeChunk.source`) cuando el campo está presente en el resultado. Requisito satisfecho por el mismo mecanismo de R1 (source ya se propaga).

### Requisitos

- **R2-1** La descripción de la tool `search_knowledge` en `tools.ts` especifica que el resultado incluye `source` y que el agente debe citarlo en respuestas de FAQ.
- **R2-2** Si `source` es una URL, el agente la presenta como referencia. Si es un nombre de documento, lo cita como nombre.
- **R2-3** Si `source` está vacío o es nulo para un chunk, ese chunk se usa pero sin cita de fuente (degradación silenciosa, sin error).
- **R2-4** El agente no cita una fuente que no devolvió `search_knowledge` (prohibición de alucinación de fuente).

### Escenarios

**Escenario R2-A — FAQ con cita URL**
```
DADO  KnowledgeChunks con source = "https://empresa.com/faq"
CUANDO el usuario hace una pregunta de FAQ
ENTONCES la respuesta incluye referencia a "https://empresa.com/faq"
```

**Escenario R2-B — Chunk sin source**
```
DADO  un KnowledgeChunk con source = ""
CUANDO el agente usa ese chunk para responder
ENTONCES responde con el contenido del chunk sin citar fuente
Y     no produce error ni mensaje de advertencia al usuario
```

---

## R3 — Lead con intención de compra

### Descripción
Al capturar un lead, se registra la intención detectada (producto/servicio de interés) en `Conversation.metadata`. El panel de leads muestra esa intención. No se añade columna nueva a `Lead` en esta fase (sin migración).

### Decisión de almacenamiento
`Conversation.metadata` (Json, ya existe) se extiende con:
```json
{
  "leadFlow": { "step": "...", "customerName": "..." },
  "leadIntent": "interesado en plan Pro"
}
```
`Lead` no se modifica. La intención se lee del metadata de la Conversation relacionada para mostrarla en el panel. Si en una fase posterior se requiere filtrar/reportar por intención, se evalúa añadir `Lead.interest String?` con migración SQL no destructiva.

### Requisitos

- **R3-1** Cuando el agente detecta intención de compra explícita del usuario (menciona un producto, servicio, plan o categoría concretos) y el flujo está en `assisting`, guarda `leadIntent` en `Conversation.metadata`.
- **R3-2** Al crear o actualizar el `Lead` desde `lead-flow.ts`, `chatWithAgent` adjunta la intención desde `metadata.leadIntent` al objeto del lead (como dato asociado, no como columna de `Lead`).
- **R3-3** El flujo de `lead-flow.ts` NO duplica preguntas de contacto ya realizadas. La captura de intención se encadena con el flujo existente, no lo reemplaza.
- **R3-4** La vista de leads del panel front muestra la intención cuando está disponible en `Conversation.metadata.leadIntent`.
- **R3-5** Si no hay intención detectada, `leadIntent` no se escribe en metadata (campo omitido, no nulo).
- **R3-6** La detección de intención es best-effort (heurística o LLM-guided via prompt); no bloquea la conversación si no detecta intención.

### Escenarios

**Escenario R3-A — Captura con intención**
```
DADO  una conversación en paso "assisting"
Y     el usuario dice "me interesa el plan Pro"
CUANDO se procesa el mensaje
ENTONCES `Conversation.metadata.leadIntent` = "plan Pro" (o texto equivalente detectado)
Y     al capturar el lead, la intención queda asociada a la conversación
Y     el panel de leads muestra "plan Pro" junto a ese lead
```

**Escenario R3-B — Sin intención detectable**
```
DADO  una conversación donde el usuario no menciona ningún producto concreto
CUANDO se crea el lead
ENTONCES `Conversation.metadata` no incluye campo `leadIntent`
Y     el panel de leads muestra el lead sin campo de intención
```

**Escenario R3-C — Encadenamiento sin duplicar preguntas**
```
DADO  un flujo que ya capturó nombre y email
CUANDO se detecta intención después del contacto
ENTONCES el sistema actualiza `leadIntent` en metadata
Y     no vuelve a preguntar nombre ni email
```

---

## R4 — Handoff a humano + horario comercial

### Descripción
Config por agente para handoff (horario comercial + canal Slack). El agente ofrece escalado a humano a petición o fuera de horario. Con Slack conectado → notificación al canal configurado con resumen. Sin Slack → mensaje al usuario + lead marcado `handoff`.

### Decisión de configuración
Config del agente en `Agent.widgetTemplateConfig` (Json, ya existe) o campo nuevo `Agent.ecommerceConfig Json @default("{}")`. Se decide **campo nuevo `ecommerceConfig`** para no contaminar la config de widget:
```json
{
  "businessHours": {
    "timezone": "Europe/Madrid",
    "schedule": [
      { "day": 1, "open": "09:00", "close": "18:00" },
      ...
    ]
  },
  "handoffSlackChannel": "#soporte",
  "orderStatusUrl": "https://api.cliente.com/orders",
  "orderStatusApiKey": "enc:v1:<base64>"
}
```
Si `ecommerceConfig` no existe o está vacío → fallback: handoff disponible 24/7, sin Slack, sin order status.

### Requisitos

- **R4-1** Config `businessHours` por agente: timezone (IANA) + franjas por día de la semana. Si malformada o ausente → fallback 24/7 (siempre "en horario").
- **R4-2** El agente detecta solicitud de handoff cuando: (a) el usuario lo pide explícitamente ("hablar con una persona", "agente humano"), (b) el flujo alcanza un punto no resoluble por el agente.
- **R4-3** Al dispararse handoff:
  - `Conversation.metadata.handoff = true` se persiste.
  - `Lead.status = "handoff"` se actualiza (upsert si no existe lead, create si necesario).
- **R4-4** Si la solicitud es DENTRO de horario comercial: el agente confirma que pasará el caso a una persona del equipo.
- **R4-5** Si la solicitud es FUERA de horario comercial: el agente informa al usuario del horario y promete contacto en el próximo horario disponible. No promete atención inmediata.
- **R4-6** Si Slack está conectado (`Integration.provider = "slack"` con `status = "connected"`) Y `handoffSlackChannel` configurado: `send_slack_message` al canal con resumen de la conversación (nombre lead si existe, intención si existe, últimos N mensajes). Reutiliza el mecanismo `getValidToken` / executor existente de P2 (oauth-integrations).
- **R4-7** Si Slack NO está conectado o `handoffSlackChannel` no está configurado: el agente solo responde al usuario con mensaje de confirmación. El lead queda marcado `handoff`. Sin error para el usuario.
- **R4-8** Si Slack se desconecta a mitad del flujo (token revocado, `getValidToken` falla): la notificación falla silenciosamente (log de error, no excepción al usuario). El handoff en metadata/lead se persiste igual.
- **R4-9** El indicador de conversaciones en handoff es visible en el panel front.

### Escenarios

**Escenario R4-A — Handoff en horario con Slack**
```
DADO  un agente con businessHours configurado (lunes-viernes 9-18)
Y     Slack conectado con handoffSlackChannel = "#soporte"
Y     es martes a las 11:00 (zona Europa/Madrid)
CUANDO el usuario dice "quiero hablar con una persona"
ENTONCES `Conversation.metadata.handoff = true`
Y     `Lead.status = "handoff"`
Y     `send_slack_message` notifica a "#soporte" con resumen
Y     el agente responde confirmando que un humano tomará el caso
```

**Escenario R4-B — Handoff fuera de horario**
```
DADO  el mismo agente
Y     es sábado a las 15:00
CUANDO el usuario pide hablar con una persona
ENTONCES el agente informa que el equipo estará disponible lunes de 9 a 18
Y     el lead queda marcado `handoff`
Y     no se promete atención inmediata
```

**Escenario R4-C — Slack desconectado a mitad**
```
DADO  handoff activado
Y     `getValidToken("slack")` lanza error (token revocado)
ENTONCES la notificación falla con log de error interno
Y     el metadata y lead.status se persisten igualmente
Y     el usuario recibe el mensaje de confirmación de handoff (sin mención del error)
```

**Escenario R4-D — Horario malformado**
```
DADO  `businessHours` con formato inválido (ej: timezone = "Europa/Madrid_invalid")
CUANDO se evalúa si está en horario
ENTONCES fallback: se considera 24/7 (siempre en horario)
Y     se registra warning en log pero no error al usuario
```

---

## R5 — Estado de pedido (placeholder extensible)

### Descripción
Tool `get_order_status(orderId)` configurable por agente mediante endpoint externo (URL + auth cifrada). Si no configurado → respuesta honesta. Sin implementar ningún ecommerce concreto. Se registra en el catálogo skill→tool de `skills-execution-flow`.

### Decisión de config y cifrado
`ecommerceConfig.orderStatusUrl` + `ecommerceConfig.orderStatusApiKey` (cifrada con el mecanismo `enc:v1:<base64>` ya usado en `Integration.accessToken` y `ChannelConnection.credentials`). El cifrado y descifrado usa el módulo crypto existente del proyecto.

### Requisitos

- **R5-1** La tool `get_order_status` acepta parámetro `orderId: string`.
- **R5-2** Si `ecommerceConfig.orderStatusUrl` está configurado:
  - Descifra `orderStatusApiKey` y llama al endpoint externo con `orderId`.
  - Parsea la respuesta genérica (sin asumir formato Shopify/WooCommerce).
  - Devuelve al agente el estado recibido para que lo comunique al usuario.
- **R5-3** Si el endpoint externo falla (timeout, 4xx, 5xx):
  - La tool devuelve un error descriptivo al agente.
  - El agente responde honestamente ("no pude consultar el estado en este momento") y ofrece handoff.
  - Se registra el error en log interno.
- **R5-4** Si `orderStatusUrl` NO está configurado:
  - La tool devuelve un mensaje informativo: "No tengo acceso configurado al sistema de pedidos de este negocio."
  - El agente lo comunica al usuario y ofrece handoff.
  - Nunca inventa un estado de pedido.
- **R5-5** La tool `get_order_status` se registra en el catálogo `skill-capabilities.ts` (`SKILL_USE_TO_PROVIDER`) bajo la clave `ORDER_STATUS` / `ECOMMERCE`. Skill sin conexión a provider externo configurado → skill informativa (sin tool ejecutable). Con `orderStatusUrl` presente → ejecutable.
- **R5-6** El endpoint externo NO se asume ningún formato concreto. El contrato del cliente define qué devuelve; el agente interpreta la respuesta raw con sus capacidades de lenguaje natural.

### Escenarios

**Escenario R5-A — Con endpoint configurado y respuesta OK**
```
DADO  `ecommerceConfig.orderStatusUrl` = "https://api.cliente.com/orders"
Y     `ecommerceConfig.orderStatusApiKey` cifrada y válida
CUANDO el usuario pregunta por el pedido "12345"
ENTONCES `get_order_status("12345")` llama al endpoint externo con auth
Y     el agente comunica el estado al usuario según la respuesta del endpoint
```

**Escenario R5-B — Sin configurar**
```
DADO  `ecommerceConfig` sin `orderStatusUrl`
CUANDO el usuario pregunta por el pedido "12345"
ENTONCES el agente responde honestamente que no tiene acceso al sistema de pedidos
Y     ofrece escalar a handoff
Y     no inventa ningún estado
```

**Escenario R5-C — Endpoint caído**
```
DADO  endpoint configurado pero devuelve 500 o timeout
CUANDO se invoca `get_order_status`
ENTONCES la tool devuelve error al agente
Y     el agente responde que no pudo consultar en este momento
Y     ofrece handoff
Y     el error queda en log (no lanza excepción al usuario)
```

---

## Casos borde transversales

| Caso | Comportamiento esperado |
|------|------------------------|
| Knowledge vacío (0 chunks) | R1 y R2 no inyectan instrucción RAG; agente funciona sin ellas |
| Slack desconectado en handoff | Handoff se completa (metadata + lead.status); notificación omitida con log |
| Horario mal configurado (TZ inválida) | Fallback 24/7; warning en log; sin error al usuario |
| Endpoint pedidos caído | Respuesta honesta al usuario; log error; oferta de handoff |
| Lead sin intención | `leadIntent` omitido en metadata; panel lo omite silenciosamente |
| Handoff sin Lead previo | Se crea Lead mínimo (customerName del leadFlow o "Visitante") con status=handoff |
| `source` vacío en KnowledgeChunk | Chunk usado sin citar fuente; sin error |

---

## Dependencias de cambios

| Dependencia | Motivo |
|-------------|--------|
| `skills-execution-flow` (P4) | `get_order_status` se registra en `SKILL_USE_TO_PROVIDER` y `capabilitiesForSkills` de `skill-capabilities.ts`. Prerequisito para ejecutabilidad real de R5. |
| `oauth-integrations` (P2) | Handoff Slack usa `getValidToken` + `send_slack_message` executor existente (R4-6, R4-8). |
| `telegram-whatsapp-bots` (P1) | Todos los flujos funcionan en Telegram/WhatsApp vía `chatWithAgent` sin trabajo adicional. |
| `n8n-automations` (P3) | Recordatorios y seguimientos programados: fuera de alcance aquí. Dependencia futura. |

---

## Fuera de alcance

- Pasarela de pago o cobro.
- Catálogo de productos propio (fuente = RAG del cliente o su API).
- Integración con ecommerce concreto (Shopify / WooCommerce).
- Recordatorios de cita automatizados (dependen de P3 + skills-execution-flow).

---

## Decisiones a confirmar

| ID | Decisión | Implicación |
|----|----------|-------------|
| D1 | Campo nuevo `Agent.ecommerceConfig Json` en lugar de extender `widgetTemplateConfig` | Requiere migración SQL no destructiva (`ALTER TABLE "Agent" ADD COLUMN "ecommerceConfig" JSONB NOT NULL DEFAULT '{}'`) + rollback (`DROP COLUMN`). Alternativa: usar `widgetTemplateConfig` sin migración. |
| D2 | Detección de intención (R3): heurística en código vs. LLM-guided (inferida por el agente y reportada via tool/metadata) | LLM-guided es más preciso pero requiere una tool o mecanismo de reporte de intención. Heurística es más simple pero menos precisa. |
| D3 | Formato de `source` en cita: `(fuente: <source>)` inline vs. sección separada al final | Afecta solo al prompt; sin impacto en schema. |
| D4 | Handoff sin lead previo: crear Lead mínimo con `customerName = "Visitante"` vs. solo marcar metadata | Crear Lead permite ver en panel; solo metadata es menos invasivo. |

---

## Tests requeridos (contrato)

| Tipo | Qué verifica |
|------|-------------|
| Unit back | R1: system prompt incluye bloque RAG cuando hay chunks; no lo incluye si no hay chunks |
| Unit back | R2: descripción de `search_knowledge` incluye instrucción de citar `source` |
| Unit back | R3: metadata.leadIntent se guarda cuando hay intención detectada; omitido si no |
| Unit back | R4: `Conversation.metadata.handoff` y `Lead.status` se actualizan al handoff; Slack mock notifica; sin Slack degrada correctamente |
| Unit back | R4: horario malformado → fallback 24/7 sin error |
| Unit back | R5: con config → llama endpoint mock; sin config → mensaje claro; endpoint caído → respuesta honesta |
| E2E back | R4+R6: handoff con Slack mock → notificación enviada con resumen de conversación |
| Playwright front | Config ecommerceConfig (horario, endpoint, Slack channel) visible y editable en panel del agente |
| Playwright front | Vista de leads muestra leadIntent cuando existe |
| Playwright front | Indicador de conversaciones en handoff visible |
| Gate | `cd back && npm test` + `cd front && npm run build` en verde |
