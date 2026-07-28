# Validation — aa-skills-executable-contract (F1)

## User story

As the agency operator, when I attach a skill to an agent I want its faculty to
be an explicit, visible property of the skill — not an accident of its name —
so I can curate exactly what each agent can execute.

## Acceptance criteria

- AC1: A skill with `toolsProvider="calendar"` and a connected Google
  integration yields executable calendar tools in the agent loop; the same
  skill with `toolsProvider=null` contributes prompt text only.
- AC2: Renaming a skill or changing `use` never changes its executability.
- AC3: An invalid declared key (typo, retired provider) degrades to
  informational without breaking chat.
- AC4: The existing catalog keeps its pre-change faculties after the backfill
  migration (legacy heuristic applied once, in SQL).
- AC5: `PATCH /api/skills/:id/tools-provider` accepts a valid catalog key or
  null, rejects anything else with 400, 404 on unknown skill.

## Given-When-Then

**Scenario: explicit faculty (AC1/AC2)**
Given a skill named "Google Calendar Bot" with `toolsProvider=null`
When the agent responds to a user
Then the skill is informational and no calendar tools are exposed
And when the operator sets `toolsProvider="calendar"` via the PATCH endpoint
Then with Google connected the agent's tool list includes
`list_calendar_events` / `create_calendar_event`.

## Test per task

- T1 (contract): `tests/skill-capabilities.test.ts` — explicit-contract
  describe blocks, including the two heuristic-regression tests (name and `use`
  no longer decide) and the invalid-key fail-soft case.
- T2 (backfill): SQL reviewed by inspection; idempotent (`IF NOT EXISTS` +
  NULL-guarded updates). Manual check after applying: `SELECT nombre, uso,
  tools_provider FROM skill` matches the pre-change skillStatus.
- T3 (endpoint): validation covered by the shared zod/HttpError pattern; manual
  smoke via curl/dashboard.
- T4 (front): typecheck + wizard badge shows only for declared skills.
