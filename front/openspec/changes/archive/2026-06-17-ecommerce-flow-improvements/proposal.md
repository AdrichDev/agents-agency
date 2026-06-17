# Proposal — ecommerce-flow-improvements

Canal objetivo: **todos** (widget / api / telegram / whatsapp; pipeline común
`chatWithAgent`).

## Intención

Aportar flujos de conversación de alto valor inspirados en casos de uso estándar
de chatbots para ecommerce y webapps, **apoyándose en lo que el código ya
soporta** y dejando placeholders claros donde se necesita integración externa
del cliente. El objetivo es que un agente de tienda online resuelva las
interacciones más frecuentes: encontrar producto, resolver dudas con citas,
recuperar ventas perdidas como leads, consultar estado de pedido y escalar a una
persona cuando hace falta.

## Estado real relevante (evidencia)

- **RAG operativo:** existe `search_knowledge` siempre disponible
  (`back/src/lib/agent/tools.ts:134`, handler `executor.ts:31` →
  `searchKnowledge(agentId, query)`), y el prompt ya obliga a usarlo
  (`engine.ts:46`). Base para recomendación de producto y FAQ.
- **Captura de lead viva:** `lead-flow.ts` ya gestiona nombre, consentimiento,
  email/teléfono y crea `Lead` (`engine.ts:126-160`, `lead-flow.ts:50`). Base
  para recuperación de carrito y handoff.
- **Slack disponible:** `send_slack_message` ejecutable cuando Slack está
  conectado (`tools.ts:58`, `executor.ts:39`). Base para notificar handoff.
- **Mensajería multicanal:** Telegram/WhatsApp ya delegan en `chatWithAgent`
  (`back/src/routes/channels.ts:321,448`), así que estos flujos funcionan en
  todos los canales sin trabajo extra.
- **Pendiente externo:** NO existe integración con sistemas de pedidos/ecommerce
  del cliente (sin Shopify/WooCommerce/API propia). El estado de pedido requiere
  un placeholder de integración.

## Candidatas priorizadas (4-5, por soporte ya existente)

1. **Recomendación de producto desde RAG.** Reutiliza `search_knowledge` sobre
   la base de conocimiento del cliente para sugerir productos/fichas. Soporte:
   alto (ya existe). Esfuerzo: bajo (prompt + skill informativa).
2. **FAQ enriquecido con citas de fuentes.** Las respuestas de RAG incluyen la
   fuente (web/documento) de la que provienen, para dar confianza. Soporte:
   alto. Requiere que `searchKnowledge` devuelva metadatos de origen
   (verificar/ampliar).
3. **Recuperación de carrito / seguimiento → captura de lead con intención.**
   Cuando el usuario muestra interés en un producto y no cierra, ofrecer
   seguimiento y capturar lead etiquetado con la intención ("interesado en X").
   Soporte: medio (reusa `lead-flow`); requiere campo/etiqueta de intención.
4. **Horario comercial + escalado a humano (handoff).** Si el usuario pide hablar
   con una persona o fuera de un flujo resoluble, marcar la conversación para
   handoff y, si Slack está conectado, notificar al equipo con
   `send_slack_message`. Soporte: medio-alto (Slack tool + lead). 
5. **Consulta de estado de pedido (placeholder de integración).** Tool
   `get_order_status(orderId)` que llama a una **API externa configurable del
   cliente** (URL + auth en config del agente). En esta fase: contrato + stub +
   manejo de "no configurado" (no se implementa ninguna API concreta de
   ecommerce). Soporte: bajo (todo nuevo, depende de config del cliente).

(Recordatorio de cita vía n8n queda como extensión natural pero **depende de P3
n8n-automations** y de `skills-execution-flow`; se documenta como dependencia,
no se entrega aquí.)

## Alcance (in-scope)

- Recomendación de producto y FAQ con citas sobre el RAG existente
  (candidatas 1 y 2).
- Recuperación de carrito → lead con intención (candidata 3): etiqueta de
  intención en el `Lead` o en `Conversation.metadata` (sin tabla nueva si
  metadata basta).
- Handoff a humano (candidata 4): marca de estado de handoff en
  `Conversation.metadata` + notificación Slack opcional cuando esté conectado;
  respeto de horario comercial configurable.
- Estado de pedido como **placeholder** (candidata 5): definición de la tool, su
  config (URL externa + auth) y comportamiento "no configurado" claro; sin
  integración real de ningún ecommerce concreto.

## Fuera de alcance (out-of-scope)

- Pasarela de pago / cobro.
- Catálogo de productos propio (la fuente de producto es el RAG del cliente o su
  API externa).
- Integración real con un ecommerce concreto (Shopify/WooCommerce); aquí solo el
  contrato/placeholder.
- Recordatorios de cita automatizados (dependen de P3 + skills-execution-flow).

## Enfoque

1. **RAG con fuentes:** verificar/ampliar `searchKnowledge` para devolver origen
   y citarlo en la respuesta (FAQ + recomendación).
2. **Intención de lead:** extender el flujo de `lead-flow.ts` /
   `Conversation.metadata` para guardar "interesado en X" al capturar el lead.
3. **Handoff:** estado `handoff` en `Conversation.metadata`; si Slack conectado,
   `send_slack_message` al canal del equipo; horario comercial en config del
   agente para decidir respuesta inmediata vs "te contactaremos".
4. **Order status (placeholder):** nueva tool `get_order_status` con config de
   endpoint externo por agente; si no hay config, el agente lo indica y ofrece
   handoff. Encaja en el catálogo skill→tool de `skills-execution-flow`.
5. **Front:** ajustes de config del agente (horario comercial, endpoint de
   pedidos, canal Slack de handoff) y visualización de leads con intención.
6. **Tests** (vitest back + playwright front) por cada flujo.

## Dependencias entre changes

- **skills-execution-flow:** las nuevas capacidades (order status, handoff
  vía Slack) deben exponerse como tools ejecutables mediante el mecanismo
  skill→tool definido en ese change. Es prerrequisito para que sean ejecutables
  y no decorativas.
- **P2 (oauth-integrations):** la notificación de handoff por Slack requiere
  Slack realmente conectado y `getValidToken` operativo.
- **P3 (n8n-automations):** los recordatorios de cita y seguimientos
  programados (fuera de alcance aquí) dependerían del motor n8n.
- **Comparte pipeline con P1 (telegram-whatsapp-bots):** todos los flujos
  funcionan en Telegram/WhatsApp por delegar en `chatWithAgent`.

## Riesgos / preguntas abiertas

- **RAG sin fuentes estructuradas:** si `searchKnowledge` no expone el origen,
  citar fuentes exige cambios en embeddings/recuperación; verificar antes de
  comprometer la candidata 2.
- **Order status sin estándar:** cada cliente tiene su API; el contrato del
  placeholder debe ser genérico (URL + auth + mapeo de respuesta) para no atarse
  a un proveedor.
- **Handoff y horario:** definir qué es "horario comercial" (zona horaria del
  agente) y qué pasa fuera de él; evitar prometer respuesta inmediata si no hay
  nadie.
- **Intención de lead en metadata vs columna:** empezar en
  `Conversation.metadata` (sin migración); si se necesita filtrar/reportar por
  intención, evaluar columna en `Lead` en una fase posterior.
- **Solape con lead-flow:** el flujo de contacto ya pregunta nombre/email/
  teléfono; la recuperación de carrito debe encadenarse con él, no duplicarlo.
- **Cambios de schema:** preferentemente ninguno (usar `Conversation.metadata`).
  Si se añade etiqueta de intención o config de pedido como columnas, incluir SQL
  manual no destructivo y plan de rollback (DROP COLUMN).
