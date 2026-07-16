# Tasks — aa-skills-executable-contract (F1)

- [x] T1 `prisma/schema.prisma`: add `Skill.toolsProvider` (`tools_provider`).
- [x] T2 `prisma/manual/migrate-skill-tools-provider.sql`: ALTER + one-time
      two-pass backfill of the legacy heuristic (name overrides, then `uso`).
- [x] T3 `src/lib/agent/skill-capabilities.ts`: explicit resolver, heuristics
      deleted, invalid-key fail-soft.
- [x] T4 `engine.ts` / `service.ts`: thread `toolsProvider` through the
      AgentSkill mappings.
- [x] T5 `src/routes/skills.ts`: `PATCH /:id/tools-provider` (curation, strict
      validation against TOOLS_BY_PROVIDER keys).
- [x] T6 Front: field-based `connectionBadgeLabel`, `Skill.toolsProvider` type;
      heuristic mirror deleted.
- [x] T7 Tests: rewrite `tests/skill-capabilities.test.ts` to the explicit
      contract + heuristic-regression cases.

## Final verification

- [ ] V1 `cd back && npm test && npm run typecheck`
- [ ] V2 `cd front && npm run typecheck`
- [ ] V3 Deploy order on the user machine: apply SQL migration →
      `npm run generate` → restart back. Then verify skillStatus of an existing
      agent is unchanged vs pre-change.

## Phase 2 (separate change)

- [ ] Executable MCP skills (mcpUrl metadata, MCP client, executor routing,
      per-agent allowlist/sandbox).
