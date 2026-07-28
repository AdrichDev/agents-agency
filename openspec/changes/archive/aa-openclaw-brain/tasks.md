# Tasks: OpenClaw as the Brain

## F0 — Spike (blocking, no product code)
- [x] F0-T1: Probe the running OpenClaw gateway: `POST :18790/v1/chat/completions`
  (auth = gateway token), model id format, streaming, tool/function-call support;
  multi-agent capability; programmatic config API. Document in `spike.md` and
  update proposal.md.
  - Test: AC1 (spike.md exists with verified answers, not assumptions). DONE
    03/07/2026 — auth fixed live (`gateway.auth mode token`), tools round-trip
    verified, multi-agent + config API documented. See spike.md §5 for two
    actionable findings (config drift + citas tools stripped by tools.profile).

## F1 — Local brain
- [x] F1-T1: Prisma: add `Agent.runtime String @default("openai")` (+ migration).
  - Test: typecheck + migration applies; existing rows default to "openai".
  - DONE 03/07/2026 — field added (`@map("motor")`), additive-only SQL at
    `back/prisma/migrate-agent-runtime.sql` (schema `aa.agente`, `ADD COLUMN
    IF NOT EXISTS ... DEFAULT 'openai'`, no DROP). `prisma generate` OK,
    `tsc --noEmit` OK. **Pending DB apply by the orchestrator** — this batch
    intentionally did NOT run the SQL against Supabase.
- [x] F1-T2: `openai.ts` → per-agent client factory: openclaw-runtime agents get
  `baseURL=OPENCLAW_BASE_URL`, `apiKey=OPENCLAW_GATEWAY_TOKEN`. **Updated per
  F0 spike (spike.md §2)**: `model` is an OpenClaw AGENT target
  (`OPENCLAW_AGENT_ID`, default `openclaw/default`), NOT `OPENCLAW_MODEL` /
  `ollama/llama3.1:8b` as this line originally said — the Ollama model is
  fixed in OpenClaw's own config, not per-request. `user`=conversationId
  passed for session continuity (spike.md §2). No `reasoning_effort`
  injection for this provider (fresh client instance, never patched).
  - Test: AC2 (E2E widget chat on local model) — factory unit-tested; full
    E2E through the widget against a live gateway is still pending (needs a
    running OpenClaw container, out of this apply batch's reach).
  - DONE 03/07/2026 — `getClientForAgent()` in `back/src/lib/openai.ts`;
    wired into `runToolLoop`/`runAgent` in `back/src/lib/agent/engine.ts`.
    `runtime="openai"` path byte-identical (same singleton, no model
    override, no `user` field).
  - **UPDATE 03/07/2026 (per-agent routing, closes the F1↔F2 gap flagged in
    F2-T1)**: `getClientForAgent()` now accepts an optional `agentId` and
    resolves the effective `model` with this precedence: (1)
    `OPENCLAW_AGENT_ID` env — optional GLOBAL override, wins if set (useful
    for the current single-agent gateway); (2)
    `openclaw/${openclawAgentId(agentId)}` (= `openclaw/aa-<agentId>`) —
    per-agent target derived from the same helper F2's `provision.ts` uses to
    build `agents.list[]` entries, so chat now targets the SAME OpenClaw
    agent that got provisioned; (3) `"openclaw/default"` — final fallback
    when no `agentId` is available. `engine.ts` (`runToolLoop`) now passes
    `agentId` through. Tests: `openai-agent-client.test.ts` (+3 — env
    override wins over per-agent, per-agent derived when no env, fallback
    when neither) and `engine.test.ts` (2 existing assertions updated to
    expect `agentId` forwarded and the per-agent model string). Full suite:
    506 passed / 3 skipped / 0 failed, 43/43 files, `tsc --noEmit` clean.
    Remaining unresolved (unchanged from F2-T1's note): `channels.telegram`
    is still believed single-bot-global (spike.md), so multi-tenant
    Telegram-via-OpenClaw routing is a separate, unverified concern from this
    chat-path fix.
- [x] F1-T3: Regression: `npm test`.
  - Test: AC3.
  - DONE 03/07/2026 — `back && npm test` (vitest): **478 passed / 3 skipped
    (Storage integration, skips by design without real creds) / 0 failed**,
    40/40 test files green. `scripts/test-conversations.ts` smoke NOT run
    (needs a live server + DB; out of this apply batch's reach — recommend
    running it manually before flipping a client-facing bot).

## F2 — Provisioning bridge
- [x] F2-T1: Sync service (`lib/openclaw/provision.ts`): create/update/delete of
  openclaw-runtime agents pushes persona + skills to OpenClaw (API per F0 spike).
  - Test: AC4 (bot answers on Telegram with panel-defined persona, zero manual steps).
  - DONE 03/07/2026 — `syncAgentProvisioning()` in `back/src/lib/openclaw/provision.ts`
    upserts/removes `agents.list[]` entries via the verified admin-http-rpc
    contract (`back/src/lib/openclaw/admin-rpc.ts`, `config.get` → mutate copy →
    `config.patch` with `replacePaths: ["agents.list"]`, spike.md §4 option B).
    Hooked into `createAgent`/`updateAgent`/`deleteAgent` in
    `back/src/lib/agent/service.ts`, AFTER the DB write, fire-and-forget
    (`.catch(logger.error)`) — never fails the HTTP request if OpenClaw is
    down, same fail-soft pattern as `lib/n8n/client.ts`. `runtime` was
    previously NOT exposed on the create/update Zod schemas (gap blocking
    AC4 end-to-end) — added `runtime: z.enum(["openai","openclaw"])` to both
    schemas in `back/src/routes/agents.ts` (additive, default `"openai"`,
    zero regression). **Known gap (documented, not solved here)**: config.patch
    can only write `identity.name` + `params.temperature` — the full
    systemPrompt/persona lives in OpenClaw's per-agent workspace file
    mechanism (spike.md §3), which is NOT automated by this service.
    ~~**Deviation flagged for the orchestrator**: `getClientForAgent()` (F1,
    `lib/openai.ts`) still targets a single global `OPENCLAW_AGENT_ID` env
    var for chat, NOT the per-agent id this service provisions
    (`openclaw/aa-<agentId>`) — F1 and F2 are inconsistent on multi-agent
    routing; must be reconciled before AC2/AC4 fully hold for >1 concurrent
    openclaw-runtime bot. NOT touched in this batch (F1 was marked
    DONE/frozen).~~ **RESOLVED 03/07/2026** — see the F1-T2 update note above:
    `getClientForAgent()` now derives the per-agent target by default, with
    `OPENCLAW_AGENT_ID` as an optional global override. Orchestrator-approved
    follow-up, applied after this task was first closed.
- [x] F2-T2: Channel handover: for openclaw-runtime agents, decrypt Telegram token,
  provision it in OpenClaw `channels.telegram`; mark `ChannelConnection` as
  openclaw-managed.
  - Test: AC4.
  - DONE 03/07/2026 — `provisionTelegramChannel()` in `provision.ts` decrypts
    the token with the existing AES-256-GCM helper (`lib/crypto.ts`) ONLY
    inside this function, never logs it (test asserts no log call ever
    contains the plaintext token), and sends it via `config.patch` to
    `channels.telegram.botToken`. `ChannelConnection` had no metadata column;
    added `metadata Json @default("{}")` (additive) — schema updated,
    **manual SQL at `back/prisma/migrate-channel-connection-metadata.sql`,
    NOT applied to Supabase** (pending orchestrator, same convention as
    F1-T1's `migrate-agent-runtime.sql`). `metadata.managedBy = "openclaw"`
    is set in the `POST /:provider/connect` upsert (`routes/channels.ts`) and
    surfaced in `GET /:agentId/status`.
- [x] F2-T3: Double-reply guard: skip `registerWebhook`/`deleteWebhook` accordingly;
  integration test asserts single reply per message.
  - Test: AC5.
  - DONE 03/07/2026 — in `routes/channels.ts` POST `/:provider/connect`
    (telegram branch): looks up `Agent.runtime` BEFORE deciding; if
    `"openclaw"`, skips `registerWebhook` entirely and instead calls
    `deleteWebhook(token)` (handover cleanup — covers the case a bot was
    previously webhook-managed under `runtime="openai"`), stores
    `webhookSecret: null`. `provisionTelegramChannel` is called exactly once
    per request, non-blocking. Integration test
    `back/tests/channels-openclaw-handover.test.ts` extracts the real route
    handler from `channelsRouter.stack` (same pattern as
    `market-study-iteration.test.ts`) and asserts: (a) no webhook registered
    for openclaw-managed connections, (b) existing webhook deleted on
    handover, (c) exactly one `provisionTelegramChannel` call per write, (d)
    admin-RPC failure never breaks the HTTP response (fail-soft).

## Quality gate (before flipping any client-facing bot)
- [~] **GATE-T1 — CERRADA POR OBSOLESCENCIA (28/07/2026), no por haber pasado.** El motivo, la
  evidencia y lo que sobrevive del gate están en la casilla gemela del final de este fichero (son
  el mismo gate escrito dos veces). Resumen: el modelo primario ya no es ninguno de los tres
  candidatos locales, no queda ningún bot en el runtime openclaw al que aplicar el gate, y el
  bloqueante de fecha que impedía re-evaluar está arreglado. Registro original íntegro debajo.
- GATE-T1 (IN PROGRESS — primer resultado 03/07/2026): candidato 1
  `sorc/qwen3.5-claude-4.6-opus-q4:9b` evaluado con 10 conversaciones read-only
  vía gateway (raw: `eval-01-sorc.json`). El criterio automático dio 10/10 pero
  la revisión manual lo tumba — NO PASA AC6 aún:
  - Fechas alucinadas ("hoy es sábado 4"/"miércoles 3"/"jueves 9" según convo)
    → falta grounding de fecha actual en el contexto del agente OpenClaw.
    PROBLEMA DE STACK, afecta a los 3 candidatos; arreglar antes de re-evaluar.
  - Fugas de internals al cliente (parámetros de tool, "formato YYYY-MM-DD",
    debug de la función, meta de archivos de contexto) → mitigable por prompt.
  - 1 respuesta sin sentido (convo 6).
  - Los slots sí salen de citas__disponibilidad (verificado en varias convos);
    métrica automática de tool-calls descartada (contaba ruido de logs).
  Fix aplicado 03/07/2026: `OpenClaw_Agents/openclaw_workspace_src/IDENTITY.md`
  (fuente de verdad, desplegada por setup.sh en cada restart) — regla 2b
  "weekday safety" (contar desde la fecha ISO, nunca afirmar el día de memoria,
  mostrar la fecha resultante al cliente) + regla 6 reforzada (lista negra de
  fugas de internals con ejemplos).
  Re-eval (raw: `eval-02-sorc-hardened.json`), revisión MANUAL:
  - ✅ Alucinación de día de semana RESUELTA: "viernes 3 de julio" repetido en
    2 conversaciones distintas — verificado correcto (2026-07-03 es viernes).
  - ⚠️ Fuga de internals REDUCIDA pero NO eliminada: sigue mencionando
    `` `stock_bajo` ``, "formato YYYY-MM-DD", "llamando a la herramienta sin
    parámetro", "la respuesta sigue vacía" (jerga de debug interno) en ~4/10
    turnos.
  - ⚠️ Convo 6: tabla de precios con placeholder "$XX.XX" — no inventa un
    precio concreto pero presenta una tabla con pinta de precio real; mala
    práctica, cerca de violar la regla 1 (no inventar precios) en espíritu.
  - 1 timeout de infraestructura (408) en convo 7 — no es fallo del modelo,
    pero cuenta como fallo en producción real.
  **VEREDICTO: NO PASA AC6 todavía.** El automatismo dio 9/10 pero es de nuevo
  optimista — el harness automático no detecta fugas de internals ni tablas
  con placeholders. Progreso real, no gate limpio. Next: 2ª vuelta de
  endurecimiento de persona (prohibir explícitamente nombrar tools/parámetros
  incluso en frases indirectas, prohibir mostrar precios sin dato real) +
  meter check de meta-leak en el harness antes de declarar visto bueno.
- [~] **GATE-T1 (duplicada de la de arriba) — SUPERADA TAL COMO ESTÁ ESCRITA (28/07/2026).**
  Esta casilla y la anterior son el MISMO gate escrito dos veces. Se cierran juntas porque su
  premisa ya no existe. Verificado contra el código y contra producción:
  - **La lista de candidatos es papel mojado.** Pregunta cuál de tres modelos LOCALES de Ollama
    pasa y se convierte en el default. La decisión se tomó en otro sitio y fue *ninguno*:
    `OpenClaw_Agents/setup.sh:17` fija `primary: "google/gemini-3.1-flash-lite"` —un modelo
    alojado, que no está en la lista— y deja `ollama/llama3.1:8b` sólo como *fallback*.
  - **No hay ningún bot al que aplicarle el gate.** El gate dice «before flipping any
    client-facing bot». Consultado producción: los **11 agentes tienen `motor = "openai"`**
    (10 draft, 1 published). **Cero en el runtime openclaw.**
  - **El bloqueante que paró la re-evaluación está resuelto.** La primera vuelta lo llamó
    «PROBLEMA DE STACK, afecta a los 3 candidatos; arreglar antes de re-evaluar»: el agente
    alucinaba el día porque no tenía forma de saber la fecha. Hoy `plataforma__fecha_hoy` está en
    el allowlist GLOBAL (`setup.sh:102`), que es la base de `inheritedTools` de los subagentes —
    o sea que también lo hereda el recepcionista, que era el «pendiente» anotado en
    `aa-operator-agent` F2-T1.
  - **Lo que SIGUE vivo y no se marca como hecho**: la barra de calidad en sí (AC6, cero slots y
    cero precios inventados) NUNCA se ha verificado sobre el modelo que de verdad está
    configurado. Si algún día se pasa un bot de cliente a openclaw, hay que re-evaluar **contra
    Gemini**, no contra los tres candidatos muertos, y arrastrando el hallazgo de la 2ª vuelta:
    9/10 con placeholders de precio («$XX.XX»), que es justo lo que AC6 prohíbe.
  - Texto original conservado abajo por trazabilidad.
- ~~GATE-T1: Eval — ≥10 scripted booking conversations. Candidates in order
  (Adrian, 2026-07-02): (1) `ollama/sorc/qwen3.5-claude-4.6-opus-q4:9b` — community
  distill, declared tools+thinking support, no benchmarks; (2) `ollama/qwen3:8b` —
  known empty replies / wrong tool choice (OpenClaw_Agents changes/05-bot-skills);
  (3) `ollama/llama3.1:8b` — proven fallback. Mitigations before discarding a
  candidate: prompt-side tool schemas, `thinkingDefault: off`, temperature ≤0.3,
  re-pull latest build. 0 invented slots/prices required to pass.
  - Test: AC6. First candidate to pass becomes `OPENCLAW_MODEL` default.~~

## F3 — Telemetry (deferred, separate change)
- Mirror OpenClaw conversations into `Conversation`/`Lead`. Not tasked here.

## Cierre (28/07/2026)

Se archiva con **cero casillas abiertas**, pero conviene ser exacto en el porqué: F1/F2 se
construyeron y el GATE-T1 **no se aprobó, se quedó sin objeto**.

Lo verificado hoy, contra código y producción:
- `OpenClaw_Agents/setup.sh:17` → primario `google/gemini-3.1-flash-lite`, ninguno de los tres
  candidatos locales que el gate iba a comparar. `ollama/llama3.1:8b` sobrevive como fallback.
- Producción: **11 agentes, los 11 con `motor = "openai"`** (10 draft, 1 published). Cero en el
  runtime openclaw, o sea ningún bot de cliente al que aplicar el gate.
- El bloqueante de la 1ª vuelta (fechas alucinadas) está resuelto en el stack:
  `plataforma__fecha_hoy` en el allowlist global (`setup.sh:102`), heredado por los subagentes.

**Deuda que se lleva consigo, y que NO está cerrada**: AC6 (cero slots y cero precios inventados)
nunca se ha comprobado sobre el modelo realmente configurado. La 2ª vuelta se quedó en 9/10 por
placeholders de precio. Si alguna vez se pasa un bot de cliente a openclaw, hay que re-evaluar
contra Gemini **antes** de exponerlo, y esa evaluación merece su propia change.
