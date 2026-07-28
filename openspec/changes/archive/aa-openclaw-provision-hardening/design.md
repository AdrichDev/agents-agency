# Design — aa-openclaw-provision-hardening

## Architecture

Three layers of guarantees, weakest to strongest:

1. **Event sync (existing)** — create/update/delete hooks call
   `syncAgentProvisioning` (fail-soft). Now returns a *liveness-based* state:
   after the config read-back, `GET /v1/models` on the gateway decides
   `provisioned` (target served) vs `pending` (in config, restart pending).
2. **On-demand recheck (new)** — `recheckOpenclawProvisioning(id)` in
   `lib/agent/service.ts`, exposed as `POST /api/agents/:id/openclaw/recheck`.
   Re-runs the upsert + live probe and persists
   `ecommerceConfig.openclawProvisioning`. Consumed by the wizard post-create
   panel (one auto-retry + manual button) and the detail chip (click = resync).
3. **Reconcile cron (new)** — `lib/openclaw/reconcile.ts`,
   `startOpenclawReconcileCron()` (10 min default, `OPENCLAW_RECONCILE_INTERVAL_MS`,
   `ENABLE_CRONS` kill-switch, wired in `index.ts` with graceful-shutdown clear).
   One pass = single `config.get` → merge (upsert all DB openclaw agents, drop
   orphan `aa-*`, keep system entries untouched) → single `config.patch` only if
   the list changed → `/v1/models` probe → persist status diffs.

## Key decisions

- **D1 — `/v1/models` as the liveness probe.** `config.get` proves intent, not
  service. The OpenAI-compat models listing is the cheapest signal that the
  gateway routes a target. Match is tolerant: `aa-<id>`, `openclaw/aa-<id>`, or
  any `*/aa-<id>` suffix. Fail-soft → `pending`.
- **D2 — drop the phantom `workspace`.** AA agents live off `systemPrompt` only
  (defined behavior); the merged upsert also deletes the legacy
  `workspace === "aa-<id>"` field from pre-existing entries. A real per-agent
  workspace template is a future change.
- **D3 — `setup.sh` emits the FULL list.** A node snippet reads the live
  `openclaw.json`, filters `aa-*` entries, and appends them to the static system
  entries before `openclaw config patch --stdin`. Robust regardless of the CLI's
  array-merge semantics; parse failure degrades to system-only list (the cron
  re-provisions within minutes).
- **D4 — reconcile is serialized with event syncs** through the same
  `provisioningQueue`, so a cron pass can never interleave with a create.
- **D5 — wizard runtime is explicit.** `AgentWizardForm.runtime`
  ("openclaw" default): cloud selectors render only for `runtime="openai"`,
  removing the dead controls; the POST sends the user's choice instead of a
  hardcoded value.

## File changes

- `back/src/lib/openclaw/admin-rpc.ts` — `listModels()` (GET `{chatBase}/models`).
- `back/src/lib/openclaw/provision.ts` — live probe in read-back; no `workspace`;
  `reconcileAgentsProvisioning()`.
- `back/src/lib/openclaw/reconcile.ts` — cron pass + starter (new file).
- `back/src/lib/agent/service.ts` — `buildProvisioningRecord`,
  `recheckOpenclawProvisioning`, create path reuses the record builder.
- `back/src/routes/agents.ts` — `POST /:id/openclaw/recheck`.
- `back/src/index.ts` — cron wiring + shutdown.
- `OpenClaw_Agents/setup.sh` — preserved-merge `agents.list` patch.
- `front/…` — 4-step wizard, runtime selector, post-create panel, draft
  persistence (sessionStorage), clickable provisioning chip.

## Data flow (create, happy path)

wizard POST /api/agents → createAgent (Prisma) → syncAgentProvisioning
→ config.get → upsert aa-<id> → config.patch(replacePaths=[agents.list])
→ read-back → /v1/models probe → persist openclawProvisioning
→ wizard PostCreatePanel (auto-recheck after 4 s if not provisioned).
