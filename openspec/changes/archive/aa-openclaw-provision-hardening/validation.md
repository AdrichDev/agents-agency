# Validation — aa-openclaw-provision-hardening

## User story

As the agency operator, when I create an agent in the wizard I want it to actually
exist and answer through OpenClaw — surviving gateway restarts — and I want the UI
to tell me the truth about that state and let me repair it with one click.

## Acceptance criteria

- AC1: A created `runtime="openclaw"` agent produces an `aa-<id>` entry in the live
  `agents.list` and its persisted status reflects gateway serving state
  (`provisioned` only when `/v1/models` lists the target).
- AC2: Restarting the OpenClaw container preserves all `aa-*` entries.
- AC3: If the gateway is down at create/delete time, the reconcile cron converges
  DB ↔ OpenClaw (missing entries re-provisioned, orphans removed) within one tick.
- AC4: `POST /api/agents/:id/openclaw/recheck` re-syncs and returns the fresh state;
  wizard post-create panel and detail chip consume it.
- AC5: The wizard has 4 steps, an explicit runtime selector (model/effort only shown
  for cloud runtime), and the form survives a page reload (sessionStorage draft).

## Given-When-Then

**Scenario: liveness-based provisioning state (AC1)**
Given the admin RPC accepts the `agents.list` patch for agent `a1`
And `/v1/models` does not yet list `openclaw/aa-a1`
When `syncAgentProvisioning({id:"a1", runtime:"openclaw", ...})` runs
Then the result is `provisionState="pending"`, `pendingRestart=true`
And when `/v1/models` later lists the target, a recheck yields
`provisionState="provisioned"`, `pendingRestart=false`.

## Test per task

- T1 (provision hardening): `back/tests/openclaw-provision.test.ts` — live-probe
  describe block (provisioned vs pending) + no-phantom-workspace assertions.
- T2 (reconciliation): same file — `reconcileAgentsProvisioning` describe block
  (orphan removal, missing upsert, idempotent no-patch, config.get failure).
- T3 (recheck endpoint/service): covered via provision live-probe tests + existing
  `agent-create-openclaw.test.ts` (unchanged contract, still green).
- T4 (setup.sh preservation): shell/node merge is exercised manually on next
  container start (log line "agents.list: N del sistema + M aa-* preservadas");
  no CI harness exists for the OpenClaw repo scripts.
- T5 (wizard): `front` typecheck + existing e2e flows; manual pass of the 4-step
  wizard and post-create panel.
