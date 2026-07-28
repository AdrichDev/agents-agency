# Tasks — aa-agente-nombre-y-comprobar-estado

Tests **vitest** (back) + front `tsc`. SIN migración. DONE con verde.

## F1 — Nombre en el system prompt (backend)

- [x] **T1.1 — Inyectar el nombre** en `buildSystemPrompt` (`engine.ts:209`, ensamblado
  ~:388). Si `agent.name` está presente, añadir una línea al prompt: "Te llamas {name}.
  Cuando te presentes o te pregunten cómo te llamas, usa ese nombre." Verificar que
  `AgentForPrompt` incluye `name` (existe) y que `runAgent` lo pasa (el select ya lo trae).
  El `agent.systemPrompt` del operador se mantiene. Aplica a runtime openai y openclaw.
  - Test: `buildSystemPrompt` con `name:"Lucía"` → el prompt contiene el nombre; sin name → sin la línea.

## F2 — Ocultar "Comprobar estado" sin canal de mensajería (front)

- [x] **T2.1 — Visibilidad condicional** en `DeployPanel.tsx`: mostrar el botón "Comprobar
  estado" (:434) y las secciones de estado Telegram/WhatsApp SOLO si `channels.connections`
  tiene alguna entrada O el canal del agente es telegram/whatsapp. Si widget/api sin
  conexiones → ocultar (no romper el desplegable "otro canal" ni el connect en Canales).
  - Test: `front tsc` verde; con connections vacío + channel widget → botón oculto; con una
    conexión telegram → visible.

## Verificaciones finales

- [x] **T3.1 — Typecheck + suite** (`back` vitest+tsc, `front` tsc) verde. — verificado 28/07/2026: back 146 ficheros / 1726 tests verdes y `tsc --noEmit` exit 0; front `tsc --noEmit` exit 0.
- [x] **T3.2 — Engram.** — persistido bajo `architecture:aa-agente-nombre-y-estado`.

## Cierre — 28/07/2026

Cerrado. Las dos tareas de implementación se comprobaron contra el código, no contra el documento:

- T1.1: `back/src/lib/agent/engine.ts:442` inyecta la línea del nombre, y sólo si `agent.name` tiene valor — la guarda existe porque sin ella las filas antiguas producían `Te llamas ""`. Tres tests en `tests/engine.test.ts` (con nombre, otro nombre, y sin nombre).
- T2.1: `showStatusCheck = hasMessagingConnections || isMessagingChannel` en `DeployPanel.tsx:319-326`, con el botón condicionado en `:581`.

Corrección al documento: T2.1 situaba el componente en `front/components/agents/DeployPanel.tsx`. Esa carpeta no existe — el fichero está en `front/components/DeployPanel.tsx`.

## Notas
- SIN migración. F1 aditivo al prompt (regresión cero). F2 solo visibilidad UI.
