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

- [x] V1 `cd back && npm test && npm run typecheck` — verificado 28/07/2026: 146 ficheros, 1723 tests en verde (3 skipped), `tsc --noEmit` exit 0. Incluye `back/tests/skill-capabilities.test.ts`.
- [x] V2 `cd front && npm run typecheck` — verificado 28/07/2026: `tsc --noEmit` exit 0.
- [x] V3 Deploy order on the user machine: apply SQL migration → — verificado en producción 28/07/2026: `aa.skill.tools_provider` existe (text, nullable) y el backfill de dos pases corrió — 0 filas que la heurística legada habría rellenado siguen a NULL. Los 107 NULL de 108 son legítimos: sus `uso` son categorías de catálogo (`DESARROLLO`, `IA`, `BÚSQUEDA`…) que no mapean a ninguna facultad ejecutable. NO comprobado: la comparación literal del `skillStatus` de un agente contra su estado anterior al cambio, porque ese estado previo ya no existe en ningún sitio; la evidencia del backfill es lo más cercano que se puede obtener hoy.
      `npm run generate` → restart back. Then verify skillStatus of an existing
      agent is unchanged vs pre-change.

## Phase 2 (separate change)

- [ ] Executable MCP skills (mcpUrl metadata, MCP client, executor routing, — deuda fuera de alcance por decisión del propio documento ("Phase 2, separate change"). Ya está construida en el cambio `aa-agent-skills-install-execute`: migración `20260716160000_skill_mcp`, cliente `back/src/lib/mcp/client.ts:63` (kill switch `MCP_SKILLS_ENABLED`) y `:74` (allowlist `MCP_SKILL_ALLOWED_HOSTS`), descubrimiento en `back/src/lib/agent/engine.ts:214`, enrutado en `back/src/lib/agent/executor.ts:382`.
      per-agent allowlist/sandbox).

## Cierre — 28/07/2026

Cierre completo. **Corrección al cierre original de esta misma fecha**: se anotaron tres acciones humanas pendientes (V1, V2, V3). Ninguna lo era. V1 y V2 son ejecutar la suite y el typecheck, ejecutados y verdes. V3 daba por hecho que la migración manual seguía sin aplicar; la base de datos de producción demuestra lo contrario. La Phase 2 que el documento dejó fuera ya se construyó en otro cambio.

Lo único que sobrevive de aquel aviso es un riesgo de proceso, y es más amplio de lo que decía: `back/prisma/manual/` contiene **19 ficheros SQL**, no uno. `prisma migrate status` no cubre ninguno, así que ninguna de esas migraciones avisará de que falta. Eso es el patrón del proyecto, no un descuido de este cambio, y resolverlo (traer los 19 al historial de Prisma) es trabajo aparte con gate humano.
