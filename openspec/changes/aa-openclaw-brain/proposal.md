# Proposal: OpenClaw as the Brain — agents-agency as Control Plane

## Intent
Today the two stacks are disconnected: agents-agency runs its own agent engine on
OpenAI/Gemini cloud APIs (`back/src/lib/openai.ts`), while the OpenClaw stack
(`OpenClaw_Agents` repo) runs a local LLM (Ollama, `llama3.1:8b`) with its own
Telegram bot. Goal: **bots are created and managed in agents-agency, but OpenClaw
is the runtime brain** — local LLM, 24/7 execution, channels owned by OpenClaw.

## Architecture decision
- **agents-agency = control plane.** Creation wizard, persona (systemPrompt),
  channel credentials, knowledge, stats, tenants. Source of truth for bot config.
- **OpenClaw = data plane / brain.** Executes conversations with the local model,
  owns the messaging channels of OpenClaw-backed bots, calls business tools (n8n MCP).
- Per-agent opt-in via new `Agent.runtime` field (`"openai" | "openclaw"`,
  default `"openai"`). Existing bots untouched; zero regression risk.

## Phases
- **F0 — Spike (blocking):** verify against the running gateway: (a) OpenAI-compat
  `chat/completions` endpoint contract (`setup.sh` already enables it), auth with
  `OPENCLAW_GATEWAY_TOKEN`, model id format; (b) whether OpenClaw supports multiple
  isolated agents (persona per bot) or one shared agent per gateway; (c) config API
  for programmatic provisioning (equivalent of `openclaw config patch` over HTTP).
  Spike output updates this spec before F2 is coded.
- **F1 — Local brain (minimal risk):** for `runtime="openclaw"` agents, the existing
  engine (`runToolLoop`) keeps orchestrating but the OpenAI client points to the
  OpenClaw gateway (`OPENCLAW_BASE_URL`, default `http://localhost:18790/v1`,
  apiKey = gateway token). **Updated per F0 spike (03/07/2026, see spike.md):**
  the `model` field is an OpenClaw AGENT target (`openclaw/<agentId>`, from
  `OPENCLAW_AGENT_ID`, default `openclaw/default`) — the underlying Ollama model
  is set in OpenClaw's own config (live: `agents.defaults.model.primary =
  ollama/llama3.1:8b`), not per-request. `tools` passthrough verified working.
  Client factory in `openai.ts` becomes per-agent instead of global singleton.
- **F2 — Provisioning bridge:** on create/update/delete of an openclaw-runtime agent,
  back syncs to OpenClaw: persona (systemPrompt → agent identity/workspace), Telegram
  token (decrypted from `ChannelConnection.credentials` server-side, sent only over
  localhost/Docker network), enabled skills. **Ownership rule:** when OpenClaw owns a
  bot's Telegram channel, agents-agency MUST NOT register its own webhook for that
  token (double-reply hazard) — `registerWebhook` is skipped and the connection is
  marked `managedBy: "openclaw"`.
- **F3 — Telemetry back (optional, later):** OpenClaw conversations mirrored into
  agents-agency `Conversation`/`Lead` tables so the dashboard stays the single pane.

## Risks (devil's advocate)
- **8B quality gate:** `qwen3:8b` has a KNOWN failure history in this exact stack
  (empty replies, wrong tool choice — OpenClaw_Agents change 05). It must pass the
  eval set (booking flow, tool choice, no hallucinated slots) BEFORE any
  client-facing bot flips to `runtime="openclaw"`. Mitigations first (thinking off,
  low temperature, prompt-side tool schemas, re-pull latest build); if it still
  fails, swap `OPENCLAW_MODEL` / `setup.sh` to `ollama/llama3.1:8b` — one line.
- **Double reply:** enforced by the ownership rule + test in validation.md.
- **Secrets:** Telegram tokens are AES-256-GCM at rest; decrypt only in the sync
  service; never log; gateway reachable only on localhost.
- **Two n8n instances** (5678 aa / 5680 openclaw) stay separate — unification out of scope.

## Out of Scope
- WhatsApp and voice channels (pending cost decision — OpenClaw_Agents change 04 T3).
- Migrating existing OpenAI-runtime bots.
- n8n unification.

## Level
4 (Critical) — crosses 2 repos and 3+ domains, new architecture, touches security
(tokens) and client-facing production behavior. **Human approval required before
any code. F0 spike gates F1/F2.**
