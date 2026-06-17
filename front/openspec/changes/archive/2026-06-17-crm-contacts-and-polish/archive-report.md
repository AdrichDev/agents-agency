# Archive Report: crm-contacts-and-polish (P11)

## Change Archived
- **Change**: `crm-contacts-and-polish`
- **Phase**: P11 (tasks.md header still reads "P10" — stale label; P10 belongs to knowledge-file-ingestion)
- **Level**: 4 (Critical)
- **Archived to**: `front/openspec/changes/archive/2026-06-17-crm-contacts-and-polish/`
- **Archived date**: 2026-06-17

## Outcome
All blocks A–E implemented and verified.

- **Bloque A** — Stats rework: `day` granularity, continuous zero-filled series (`enumeratePeriods`), toolbar filters, `periodFormat.ts`, response guard + UX (skeletons/empty states).
- **Bloque B** — Market study pro v2: geo anchoring, concreteness rules, verbatim catalog pricing, haversine radius post-filter, competitor email extraction, 10s scraper timeout, always-editable inputs, ProspectsAdjustPanel.
- **Bloque C** — Spain-2026 pricing synchronized across catalog/facturación/tarifas.
- **Bloque D** — CRM backend: `ContactType`/`ContactedStatus` enums, `ProspectContact` model (pc-NN code, soft-delete), `/api/contacts` router (CRUD + pending-count + convert-to-clients), enriched `/api/clients` (codCliente, direccion, hasInvoices), auto `ProspectContact` on Lead + admin notify via n8n webhook. Idempotent additive SQL `back/prisma/migrate-crm-contacts.sql`.
- **Bloque E** — Front CRM UI: clients table (invoice icon → `/facturacion?clientId`), `/contactos` page, Sidebar pending badge, favicon precedence fix (localStorage > DB > default).

## Verification Evidence
- **Back tests**: 368 passed (31 files), incl. `contacts.test.ts` (25), `lead-notifications.test.ts` (11), `codes.test.ts`, stats P7 regression.
- **Front typecheck**: clean (`tsc --noEmit`).
- **Front build**: OK — 16 routes incl. `/clientes`, `/contactos`, `/facturacion`.
- **DB**: already migrated via `db push` (verified read-only: `ProspectContact` table 22 rows, `Client.codCliente`+`direccion`, enums present, 0 codCliente null). SQL kept as reproducible artifact.

## Spec Merge
- **New**: `specs/crm.md` — CRM contacts + clients enrichment + front UI + favicon + service-catalog coherence (as-built contract, documents divergences from proposal).
- **Updated**: `specs/stats.md` — P11 Delta section (R-P11.1 day granularity, R-P11.2 period formatting/guard, R-P11.3 market study v2).

## As-built Divergences from Proposal
1. Enums named `ContactType`/`ContactedStatus` (not `ProspectType`/`ContactadoStatus`).
2. `contactado` default `no` (not `nc`).
3. `DELETE /api/contacts/:id` is a soft delete returning `{ ok: true }` (not hard delete / 204).
4. Admin notification via n8n webhook (`N8N_WEBHOOK_LEAD_URL`), not direct Gmail OAuth.
5. Added `convert-to-clients` capability and `peticion`/`codigo`/`deletedAt` fields not in the original task list.

## Notes
- Not committed: working tree changes remain uncommitted. Commit/push requires reviewer + human approval per project policy.
