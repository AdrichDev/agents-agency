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

- [ ] **T3.1 — Typecheck + suite** (`back` vitest+tsc, `front` tsc) verde.
- [ ] **T3.2 — Engram.**

## Notas
- SIN migración. F1 aditivo al prompt (regresión cero). F2 solo visibilidad UI.
