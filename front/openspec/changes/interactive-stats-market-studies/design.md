# Design: Estadísticas Interactivas + Estudios de Mercado IA (P8)

## Technical Approach

Two slices over the existing Express + Prisma + Next backend. **Slice A** extends
`back/src/lib/stats.ts` from a fixed 12-month aggregator into a parametrized,
backward-compatible one: `getStats(query?)`. **Slice B** adds an isolated
`back/src/lib/market-study/` module (LLM generation + Google Places client), a
new `MarketStudy` Prisma model with manual SQL migration, and a dedicated
`back/src/routes/market-studies.ts` Express `Router` mounted in `index.ts`.
Front gets tabs in `/estadisticas`, a filter toolbar, a drill-down panel, and a
studies sub-view. No new npm dependencies (recharts already present; markdown
rendered with a tiny in-house converter).

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Stats signature | `getStats(query?: StatsQuery)`, no-arg path byte-identical to P7 | New parallel fn | Single source, regression snapshot guards P7 |
| Granularity in SQL | Zod enum `year\|month\|week` → switch maps to literal `date_trunc` unit; NEVER interpolate user input | String-concat the unit | SQL injection guard; whitelist before query |
| Filters | Prisma `$queryRaw` with `Prisma.sql` fragments composed from validated params | Raw concatenation | Parametrized binds; null filter = fragment omitted |
| "Product" dimension | `BudgetLine.serviceId` + impl/maint revenue type; `Client.sector` segment | New `Product` model | Uses already-persisted dimension; zero migration on budgets |
| SERVICE_CATALOG | Duplicate as `back/src/lib/service-catalog.ts` const | Shared cross-package import | Front/back are separate packages; least invasive, no build coupling |
| Study persistence | Single `MarketStudy` model, `sections`/`prospects` as `Json` | Normalized section/prospect tables | Granular edit/regen without joins; trivial rollback (drop table) |
| Routing | Express `Router` (mirrors `channelsRouter`/`landingRouter`) | Inline handlers in `index.ts` | Keeps 1000+-line index.ts from growing; established pattern |
| Markdown render | In-house `renderMarkdown()` (headers/bold/lists → HTML) | Add react-markdown | No heavy dep; sections are short; preview is non-critical |
| Places ToS | Official Places API (Text Search + Details) only, behind `isConfigured()` | Scraping Google | ToS-safe; degraded mode without key |

## Data Flow

### Stats (A)

    Front StatsFilters ──query string──▶ GET /api/stats?period&granularity&range&from&to&clientId&serviceId&agentId&status&sector
         │                                      │
         │                              zod parse + defaults (StatsQuery)
         │                                      │
         │                              getStats(query) ── date_trunc(unit) + WHERE fragments
         │                                      ▼
         ◀── StatsResponse ──── recharts (reactive X-axis label by granularity)
         │
    bar click ──▶ GET /api/stats/drilldown?period=...&dimension=... ──▶ DrilldownPanel

### Market study (B)

    Form inputs ──▶ POST /api/market-studies (create)
                          │
    POST /:id/generate ──▶ collectRealData() [reuses stats aggregations]
                          │  realData + inputs ──▶ STRONG_MODEL ──▶ sections Json [{key,title,markdown}]
                          ▼
    PATCH /:id/sections/:key (manual edit)
    POST  /:id/sections/:key/regenerate ──▶ STRONG_MODEL (single section, anchored to realData)
    POST  /:id/prospect ──▶ places.search(zone,sector) → Details(website) → filter no-website → cap 20 → prospects Json
    PATCH /:id/prospects/:placeId (status contacted/discarded)
    GET   /:id/prospects/export ──▶ CSV stream

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `back/src/lib/stats.ts` | Modify | `StatsQuery` type, range/granularity helpers, `Prisma.sql` filter fragments, drill-down fn; no-arg path unchanged |
| `back/src/lib/service-catalog.ts` | Create | Shared `SERVICE_CATALOG` const (mirror of front), serviceId→candidateService map for prospects |
| `back/src/lib/market-study/types.ts` | Create | `MarketStudyInputs`, `StudySection`, `Prospect`, `StudyStatus` |
| `back/src/lib/market-study/study-generator.ts` | Create | `collectRealData()`, `generateStudy()`, `regenerateSection()` via STRONG_MODEL, defensive JSON parse |
| `back/src/lib/market-study/places.ts` | Create | `isConfigured()`, `searchProspects()` (Text Search + Details, no-website filter, cap 20, quota/error handling) |
| `back/src/routes/market-studies.ts` | Create | CRUD + generate + section patch/regen + prospect + export Router |
| `back/src/index.ts` | Modify | Parse query in `/api/stats`, add `/api/stats/drilldown`, `app.use("/api/market-studies", marketStudiesRouter)` |
| `back/prisma/schema.prisma` | Modify | `MarketStudy` model |
| `back/prisma/migrate-market-study.sql` | Create | Idempotent manual migration (pattern of `migrate-skill-type-use.sql`) |
| `back/.env.example` | Modify | Document `GOOGLE_MAPS_API_KEY` (optional), `STRONG_MODEL` |
| `front/app/estadisticas/page.tsx` | Modify | Tabs (Dashboard \| Estudios), wire filters + drill-down |
| `front/components/stats/StatsFilters.tsx` | Create | Filter toolbar (selects + date pickers) |
| `front/components/stats/DrilldownPanel.tsx` | Create | Period breakdown panel |
| `front/app/estadisticas/estudios/*` | Create | List + `[id]` detail: editable sections, regen buttons, prospect table, CSV export |

## Interfaces / Contracts

```ts
// stats.ts
const GRANULARITY = { year: "year", month: "month", week: "week" } as const;
interface StatsQuery {
  period?: "year" | "month" | "week";
  granularity?: "year" | "month" | "week";
  range?: "last12m" | "ytd" | "all" | "custom";
  from?: string; to?: string;            // ISO, required when range=custom
  clientId?: string; serviceId?: string; // serviceId joins via BudgetLine
  agentId?: string; status?: string; sector?: string;
}
// market-study/types.ts
interface StudySection { key: string; title: string; markdown: string; }
interface Prospect { placeId: string; name: string; address?: string; phone?: string;
  rating?: number; sector?: string; candidateServices: string[];
  status: "new" | "contacted" | "discarded"; }
interface MarketStudyInputs { zone: string; postalCode?: string; radiusKm: number;
  expansionZones: string[]; targetSectors: string[]; avgBudget?: number; }
```

`MarketStudy` model: `id, title, inputs Json, sections Json @default("[]"),
prospects Json @default("[]"), status String @default("draft"), createdAt, updatedAt`.

**SQL whitelist rule**: `granularity` is parsed by zod to the enum, then mapped
through `GRANULARITY[g]` to a literal unit string BEFORE building `date_trunc`.
User input never reaches `$queryRaw` as a raw fragment.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | stats no-params == P7 | Snapshot regression on `getStats()` |
| Unit | granularity whitelist | Reject invalid granularity (zod), assert week/month/year `date_trunc` paths |
| Unit | study-generator | Mock `openai`; assert output anchored to injected real figures; defensive parse of malformed JSON |
| Unit | places | Mock `fetch`: with/without website filtering, quota error, missing key → degraded |
| Unit | CSV export | Header + rows, escaping |
| Integration | stats filters | clientId/serviceId/sector + granularity recalc series |

## Migration / Rollout

Manual idempotent SQL (`migrate-market-study.sql`) following the project's
`prisma db execute` pattern, then `db:push`. Rollback: drop `MarketStudy` table
(no critical data) and revert routes/module. Stats no-arg path guarantees P7
dashboard survives a toolbar revert.

## Open Questions

- [ ] Drill-down dimension fixed to client/service per period, or configurable? (assume sub-dimension aggregate per proposal Q5)
- [ ] Place Details caching layer (TTL) in-memory vs persisted — assume in-memory map for MVP to limit quota cost.
