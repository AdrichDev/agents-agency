# Design — aa-wizard-canal-aware-limpieza

Todo front. Sin backend, sin migración. `agent.channel` es solo-lectura (fuente verdad).

## §A. Evidencia (verificada)

- Wizard: `front/app/agents/new/page.tsx` — `STEPS` con 5 entradas (`page.tsx:28`), la 5ª
  `"Skills"`; `step===5` renderiza `<SkillsStep/>` + `<ReviewStep/>` juntos
  (`page.tsx:323-344`). SkillsStep es funcional (`SkillsStep.tsx:77-89`), skills reales de
  `GET /api/skills` (`useWizardSkills.ts:30`), enviadas en el POST (`page.tsx:228`),
  persistidas por el back (`service.ts:158`).
- Backend defaultea `skillIds: z.array(z.string()).default([])` (`agents.ts:88`) → omitir
  o `[]` es válido; tests lo asumen (`agents-create-backend.test.ts:152`).
- ChannelStep: 4 opciones (`ChannelStep.tsx:18-40`), "Solo API" = `api`/`standalone`
  (`:34-39`), radio único (`:61`). Subtítulo ya dice "siempre disponible vía API" (`:55`).
- DeployPanel (`front/components/DeployPanel.tsx`): 4 secciones hardcodeadas
  (`:194-393`), **no lee `agent.channel`**. Solo dinámico: estado de conexión
  telegram/whatsapp (`:96-107`), `agent.widgetInstalledAt` (`:167`), `agent.publicKey`.
- `agent.channel` (`schema.prisma:142`) informativo; ya gatea `ChannelConnectPanel`
  (`page.tsx:147`). `publicKey` siempre generado (`schema.prisma:154`).

## §B. F1 — Wizard 5→4 pasos (quitar Skills)

1. `page.tsx:28` — quitar `"Skills"` de `STEPS` → 4 entradas.
2. `page.tsx:323-344` — eliminar `<SkillsStep/>`; `ReviewStep` pasa a cerrar el último
   paso (nuevo paso 4, junto a DataBackend, tal como Skills+Review convivían). Renumerar
   el gate de `step`.
3. `page.tsx:16` — quitar import `SkillsStep`.
4. `page.tsx` (`useWizardSkills`, `skillNameCache`, props de skills a ReviewStep, líneas
   ~9,140-151,331-341) — limpiar lo que quede huérfano. `ReviewStep` ya tiene
   `skillNames` opcional con default `[]` (`ReviewStep.tsx:5`) → pasar `[]` o quitar prop.
5. `page.tsx:228` — dejar `skillIds: []` (o quitarlo; el back defaultea). Retrocompat.
6. Ficheros huérfanos (`SkillsStep.tsx`, `useWizardSkills.ts`): dejar o borrar; si se
   borran, verificar que nadie más los importa. Preferir borrar para no dejar peso muerto,
   tras confirmar 0 imports externos.
7. `ReviewStep.tsx:42-45` — quitar la línea "Skills" del resumen.

**Regresión**: crear un agente sin el paso Skills debe funcionar igual (el back crea con
0 skills). Las skills se añaden luego en SkillsTab (`PUT /api/agents/:id/skills`).

## §C. F2 — DeployPanel canal-aware

Introducir lectura de `agent.channel` (hoy inexistente en DeployPanel). Layout nuevo:

```
Implementación
┌─────────────────────────────────────────────┐
│ Canal principal: Telegram          🟢 conectado│  ← sección del agent.channel, PROMINENTE
│  [estado / conectar / instrucciones]          │
├─────────────────────────────────────────────┤
│ 🔌 API REST (disponible siempre)              │  ← SIEMPRE visible
│  curl … publicKey …                           │
├─────────────────────────────────────────────┤
│ ▸ ¿Publicar también en otro canal?            │  ← desplegable, de-enfatizado
│    (Widget web · WhatsApp · …)  los no elegidos│
└─────────────────────────────────────────────┘
```

Reglas:
- **Sección del canal elegido** (`agent.channel`) arriba, expandida:
  - `widget` → snippet + apariencia del widget + estado instalación.
  - `telegram`/`whatsapp` → estado de conexión + instrucciones.
  - `api` (standalone) → la sección API es la principal (no hay "otro canal" por defecto).
- **API REST** siempre visible con nota "disponible siempre, se elija el canal que se
  elija" (coherente con `ChannelStep.tsx:55`).
- **Otros canales** de mensajería (los no elegidos) bajo un desplegable "¿Publicar también
  en otro canal?" — accesibles pero no en primer plano. No se eliminan (se puede añadir un
  segundo canal). El editor de apariencia del widget solo aparece si widget es el canal
  principal o se añade desde el desplegable.
- Fuente de verdad: `agent.channel`. No inventar estado; leer lo que ya viaja
  (`page.tsx:184` ya pasa `agent` a DeployPanel).

## §D. F3 — Renombrar "Solo API"

`ChannelStep.tsx:34-39`:
- title: `"Solo API (sin canal de mensajería)"` → `"Integración por API (sin canal de chat)"`.
- desc: aclarar — "Para integrar el agente en tu web, app o sistemas propios vía API REST
  (su publicKey). No conecta ningún chat; lo llamas tú desde tu código."
- Mantener `standalone:true` y el badge.

## §E. F4 — Comentarios que mienten

Actualizar (no borrar funcionalidad, solo el comentario):
- `types.ts:40` — el comentario "siempre []" es falso; corregir o quitar.
- `agents.ts:86` — comentario "Skills oculto del wizard": tras H3 el wizard ya no manda
  skills; ajustar el comentario a la realidad (skills se configuran post-creación).
- `ReviewStep.tsx:34` — comentario stale.

## §F. Tests (front tsc + componente si el harness lo admite)

- **F1**: `front npx tsc --noEmit` verde tras quitar el paso. Test (si aplica): el wizard
  tiene 4 pasos, no existe paso "Skills"; el submit crea sin `skillIds` (o `[]`).
- **F2**: dado `agent.channel="telegram"`, DeployPanel muestra la sección Telegram como
  principal y NO muestra el snippet Widget en primer plano (queda bajo el desplegable);
  API siempre visible. Dado `channel="widget"`, Widget es principal.
- **F3/F4**: copy renombrado presente; comentarios actualizados.

Regla del repo: DONE solo con test verde.
