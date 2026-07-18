# Proposal — aa-agente-nombre-y-comprobar-estado

Dos mejoras pequeñas de UX/comportamiento (follow-up del rediseño de agentes).

## F1 — El agente se presenta con su nombre

Hoy el agente tiene campo `name` (`AgentForPrompt.name` existe) pero `buildSystemPrompt`
(`engine.ts:388`) usa SOLO `agent.systemPrompt` — **no inyecta el nombre**. Por eso un
agente solo se presenta con su nombre si el prompt lo menciona explícitamente (p.ej. DorsIA
lo lleva escrito). Si el operador solo rellena el campo Nombre, el agente NO se auto-identifica.

**Cambio:** inyectar el nombre en el system prompt (p.ej. "Te llamas {name}. Cuando te
presentes o te pregunten cómo te llamas, usa ese nombre.") — solo si `name` está presente.
Aplica a TODOS los agentes. El `systemPrompt` del operador sigue mandando sobre el resto.

## F2 — Ocultar "Comprobar estado" cuando no hay canal que comprobar

`DeployPanel` muestra el botón "Comprobar estado ⟳" (`DeployPanel.tsx:434`) que re-consulta
`GET /api/channels/:id/status` (estado de conexión Telegram/WhatsApp). Pero ese fetch YA se
ejecuta solo al abrir el panel (`:107`), y para un agente **solo Widget/API sin bot
conectado** no hay nada que comprobar → el botón es ruido.

**Cambio:** mostrar "Comprobar estado" (y las secciones de estado Telegram/WhatsApp) solo
cuando hay al menos una conexión de mensajería (`channels.connections` no vacío) o el canal
del agente es telegram/whatsapp. Si es widget/api sin conexiones → ocultar. Coherente con la
línea canal-aware de H3.

## Fuera de scope
- Reordenar/unificar el bloque "backend de datos" (los 3 conceptos mezclados) — deuda
  conocida, otro change.

## Risks
- Bajo. F1: aditivo al prompt (no rompe prompts existentes; el nombre es una línea más).
  F2: solo visibilidad de UI. Regresión cero en la lógica.

## Dependencies
- `back/src/lib/agent/engine.ts` (`buildSystemPrompt`, `AgentForPrompt`), `front/components/DeployPanel.tsx`.
