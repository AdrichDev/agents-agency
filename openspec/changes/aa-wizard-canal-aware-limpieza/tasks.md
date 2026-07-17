# Tasks — aa-wizard-canal-aware-limpieza

Todo front. `front npx tsc --noEmit` + test de componente si el harness lo admite.
SIN backend, SIN migración. DONE solo con verde.

## F1 — Wizard 5→4 (quitar paso Skills)

- [x] **T1.1 — Quitar SkillsStep del wizard.** `page.tsx`: sacar `"Skills"` de `STEPS`
  (:28), eliminar `<SkillsStep/>` del render (:323-344), reubicar `<ReviewStep/>` como
  cierre del último paso, renumerar el gate `step`, quitar import (:16) y limpiar
  `useWizardSkills`/`skillNameCache`/props de skills huérfanas (~:9,140-151,331-341).
  `skillIds` en el POST → `[]` o quitar (back defaultea, `agents.ts:88`).
- [x] **T1.2 — Limpiar huérfanos.** Borrar `SkillsStep.tsx` y `useWizardSkills.ts` si
  quedan 0 imports externos (verificar con grep). `ReviewStep.tsx:42-45` quitar línea
  "Skills".
  - Test: `front tsc` verde; wizard con 4 pasos, sin paso Skills; submit crea (sin skillIds).

## F2 — Implementación canal-aware

- [x] **T2.1 — DeployPanel lee `agent.channel`.** Sección del canal elegido prominente;
  API REST siempre visible con nota "disponible siempre"; otros canales bajo desplegable
  "¿Publicar también en otro canal?"; apariencia widget solo bajo sección Widget.
  - Test: `channel="telegram"` → Telegram principal, snippet Widget NO en primer plano
    (bajo desplegable), API visible; `channel="widget"` → Widget principal.

## F3 — Renombrar "Solo API"

- [x] **T3.1 — Copy claro.** `ChannelStep.tsx:34-39`: title "Integración por API (sin
  canal de chat)" + desc que explique integración en sistemas propios. Mantener
  `standalone` + badge.
  - Test: `front tsc` verde; copy nuevo presente.

## F4 — Comentarios que mienten

- [x] **T4.1 — Actualizar comentarios stale** sobre `skillIds` "oculto/siempre []"
  (`types.ts:40`, `agents.ts:86`, `ReviewStep.tsx:34`) a la realidad post-H3.

## Verificaciones finales

- [x] **T5.1 — Typecheck** (`front tsc`, `back tsc` si se tocó algún comentario en back).
  Ambos verdes (exit 0).
- [ ] **T5.2 — Verificación visual (HITL):** crear un agente (4 pasos), abrir un agente
  Telegram y confirmar que Implementación NO ofrece Widget en primer plano. (Pendiente HITL.)
- [x] **T5.3 — Engram:** persistir (premisa skillIds corregida; DeployPanel canal-aware).

## Notas
- Backend solo se toca para el comentario stale de `agents.ts:86` (no lógica).
- No eliminar la capacidad de añadir un 2º canal (queda en el desplegable).
