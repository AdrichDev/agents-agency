# Proposal — aa-openclaw-provision-hardening

## Intent

Guarantee that every agent created in Agents Agency with `runtime="openclaw"` is
reliably reflected in OpenClaw (config entry present, gateway actually serving it),
and simplify the agent-creation wizard so the UX matches what the system really does.

## Problems addressed

1. **`pendingRestart` never resolves.** `syncAgentProvisioning` patches `agents.list`
   but the gateway needs a restart to serve the agent; nothing re-checks or repairs.
2. **`setup.sh` wipes platform agents on every container start.** The static
   `agents.list` patch (main/citas/openclaw) did not preserve `aa-*` entries.
3. **No reconciliation.** Event hooks (create/update/delete) are fail-soft; when the
   gateway is down at event time, DB and OpenClaw diverge silently (stuck `failed`
   agents, orphan `aa-*` entries).
4. **Phantom workspace.** `buildAgentEntry` set `workspace: "aa-<id>"`, a relative
   path never created nor deployed → undefined behavior.
5. **Wizard shows dead controls.** `runtime` was hardcoded to `"openclaw"` while the
   Personalidad step offered provider/model/effort selectors that were fully ignored.
6. **No post-create feedback.** The wizard redirected blindly; the provisioning chip
   was a frozen snapshot with no retry.

## Scope

- `back/src/lib/openclaw/{admin-rpc,provision,reconcile}.ts`
- `back/src/lib/agent/service.ts`, `back/src/routes/agents.ts`, `back/src/index.ts`
- `OpenClaw_Agents/setup.sh`
- `front` wizard (4 steps, explicit runtime selector, post-create panel, draft
  persistence) and agent-detail provisioning chip (click to re-sync).

## Risks

- `openclaw config patch` array-merge semantics on container start: mitigated by
  always emitting the FULL final list (system + preserved `aa-*`) in one patch.
- `/v1/models` as the liveness probe assumes the gateway lists agent targets there;
  fail-soft to `pending` if the endpoint is unavailable (needs live verification).
- Reconcile cron writes `ecommerceConfig.openclawProvisioning` only on status change
  to avoid row churn.

## Dependencies

- OpenClaw admin-http-rpc plugin enabled (already required by aa-openclaw-brain F2).
- `OPENCLAW_BASE_URL` / `OPENCLAW_GATEWAY_PASSWORD|TOKEN` envs (unchanged).
