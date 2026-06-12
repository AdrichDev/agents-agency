# Archive

Completed SDD change folders. Archive date: 2026-06-12

---

## Archived Changes (5 phases completed)

| Phase | Change | Folder | Observation IDs | Build Status |
|---|---|---|---|---|
| P1 | telegram-whatsapp-bots | `2026-06-12-telegram-whatsapp-bots/` | Engram ID 78 | ✅ 51/51 tests |
| P2 | oauth-integrations | `2026-06-12-oauth-integrations/` | Engram ID 79 | ✅ 78 tests |
| P3 | n8n-automations | `2026-06-12-n8n-automations/` | Engram ID 80 | ✅ 100/100 tests |
| P4 | skills-execution-flow | `2026-06-12-skills-execution-flow/` | Engram ID 81 | ✅ 128 total tests |
| P5 | ecommerce-flow-improvements | `2026-06-12-ecommerce-flow-improvements/` | Engram ID 82 | ✅ All green |

---

## Archive Structure

Each change folder contains:
- `proposal.md` — original proposal
- `spec.md` — specification (reference to merged specs or archived version)
- `design.md` — design decisions (archived)
- `tasks.md` — task log (archived, all tasks completed ✅)

---

## Merged Specs

All change specifications have been merged into consolidated domain specs:

- `front/openspec/specs/channels.md` — P1
- `front/openspec/specs/integrations.md` — P2
- `front/openspec/specs/automations.md` — P3
- `front/openspec/specs/skills.md` — P4
- `front/openspec/specs/ecommerce.md` — P5

These are the source of truth for each capability going forward.

---

## Known Technical Debt

| Priority | Phase | Task | Link |
|---|---|---|---|
| P3 | P1 | Playwright e2e for channel connection | specs/channels.md |
| P3 | P2 | Supertest for /execute endpoint auth | specs/integrations.md |
| P3 | P3 | runAutomation unit test + Supertest /execute | specs/automations.md |
| P4 | P4 | Playwright for skills panel state | specs/skills.md |
| P5 | P5 | Playwright for ecommerce config & leads panel | specs/ecommerce.md |

---

## Critical Fixes Applied

- **GET /api/agents/:id**: Must NOT expose ecommerceConfig.apiKey in plain. (Fixed ✅)
- **syncStatus logic**: Only `schedule` triggers marked "synced"; `new_email`/`new_slack_message` fallback to cron. (Verified ✅)
- **Cron skip validation**: Logic correct; deferred test coverage acceptable. (Verified ✅)

---

## Traceability

All archive reports saved to Engram with observation IDs for historical audit trail. Each report includes:
- What was archived (summary of work)
- Why (rationale, dependencies)
- Where (affected files/paths)
- Learned (patterns, decisions, gotchas)

Access archive reports via: `mem_search("sdd/{change-name}/archive-report", project="agents-agency")`
