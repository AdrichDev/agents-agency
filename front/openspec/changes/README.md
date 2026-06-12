# changes/

Active change folders live here during SDD phases. Completed changes are archived via `sdd-archive`.

Structure: `changes/{change-name}/` → proposal.md, spec.md, design.md, tasks.md

Completed changes move to: `changes/archive/YYYY-MM-DD-{change-name}/`

---

## Active Changes

Currently no active changes. All P6-P9 completed and archived.

---

## Archived Changes (2026-06-12)

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
