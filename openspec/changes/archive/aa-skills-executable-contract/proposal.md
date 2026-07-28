# Proposal — aa-skills-executable-contract (F1)

## Intent

Make a skill's faculty EXPLICIT: a skill grants executable tools to an agent if
and only if it declares which tools provider it maps to. Kill the legacy
heuristics (Skill.use → provider map + name-substring overrides) that decided
capabilities by text matching.

## Problems addressed

1. **Text decides faculties.** Renaming a skill ("Agenda" → "Google Calendar
   Bot") silently changed what the agent could execute. `use` was doing double
   duty as both a UI catalog label and a capability switch.
2. **Marketplace skills can never be executable.** Scraped GitHub/MCP skills
   carry `tools Json` descriptors but nothing maps them to the executor, and the
   heuristic only knew 5 hardcoded provider families.
3. **Front/back heuristic drift.** `front/lib/skill-capabilities.ts` was a
   hand-maintained mirror of the back heuristic (already diverged: it lacked
   the ecommerce entries).

## Scope (Phase 1)

- `Skill.toolsProvider` column (`tools_provider`): key of `TOOLS_BY_PROVIDER`
  (`gmail|slack|calendar|notion|ecommerce`) or NULL = informational.
- One-time backfill migration replicating the legacy heuristic, so the current
  catalog keeps its exact faculties (`prisma/manual/migrate-skill-tools-provider.sql`).
- Back: `logicalProviderForSkill` reads the declared field (invalid key →
  informational, fail-soft). Heuristic tables deleted.
- Curation endpoint: `PATCH /api/skills/:id/tools-provider`.
- Front: badge reads `skill.toolsProvider` from the API; mirror heuristic deleted.

## Out of scope (Phase 2 — planned)

- Executable MCP skills: register a vetted MCP server per skill
  (`mcpUrl`/transport metadata), mount its tools into the engine's tool list,
  execute via an MCP client in the executor, with per-agent allowlist and
  sandboxing. Scraped skills stay informational until then.

## Risks

- Deploy requires DB migration + `prisma generate` BEFORE the new code runs;
  until regeneration, `toolsProvider` reads as undefined → all skills degrade
  to informational (safe, but silently disables skill tools). Run the SQL first.
- Any external consumer relying on name-based capability inference breaks by
  design; curation via the PATCH endpoint is the replacement.
