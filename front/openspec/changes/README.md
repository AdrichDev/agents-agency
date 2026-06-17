# changes/

Active change folders live here during SDD phases. Completed changes are archived via `sdd-archive`.

Structure: `changes/{change-name}/` → proposal.md, spec.md, design.md, tasks.md

Completed changes move to: `changes/archive/YYYY-MM-DD-{change-name}/`

---

## Active Changes

Currently no active changes. P1-P11 completed and archived.

---

> **2026-06-17 archive sweep**: 26 leftover change folders that lived under
> `changes/` (completed but never archived, or working copies of already-archived
> phases) were swept into `archive/2026-06-17-<name>/` to clean the active tree.
> For 9 of them an earlier dated twin already existed (P1-P9/P10); the 06-17 copy
> is the richer leftover and is kept alongside the original (no data lost).
> `stats-dashboard` was identical to its 2026-06-12 twin and was removed.

## Archived Changes (2026-06-12, 2026-06-16)

| Cambio | Fase | Archived | Descripción |
|---|---|---|---|
| [archive/2026-06-12-telegram-whatsapp-bots](./archive/2026-06-12-telegram-whatsapp-bots/) | P1 | 2026-06-12 | Desplegar agentes como bots reales de Telegram (token @BotFather + webhook) y WhatsApp (Meta Cloud API), con `ChannelConnection` y credenciales cifradas AES-256-GCM. |
| [archive/2026-06-12-oauth-integrations](./archive/2026-06-12-oauth-integrations/) | P2 | 2026-06-12 | Conexiones OAuth reales (Google unificado Calendar+Gmail, Slack, Notion; Jira/Instagram fase posterior), tokens cifrados, refresh automático y mapeo SERVICES → conexiones. |
| [archive/2026-06-12-n8n-automations](./archive/2026-06-12-n8n-automations/) | P3 | 2026-06-12 | Materializar automatizaciones como workflows reales en n8n (cliente REST, trigger schedule/webhook → HTTP Request a `/api/automations/:id/execute`), con `n8nWorkflowId` y ciclo de vida create/toggle/delete. |
| [archive/2026-06-12-skills-execution-flow](./archive/2026-06-12-skills-execution-flow/) | P4 | 2026-06-12 | Skills asignadas ejecutables E2E: catálogo skill→tools sobre TOOLS_BY_PROVIDER + getValidToken; caso canónico booking de cita en Google Calendar desde widget/telegram/whatsapp. |
| [archive/2026-06-12-ecommerce-flow-improvements](./archive/2026-06-12-ecommerce-flow-improvements/) | P5 | 2026-06-12 | Mejoras de flujo ecommerce: recomendación vía RAG, FAQ con fuentes, lead con intención, handoff a humano, estado de pedido (placeholder API externa). Depende de P4. |
| [archive/2026-06-12-landing-builder](./archive/2026-06-12-landing-builder/) | P6 | 2026-06-12 | Vibe coding conversacional: decálogo (~10 preguntas con DEFAULT_MODEL) → prompt master (skill) → generación multi-archivo responsive (STRONG_MODEL) → editor Monaco + preview iframe + scaffold app móvil (Expo/Flutter) + descarga zip. Modelo `LandingProject`. Deps: `@monaco-editor/react`, `jszip`. |
| [archive/2026-06-12-stats-dashboard](./archive/2026-06-12-stats-dashboard/) | P7 | 2026-06-12 | Dashboard agregado: KPIs y gráficos interactivos (recharts). `GET /api/stats` sin filtros = baseline P7. Tarjetas, series mensuales, facturación por mes/estado, top agentes. Dep: `recharts`. *Nota: spec/design no incluidos en this change (missing artifact).* |
| [archive/2026-06-12-interactive-stats-market-studies](./archive/2026-06-12-interactive-stats-market-studies/) | P8 | 2026-06-12 | Estadísticas paramétricas (granularidad/rango/filtros/drill-down, retrocompatible) + Estudios de mercado IA (STRONG_MODEL, secciones editables, regeneración, prospectos Google Places, CSV). Modelo `MarketStudy`. |
| [archive/2026-06-12-market-study-pro](./archive/2026-06-12-market-study-pro/) | P9 | 2026-06-12 | Prospección ampliada (todos los comercios + chatbot detection, opportunity scoring), competidores Places + scrape, success scoring, acción plan + opciones recomendadas, tablas profesionales con badges/stars/filtros. |
| [archive/2026-06-16-knowledge-file-ingestion](./archive/2026-06-16-knowledge-file-ingestion/) | P10 | 2026-06-16 | Agent RAG knowledge base ingestion via file/zip upload. Multipart endpoint `POST /api/knowledge/:agentId/files` with multer memoryStorage. Supported formats: PDF, DOCX, TXT, MD, HTML, CSV. Zip safety limits (50MB uncompressed, 200 entries). Duplicate policy (ask/overwrite/suffix). File parser module with per-extension dispatch. Frontend upload UI with per-file progress. Tests: 16/16 passing (phases 1-5 complete, phase 6 manual verification deferred non-blocking). |
| [archive/2026-06-17-crm-contacts-and-polish](./archive/2026-06-17-crm-contacts-and-polish/) | P11 | 2026-06-17 | Stats rework (day granularity, continuous zero-filled series, toolbar filters, periodFormat). Market study pro v2 (geo anchoring, haversine radius post-filter, competitor emails, scraper timeout). Spain-2026 pricing. CRM: `ContactType`/`ContactedStatus` enums, `ProspectContact` (pc-NN code, soft-delete), `/api/contacts` (CRUD + pending-count + convert-to-clients), enriched `/api/clients` (codCliente, direccion, hasInvoices), auto `ProspectContact` on Lead + admin notify via n8n webhook. Front: clients table (invoice icon → `/facturacion?clientId`), `/contactos` page, Sidebar pending badge, favicon precedence fix. Idempotent additive SQL `migrate-crm-contacts.sql`; DB already migrated. Merged into `specs/crm.md` + `specs/stats.md` (P11 delta). 368 back tests green, front typecheck + build clean. |
