# Tasks — aa-openclaw-provision-hardening

Order is critical: reliability layer first, UX second.

## Phase 1 — provisioning reliability

- [x] T1.1 `admin-rpc.ts`: add `listModels()` gateway probe (fail-soft noop).
- [x] T1.2 `provision.ts`: liveness-based `provisionState` in read-back;
      remove phantom `workspace` from `buildAgentEntry` + legacy cleanup on merge.
- [x] T1.3 `provision.ts`: `reconcileAgentsProvisioning()` (single-pass merge,
      orphan removal, idempotent patch, per-agent live states).
- [x] T1.4 `reconcile.ts` + `index.ts`: reconcile cron (10 min, kill-switch,
      graceful shutdown).
- [x] T1.5 `service.ts` + `routes/agents.ts`: `recheckOpenclawProvisioning` +
      `POST /api/agents/:id/openclaw/recheck`.
- [x] T1.6 `OpenClaw_Agents/setup.sh`: agents.list patch preserves `aa-*` entries.
- [x] T1.7 Tests: live-probe + reconcile coverage in
      `tests/openclaw-provision.test.ts`; keep `agent-create-openclaw.test.ts` green.

## Phase 2 — wizard UX

- [x] T2.1 `types.ts` / `useAgentWizard.ts`: `runtime` field, sessionStorage draft
      + `clearDraft()`.
- [x] T2.2 `ChannelStep.tsx`: channel choice only (widget styling lives in the
      agent detail Deploy tab).
- [x] T2.3 `PromptStep.tsx`: explicit runtime selector; cloud model/effort
      selectors only for `runtime="openai"`.
- [x] T2.4 `new/page.tsx`: 4 steps, per-step validation, post-create provisioning
      panel with auto+manual recheck; `returnTo` flow unchanged.
- [x] T2.5 `[id]/page.tsx`: provisioning chip → click to re-sync.

## Final verification

- [x] V1 `cd back && npm test && npm run typecheck` — verificado 28/07/2026: 146 ficheros / 1726 tests verdes (3 skipped), `tsc --noEmit` exit 0.
- [x] V2 `cd front && npm run typecheck` — verificado 28/07/2026: `tsc --noEmit` exit 0.
- [ ] V3 Manual: restart OpenClaw container → `aa-*` entries preserved (log line);
      create agent with gateway down → cron converges; chip resync works. — ⏳ GATE HUMANO irreducible: exige reiniciar el contenedor de OpenClaw y observar la convergencia en vivo. No hay test que lo sustituya.

## Cierre — 28/07/2026

Cerrado con una única acción humana pendiente (V3), que exige un contenedor en vivo.

Las tareas de implementación se comprobaron contra el código, no contra el documento, porque existía una anotación previa que trataba el commit `3ca063f` como un WIP que nadie había verificado. Esa anotación era pesimista de más: el trabajo está y es coherente.

- T1.3 `reconcileAgentsProvisioning` — `back/src/lib/openclaw/provision.ts:196`, serializada sobre una versión `Unsafe` para evitar el read-modify-write concurrente.
- T1.4 cron — `back/src/lib/openclaw/reconcile.ts`, arrancado en `index.ts:306` con kill-switch (`ENABLE_CRONS === "false"`) y `clearInterval` en el apagado ordenado (`:331`).
- T1.5 endpoint — `routes/agents.ts:290` (`POST /:id/openclaw/recheck`) sobre `service.ts:483`.
- T1.6 `setup.sh` — el patch de `agents.list` va aparte y preserva las entradas `aa-*` (comentario en `:22-23`).
- T1.7 tests — `tests/openclaw-provision.test.ts` y `tests/agent-create-openclaw.test.ts` existen y están en verde.
- T2.1 borrador del wizard — `useAgentWizard.ts:34-41`, `sessionStorage` + `clearDraft` al crear con éxito.
- T2.5 chip de re-sincronización — `app/agents/[id]/page.tsx:74` llama al endpoint de recheck.
