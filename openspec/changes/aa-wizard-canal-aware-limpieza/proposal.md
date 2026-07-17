# Proposal — aa-wizard-canal-aware-limpieza

Hijo H3 del plan maestro `aa-agentes-rediseno-operativo` (P1, limpieza que desatasca).

## Corrección de premisa (verificada)

La auditoría inicial dijo "el wizard recoge `skillIds` pero lo fuerza a `[]` (inerte)".
**Verificado: FALSO.** El paso Skills del wizard **funciona** — el usuario elige skills y
el backend las persiste al crear (`service.ts:158`). Los comentarios que dicen
"oculto/siempre []" (`types.ts:40`, `agents.ts:86`, `ReviewStep.tsx:34`) están
**desactualizados y mienten**. Decisión de producto tomada: **quitar el paso Skills del
wizard** (las skills se configuran post-creación en SkillsTab, que H5 mejora) — no por
estar roto, sino por simplicidad y para no duplicar.

## Problema real (el bug que reportó el usuario)

`DeployPanel.tsx` (pestaña "Implementación") **NO lee `agent.channel` en ningún sitio**:
muestra las secciones Widget + Apariencia widget + API + Telegram + WhatsApp **siempre,
hardcodeadas** (`DeployPanel.tsx:194-393`). Por eso un agente marcado `telegram` recibe
igualmente el snippet de "Widget Web" y el editor de apariencia del widget. Cero ramas
por canal. Ese es el ruido.

`agent.channel` SÍ es autoritativo (`schema.prisma:142`, persistido, ya gatea
`ChannelConnectPanel` en `page.tsx:147`). Y el agente **siempre** queda accesible por API
(`publicKey` se genera sin depender del canal, `schema.prisma:154`).

Además, "Solo API (sin canal de mensajería)" (`ChannelStep.tsx:34-39`) es confuso.

## Scope (todo front; SIN backend, SIN migración)

- **F1 Wizard 5→4 pasos:** eliminar el paso/step SkillsStep del wizard
  (`front/app/agents/new/page.tsx`), reubicar ReviewStep como cierre del último paso.
  Backend intacto: `skillIds` sigue aceptado y defaulteado a `[]` (`agents.ts:88`), así
  que omitirlo o mandar `[]` no rompe nada. Skills → post-creación en SkillsTab.
- **F2 Implementación canal-aware:** `DeployPanel` lee `agent.channel` y muestra la
  sección del canal elegido de forma **prominente**; **API siempre** (nota "disponible
  siempre, se elija el canal que se elija"); los otros canales de mensajería quedan
  **de-enfatizados** tras un desplegable "¿Publicar también en otro canal?" (no se
  eliminan: se puede añadir un segundo canal luego). El editor de apariencia del widget
  solo bajo la sección Widget.
- **F3 Renombrar "Solo API":** copy más claro (p.ej. "Integración por API (sin canal de
  chat)") + descripción que explique que es para integrarlo en sistemas propios.
- **F4 Arreglar comentarios que mienten:** actualizar los comentarios stale sobre
  `skillIds` "oculto/siempre []" (`types.ts:40`, `agents.ts:86`, `ReviewStep.tsx:34`).

## Fuera de scope

- Mejora de SkillsTab (separar por tipo) → H5.
- Auto-captura del chat_id de Telegram → H4.
- Cualquier cambio de backend/logic o migración.

## Risks

- **Quitar el paso Skills** no debe romper la creación: verificar que el POST sin
  `skillIds` (o con `[]`) crea el agente igual (tests ya lo asumen,
  `agents-create-backend.test.ts:152`). Regresión cero.
- **DeployPanel canal-aware** no debe impedir añadir un segundo canal más tarde: los
  otros canales quedan accesibles (desplegable), no eliminados.

## Dependencies

- Front: `front/app/agents/new/page.tsx`, `front/components/agent-wizard/{SkillsStep,
  ReviewStep,ChannelStep,types}.tsx`, `front/hooks/useWizardSkills.ts`,
  `front/components/DeployPanel.tsx`, `front/app/agents/[id]/page.tsx`.
- `agent.channel` (`schema.prisma:142`) como fuente de verdad (solo lectura).
