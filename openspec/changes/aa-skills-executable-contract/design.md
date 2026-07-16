# Design — aa-skills-executable-contract (F1)

## Model

`Skill.toolsProvider: String?` (`skill.tools_provider`) is the single source of
truth for a skill's faculty:

- key of `TOOLS_BY_PROVIDER` → executable family (gmail, slack, calendar,
  notion, ecommerce); the executor already implements these tools.
- NULL or unknown key → informational (prompt-only). Unknown keys are treated
  as NULL at read time (fail-soft) so bad metadata can never break chat.

`Skill.use` returns to being a pure catalog label for UI filters.

## Key decisions

- **D1 — declaration over inference.** Capability is data, not a parsing rule.
  This is the prerequisite for Phase 2 (MCP skills): an MCP skill will declare
  its server the same way instead of being pattern-matched.
- **D2 — backfill in SQL, heuristic deleted from code.** The legacy inference
  runs exactly once (migration) to preserve current behavior; keeping it in
  code as a fallback would reintroduce the split-brain.
- **D3 — validation at the edge, tolerance at the core.** The PATCH endpoint
  rejects unknown keys (400); the capability resolver tolerates them (→
  informational). Writes are strict, reads are safe.
- **D4 — front consumes, never infers.** The badge uses the `toolsProvider`
  field served by GET /api/skills; the front heuristic mirror is gone.

## File changes

- `prisma/schema.prisma` — `toolsProvider` on Skill.
- `prisma/manual/migrate-skill-tools-provider.sql` — ALTER + two-pass backfill
  (name overrides first, then `uso` map — same precedence as the old code).
- `src/lib/agent/skill-capabilities.ts` — explicit resolver; heuristics removed;
  `SkillInput.toolsProvider`.
- `src/lib/agent/engine.ts`, `src/lib/agent/service.ts` — pass `toolsProvider`
  through the AgentSkill mappings.
- `src/routes/skills.ts` — `PATCH /:id/tools-provider` (curation).
- `front/lib/skill-capabilities.ts`, `front/components/agent-wizard/types.ts` —
  field-based badge.

## Phase 2 sketch (not implemented)

`Skill.mcpUrl` + transport metadata; back-side MCP client pool (vetted
allowlist, timeouts, no credentials passthrough); engine merges MCP tool
schemas into `buildAgentTools`; executor routes `mcp__*` calls to the client;
per-agent tool allowlist persisted on AgentSkill.

## Deploy order

1. Apply `migrate-skill-tools-provider.sql` (or `prisma migrate dev`).
2. `npm run generate` (regenerate Prisma client).
3. Deploy code. (Reversed order degrades safely: all skills read as
   informational until 1–2 complete.)
