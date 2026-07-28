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

- [ ] V1 `cd back && npm test && npm run typecheck` — ⏳ GATE HUMANO: ejecutar `npm test` y `npm run typecheck` en back. El test reescrito existe: `back/tests/skill-capabilities.test.ts`.
- [ ] V2 `cd front && npm run typecheck` — ⏳ GATE HUMANO: ejecutar `npm run typecheck` en front
- [ ] V3 Deploy order on the user machine: apply SQL migration → — ⏳ GATE HUMANO: orden de despliegue en la máquina del propietario: aplicar `back/prisma/manual/migrate-skill-tools-provider.sql`, luego `npm run generate`, reiniciar el backend y comparar el `skillStatus` de un agente existente con su estado previo. AVISO: ese SQL vive FUERA de `prisma/migrations`, así que `migrate status` no lo cubre y no avisará de que falta.
      `npm run generate` → restart back. Then verify skillStatus of an existing
      agent is unchanged vs pre-change.

## Phase 2 (separate change)

- [ ] Executable MCP skills (mcpUrl metadata, MCP client, executor routing, — deuda fuera de alcance por decisión del propio documento ("Phase 2, separate change"). Ya está construida en el cambio `aa-agent-skills-install-execute`: migración `20260716160000_skill_mcp`, cliente `back/src/lib/mcp/client.ts:63` (kill switch `MCP_SKILLS_ENABLED`) y `:74` (allowlist `MCP_SKILL_ALLOWED_HOSTS`), descubrimiento en `back/src/lib/agent/engine.ts:214`, enrutado en `back/src/lib/agent/executor.ts:382`.
      per-agent allowlist/sandbox).

## Cierre — 28/07/2026

Cierre con tres acciones humanas pendientes, todas de ejecución o despliegue, y una Phase 2 que el propio documento dejó fuera y que ya se construyó en otro cambio. AVISO IMPORTANTE: la migración de este cambio es un SQL manual fuera de `prisma/migrations`; `migrate status` no la cubre, así que si no se aplica a mano nadie lo detectará.
