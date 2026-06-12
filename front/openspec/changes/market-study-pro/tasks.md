# Tasks: market-study-pro (P9)

## Review Workload Forecast
- Estimated changed lines: ~700
- 400-line budget risk: High
- Chained PRs recommended: No (single feature branch, size:exception accepted)
- Decision: size:exception — all tasks in single apply batch

## Phase 1: Schema & Migration

- [x] 1.1 Add `successScore Int?` to `MarketStudy` in `back/prisma/schema.prisma`
- [x] 1.2 Create `back/prisma/migrate-market-study-score.sql`
- [x] 1.3 Run `npx prisma generate && npx prisma db push` to apply migration

## Phase 2: Backend — website-analyzer.ts

- [x] 2.1 Create `back/src/lib/market-study/website-analyzer.ts` with `analyzeWebsite` and `computeOpportunityScore`
- [x] 2.2 Update types.ts: add `websiteStatus`, `websiteUrl?`, `opportunityScore`, `unverified?` to `Prospect` interface

## Phase 3: Backend — places.ts update

- [x] 3.1 Remove no-website filter, add generic types, raise cap to 30
- [x] 3.2 For each prospect with website: call `analyzeWebsite`, set `websiteStatus`, `websiteUrl`, `opportunityScore`
- [x] 3.3 For prospects without website: set `websiteStatus: "no_web"`, `opportunityScore: 5`

## Phase 4: Backend — competitors.ts

- [x] 4.1 Create `back/src/lib/market-study/competitors.ts` with `findCompetitors` and `buildCompetitorSection`

## Phase 5: Backend — study-generator.ts update

- [x] 5.1 Update `STUDY_SECTION_KEYS` and `SECTION_TITLES` in types.ts to include `action_plan`, `recommended_options`, `competitors`
- [x] 5.2 Update `buildSystemPrompt` to include competitor data and success cases context
- [x] 5.3 Update `generateStudy` to accept competitor section, handle new sections, extract `successScore` from LLM response
- [x] 5.4 Update `generateStudy` return type to include `successScore`

## Phase 6: Backend — routes update

- [x] 6.1 Expand `PATCH /:id` to accept `successScore`
- [x] 6.2 Pass successScore to DB update
- [x] 6.3 Update `POST /:id/generate` to call competitors, pass to generateStudy, persist successScore
- [x] 6.4 Update `GET /` to include `successScore` in select

## Phase 7: Tests

- [x] 7.1 Create `back/tests/market-study-pro.test.ts` with tests for website-analyzer, opportunityScore, competitors, successScore PATCH, classified prospects

## Phase 8: Frontend — StarRating component

- [x] 8.1 Create `front/components/stats/StarRating.tsx`

## Phase 9: Frontend — Studies list table

- [x] 9.1 Replace card list in `front/app/estadisticas/page.tsx` estudios tab with professional table (Nombre, Fecha, Éxito, Estado, Acciones)

## Phase 10: Frontend — Prospect table & study detail

- [x] 10.1 Update Study interface in `[id]/page.tsx` to include `successScore`, new prospect fields
- [x] 10.2 Upgrade `ProspectsTable`: websiteStatus badge, opportunityScore stars, filter buttons, sort by opportunity
- [x] 10.3 Render new sections (`action_plan`, `recommended_options`, `competitors`) in study detail
- [x] 10.4 Add successScore display and inline edit to study header
