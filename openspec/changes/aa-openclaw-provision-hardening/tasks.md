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

- [ ] V1 `cd back && npm test && npm run typecheck`
- [ ] V2 `cd front && npm run typecheck`
- [ ] V3 Manual: restart OpenClaw container → `aa-*` entries preserved (log line);
      create agent with gateway down → cron converges; chip resync works.
