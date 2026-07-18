# Validation — aa-agente-nombre-y-comprobar-estado

## User story

Como operador, quiero (F1) que al ponerle un nombre al agente, éste se presente con ese
nombre sin tener que escribirlo en el prompt; y (F2) que la pantalla de Implementación no
me ofrezca "Comprobar estado" cuando el agente no tiene ningún canal de mensajería que
comprobar.

## Acceptance criteria

- **AC1 (F1)**: `buildSystemPrompt` inyecta el nombre del agente cuando está presente, de
  modo que el agente se identifica con ese nombre. El `systemPrompt` del operador se respeta.
- **AC2 (F1)**: sin `name`, el prompt no añade la línea (no rompe agentes sin nombre).
- **AC3 (F2)**: "Comprobar estado" y las secciones de estado Telegram/WhatsApp solo se
  muestran cuando hay una conexión de mensajería o el canal es telegram/whatsapp; en un
  agente widget/api sin conexiones, no aparecen.
- **AC4 (regresión cero)**: la lógica de chat/runtime no cambia; conectar canales en la
  pestaña Canales y el desplegable "otro canal" siguen funcionando.

## Given-When-Then

**Escenario 1 (AC1):**
Given un agente con name="Lucía" y un systemPrompt que no menciona el nombre
When se construye el system prompt y el agente responde a "¿cómo te llamas?"
Then el prompt incluye "Te llamas Lucía…" y el agente se identifica como Lucía.

**Escenario 2 (AC3):**
Given un agente canal widget sin bots conectados
When abro Implementación
Then no veo el botón "Comprobar estado" ni secciones de estado Telegram/WhatsApp.

## Test por tarea
- T1.1 → prompt con/sin nombre.
- T2.1 → `front tsc`; botón oculto sin conexiones/widget, visible con conexión telegram.

Regla del repo: DONE con test verde (+ HITL visual en el front).
