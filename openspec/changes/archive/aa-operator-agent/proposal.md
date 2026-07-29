# Proposal v2: Operator Agent — el copiloto personal de Adrian

> v2 (03/07/2026): re-alcance por petición de Adrian. v1 (operador solo
> agents-agency, segundo bot Telegram) queda superada.

## Intent

Un bot PERSONAL para Adrian — no atiende clientes, no registra citas, no
reserva nada. Es su copiloto de plataforma: Adrian le escribe por Telegram o
por un chat embebido en las consolas, y el bot ejecuta tareas sobre TODO
3A_Estudio, distinguiendo solo a qué plataforma pertenece cada orden:

- **agents-agency**: alta de cliente (aa.tenant), convertir lead → cliente,
  crear agentes según las necesidades que Adrian describa, estado general.
- **creador_CRM**: estado de negocios/proyectos, consultas operativas.
  (v1 de tools CRM = solo lectura; escrituras CRM en fase posterior.)

Ejecutado por OpenClaw (`runtime="openclaw"` vía puente aa-openclaw-brain),
totalmente humanizado (mismas reglas de voz que IDENTITY.md v3), con memoria
propia y auto-aprendizaje.

## Arquitectura

1. **Canal Telegram**: se REUTILIZA el bot actual. Se le quita al receptionist
   (que queda solo en widget) y se re-bindea al agente `operator` con
   `dmPolicy: allowlist` + `allowFrom: [chat-id de Adrian]`. Nadie más puede
   hablarle.
2. **Cerebro**: agente OpenClaw `operator` aislado (workspace propio,
   OPERATOR.md), separado del receptionist. Modelos: los configurados (Gemini
   primary + fallbacks) — sin cambios.
3. **Manos (tools MCP)**: server `plataforma` (patrón n8n/SSE como citas):
   - `agencia_estado`, `agencia_crear_cliente`, `agencia_convertir_lead`,
     `agencia_crear_agente`
   - `crm_estado`, `crm_listar_negocios` (lectura v1)
   - `memoria_guardar`, `memoria_buscar` (ver punto 4)
   Cada server-side call con service token scoped por plataforma; el LLM
   jamás ve tokens. Auditoría de toda escritura.
4. **Memoria + auto-aprendizaje (el "RAG en tiempo real")**:
   - Estado vivo de la plataforma = SIEMPRE por tools de API (verdad en
     tiempo real; no se indexan copias que caducan).
   - Memoria de largo plazo = pgvector del stack OpenClaw (ya desplegado,
     embeddings bge-m3, 1024 dims): hechos, preferencias de Adrian,
     decisiones, contexto de proyectos. El bot guarda tras cada conversación
     (destilado) y recupera top-k por turno. Eso es el auto-aprendizaje
     honesto y operable — NO fine-tuning del modelo.
5. **UI**: widget de chat en AMBOS fronts (agents-agency y creador_CRM),
   visible solo para Adrian (rol admin/cuenta concreta), hablando con el
   gateway a través de un proxy en cada back (token servidor-a-servidor).

## Security stance (no negociable)

- Allowlist Telegram por chat-id (no username). Todo otro origen: rechazo + log.
- Confirmación explícita previa a toda escritura, validada en el MCP server
  (parámetro confirmado + estado de flujo), no solo en el prompt.
- v1 sin borrados. Tokens scoped, rotables, solo server-side. Auditoría total.
- El widget en los fronts exige sesión del usuario Adrian; el proxy back
  verifica identidad antes de reenviar al gateway.

## Out of scope

- Escrituras en creador_CRM (fase posterior, spec propia).
- Multi-usuario. Borrados. Fine-tuning. Telemetría espejo (sigue diferida).

## Decisiones ya tomadas

- Cliente = aa.tenant; posible cliente = Lead de agents-agency (Adrian, v1).
- Bot Telegram actual → operador; receptionist sin Telegram (Adrian, v2).
- Memoria = tools API (vivo) + pgvector (aprendizaje), no RAG de codebase.
