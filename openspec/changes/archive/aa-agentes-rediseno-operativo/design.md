# Design — aa-agentes-rediseno-operativo

Plan maestro. Cero código. De aquí salen los openspec hijos.

## §A. Anatomía de un bot operativo (referencia)

Cómo montan bots operativos los productos serios (Voiceflow, Botpress, Chatwoot,
Intercom Fin, ManyChat). Siete capas. AA tiene 5 de 7; le faltan las 2 que dan la
"sensación de operativo".

| # | Capa | Qué es | Referencia del sector |
|---|------|--------|-----------------------|
| 1 | **Canales (adaptadores)** | Puertas de entrada: web widget, Telegram, WhatsApp, IG, API. El agente es UNO; el canal es front. | ManyChat (multicanal), Chatwoot (inbox unificado) |
| 2 | **Cerebro (LLM + prompt + runtime)** | Modelo, system prompt, temperatura/effort, memoria de sistema. | Voiceflow "Agent", OpenAI Assistants |
| 3 | **Tools / Acciones** | Function-calling: consultar disponibilidad, crear reserva, guardar lead, consultar pedido, notificar, handoff. | Botpress "Actions", Voiceflow "Functions" |
| 4 | **Conocimiento / RAG** | Ingesta real de webs/docs → chunks → embeddings → retrieval con citación. **Requiere render de JS y estado honesto.** | Intercom Fin (Knowledge), Voiceflow KB |
| 5 | **Memoria por conversación** | Contexto por hilo/usuario; no re-preguntar lo dicho. | Todos |
| 6 | **Handoff a humano** | Escalar a persona con contexto; notificar al dueño. | Chatwoot, Intercom |
| 7 | **Consola de pruebas + observabilidad** | Simulador para hablarle ANTES de publicar viendo tools + chunks + trazas; transcripts y evals después. | Voiceflow "Test", Botpress "Emulator", Fin "Preview" |

**Regla de oro del sector:** nadie publica un bot sin pasarlo por (7). Es el bucle que
convierte "config a ciegas" en "producto operativo".

## §B. Gap actual vs ideal (evidencia file:line)

| Capa | Estado AA | Evidencia | Gap |
|------|-----------|-----------|-----|
| 1 Canales | Widget/Telegram/WhatsApp/API, radio único | `ChannelStep.tsx:34-61` | Ofrece los 4 siempre; Widget no es reflejo de Telegram; "Solo API" mal nombrado. UX, no lógica. |
| 2 Cerebro | runtime openclaw/openai, model/effort/temp | `PromptStep.tsx:4` | OK. Funcional. |
| 3 Tools | managed_db + ecommerce (`consultar_pedido`) vivos; `external_api` sin UI | `executor.ts:87-95`, `external-api.ts:77` | external_api completo en backend, **inalcanzable** (falta formulario). |
| 4 RAG | **ROTO** | `service.ts:233-234` (miente estado), `web.ts:20-25` (sin JS), `embeddings.ts:48` (filtro <50) | Sitios SPA → 0 chunks + estado "indexado" falso. Fundamento caído. |
| 5 Memoria | Por conversación | (runtime) | OK. |
| 6 Handoff | `request_human_handoff` + notify dueño | `notify-dispatcher.ts:113` | OK; chat_id se pide a pelo (UX). |
| 7 **Consola/observabilidad** | **NO EXISTE** | — | Se publica a ciegas. **Agujero grande.** |

Extra (creación): el wizard renderiza `SkillsStep` pero fuerza `skillIds:[]`
(`types.ts:40`) → selección inerte; Skills/MCP mezclados sin filtro por tipo
(`SkillsTab.tsx:314`).

## §C. Backbone priorizado

### P0 — Columna vertebral (sin esto no hay producto operativo)

**P0.1 — Consola de pruebas del agente.**
- Qué: panel en la ficha del agente para chatear contra el runtime real ANTES de
  publicar, mostrando en vivo: (a) tools disparadas + argumentos + resultado, (b)
  chunks de conocimiento recuperados con su fuente, (c) latencia y coste.
- Por qué P0: es lo que da "sensación de operativo" y lo que evita publicar basura.
- Riesgos a resolver en el spec hijo: gating de cuota LLM, aislamiento de datos de
  prueba, no ensuciar métricas de producción.

**P0.2 — RAG real (ingesta + estado honesto + retrieval visible).**
- Qué: (a) render de JS para sitios SPA (headless o API de scraping); (b) estado que
  NO mienta — `"empty"`/`"partial"`/`"indexed"` con nº real de chunks y motivo si 0;
  (c) revisar/quitar el filtro `<50 chars` ciego; (d) ver los chunks indexados y los
  recuperados por una query en la UI.
- Por qué P0: un bot sin conocimiento del negocio no responde nada útil. Fundamento.

### P1 — Limpieza que desatasca (barato, alto retorno)

**P1.1 — Wizard canal-aware + sin campos inertes.**
- Quitar `skillIds` del wizard (es `[]` forzado); ofrecer/explicar canales según
  aplican; renombrar "Solo API" a algo claro ("Agente por API / sin canal de chat").

**P1.2 — Auto-captura del chat_id de Telegram del dueño.**
- Cuando el dueño escribe al bot, capturar su chat_id numérico y ofrecerlo en el panel
  de notificaciones en vez de pedirlo a pelo.

**P1.3 — Skills/Agentes/MCP separados por tipo.**
- Agrupar/pestañas por `type` (SKILL/AGENT/MCP/EXTENSION/PLUGIN), no solo por `use`.

### P2 — Cerrar features a medias (o retirarlas con honestidad)

**P2.1 — UI para `external_api`** (adapter ya existe; solo falta formulario URL+key).
**P2.2 — Integraciones**: cablear Jira/Instagram o quitarlas del catálogo hasta que
lo estén (hoy son "Próximamente" que confunden).
**P2.3 — Automatización NL**: estado honesto cuando n8n está apagado (el JSON se
guarda pero no ejecuta); decidir si se amplían triggers o se recorta el alcance del
feature hasta tener motor estable.

## §D. Principio rector del rediseño

No reconstruir todo a la vez. **Un openspec hijo por pieza**, P0 antes que P1 antes que
P2. Cada hijo lleva su propia validación (test verde = DONE). Este doc es el mapa; no
se codea desde aquí.
