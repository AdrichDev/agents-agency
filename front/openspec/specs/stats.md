# Stats Dashboard & Market Studies Specification

## Purpose

Complete business intelligence suite: aggregate dashboard with interactive filters and drill-down (P7), AI-generated market studies with prospect discovery (P8), and competitive analysis with success scoring (P9).

---

## Domain: Stats Dashboard

### Purpose

Parametric, backward-compatible stats API and reactive front-end dashboard with filters and drill-down.

---

### Requirement: R1 — Parametric Stats API

`GET /api/stats` MUST accept optional query parameters: `granularity` (`year|month|week`), `range` (`12m|ytd|all|custom`), `from` (ISO date, required when `range=custom`), `to` (ISO date, required when `range=custom`), `clientId`, `serviceId`, `revenueType` (`all|impl|maint`), `sector`. When called with no parameters the response MUST be byte-identical to the P7 response (regression guarantee). Weekly granularity MUST use ISO weeks (Monday start). Invalid parameter values MUST return HTTP 400.

#### Scenario: No-params regression (P7 compatibility)

- GIVEN the API receives `GET /api/stats` with no query parameters
- WHEN the handler resolves
- THEN the response body is structurally and numerically identical to the P7 baseline
- AND HTTP status is 200

#### Scenario: Granularity week — ISO weeks

- GIVEN `granularity=week` is provided
- WHEN the handler resolves
- THEN each period key in series uses the ISO-8601 week format (`YYYY-Www`)
- AND weeks start on Monday

#### Scenario: Custom range validation

- GIVEN `range=custom` but `from` or `to` is absent
- WHEN the handler resolves
- THEN HTTP 400 is returned with a descriptive error message

#### Scenario: Combined filters

- GIVEN `clientId=X`, `serviceId=Y`, `revenueType=maint`, `sector=retail`
- WHEN the handler resolves
- THEN billing series reflect only BudgetLines where serviceId=Y on Budgets where clientId=X and Client.sector=retail, counting only maintPrice revenue
- AND totals are recalculated accordingly

#### Scenario: Empty result set

- GIVEN filters that match no data
- WHEN the handler resolves
- THEN all numeric fields are 0 and series arrays are empty
- AND HTTP status is 200

---

### Requirement: R2 — Filter Toolbar (Front)

The stats page MUST render a filter toolbar with selects for period, granularity, range, clientId, serviceId, revenueType, and sector. Active filters MUST be shown as dismissible chips. A reset button MUST clear all filters. Each chart MUST show an independent loading indicator while its data is fetching. Charts MUST re-render reactively when any filter changes.

#### Scenario: Filter chips and reset

- GIVEN the user sets clientId and sector filters
- WHEN filters are applied
- THEN two chips appear labeled with the selected values
- AND clicking a chip removes that filter and refetches

#### Scenario: Reset clears all

- GIVEN one or more filters are active
- WHEN the user clicks reset
- THEN all selects return to default and chips disappear
- AND all charts refetch with no filter params

#### Scenario: Per-chart loading state

- GIVEN the user changes a filter
- WHEN a new fetch is in flight
- THEN each chart that depends on that filter shows a loading skeleton
- AND other charts that are not re-fetching remain visible

---

### Requirement: R3 — Drill-Down Period Detail

Clicking a bar or point in a period chart MUST open a detail panel showing the budgets and leads that fall within that period, including their individual amounts and statuses. Drill-down MUST respect the currently active filters.

#### Scenario: Click opens detail panel

- GIVEN the main chart is rendered with monthly granularity
- WHEN the user clicks the bar for period "2026-04"
- THEN a panel opens listing budgets created in April 2026 matching active filters
- AND each budget row shows quoteNumber, client name, totalImpl, totalMaint, status

#### Scenario: Leads in drill-down

- GIVEN the drill-down panel is open for a period
- WHEN the data loads
- THEN the panel also shows the count and list of leads created in that period

#### Scenario: Drill-down respects filters

- GIVEN `clientId=X` is active and the user drills into a period
- WHEN the drill-down fetches
- THEN only budgets and leads linked to clientId=X are shown

---

## Domain: Market Studies (P8 + P9)

### Purpose

AI-generated, persistable, editable market studies anchored to real business data, with optional Google Places prospect discovery and competitive analysis with success scoring.

---

### Requirement: R4 — Market Study Input Form

The study creation form MUST collect: zone/postal code, radius in km, desired expansion zones, target sectors (multi-select), and average ticket. Postal code MUST be validated (non-empty, numeric format of the target country). Radius MUST be a positive integer. At least one target sector MUST be selected. The form MUST NOT be submittable until all required fields are valid.

#### Scenario: Valid form submission

- GIVEN all required fields are filled correctly
- WHEN the user submits the form
- THEN the creation request is sent and a loading state is shown
- AND the user is navigated to the study detail page on success

#### Scenario: Invalid postal code

- GIVEN the postal code field contains non-numeric characters
- WHEN the user attempts to submit
- THEN an inline validation error is shown
- AND the form is not submitted

#### Scenario: No sector selected

- GIVEN the sector multi-select has no selection
- WHEN the user attempts to submit
- THEN an inline error "Selecciona al menos un sector" is shown

---

### Requirement: R5 — AI Study Generation with Real Data

Study generation MUST use `STRONG_MODEL`. The prompt MUST inject real business metrics as numeric context: accepted-budget revenue by service and sector, active client count by sector, average accepted ticket. The generated content MUST include sections: executive summary, SWOT, target segments, zone analysis, suggested pricing, expansion plan, next steps, action plan, recommended options, and competitors. The system MUST NOT invent figures for the business; business metrics come exclusively from injected real data. Market-size estimates MUST be labeled as "estimación". The response MUST be parsed as strict JSON with defensive fallback per section.

#### Scenario: Generation with real data (P8)

- GIVEN a study is requested and real billing data exists (≥1 accepted budget)
- WHEN generation completes
- THEN the study JSON contains all required sections, non-empty
- AND no section contains invented figures for revenue, clients, or accepted budgets

#### Scenario: Generation with insufficient data (P8)

- GIVEN no accepted budgets exist in the database
- WHEN generation is requested
- THEN the study is generated with a visible banner "Base de datos insuficiente — estimaciones de mercado sin respaldo de datos reales"
- AND generation still completes (does not error)

#### Scenario: JSON parse failure — defensive (P8)

- GIVEN the model returns malformed JSON for one section
- WHEN the parser encounters the error
- THEN the affected section is set to a placeholder "Contenido no disponible — regenerar sección"
- AND the rest of the study is saved normally

#### Scenario: Generation includes success scoring (P9)

- GIVEN generation is complete and all sections are valid
- WHEN the LLM response includes a top-level `successScore` field (1-5)
- THEN the study's `successScore` column is populated with that value
- AND the score is displayed in the studies list as a star rating

---

### Requirement: R6 — Editable Sections and Section Regeneration

Each study section MUST be independently editable via a markdown textarea. Edits MUST be persisted per section on save. A "Regenerar sección" button MUST re-invoke `STRONG_MODEL` for that section only, injecting the same real-data context plus the current inputs, and MUST NOT modify other sections. Full study history is NOT required.

#### Scenario: Edit and save a section

- GIVEN a study detail page is open
- WHEN the user edits the "DAFO" section textarea and clicks save
- THEN only the SWOT section in the DB is updated
- AND the other sections remain unchanged

#### Scenario: Regenerate single section

- GIVEN the user clicks "Regenerar" on the "Pricing sugerido" section
- WHEN the AI call completes
- THEN only the pricing section is overwritten with the new content
- AND the executive summary and other sections are unchanged

---

### Requirement: R7 — Google Places Prospect Discovery

When `GOOGLE_MAPS_API_KEY` is set, the system MUST execute a Text Search via the official Places API for the given zone and target sectors, retrieve Place Details to check the `website` field, and persist prospects with fields: `name`, `address`, `phone`, `rating`, `sector`, `placeId`, `status` (`new`), `websiteStatus` (`no_web` | `web_no_chatbot` | `web_chatbot`), `opportunityScore` (1-5). Deduplication MUST be by `placeId`. Prospect status MUST be updatable to `contacted` or `discarded`. Prospects MUST be exportable as CSV. When `GOOGLE_MAPS_API_KEY` is absent the system MUST skip prospecting, return the study without prospects, and surface a visible UI notice "Requiere GOOGLE_MAPS_API_KEY para activar prospección". Web scraping of Google is PROHIBITED.

#### Scenario: Prospect discovery with API key (P8)

- GIVEN `GOOGLE_MAPS_API_KEY` is configured and the zone/sector inputs are valid
- WHEN prospect discovery runs
- THEN at most 20 prospects are returned per search query
- AND each prospect has website=null or website="" confirmed via Place Details
- AND prospects are stored with status "new" and unique placeId

#### Scenario: Prospect discovery with all businesses (P9)

- GIVEN `GOOGLE_MAPS_API_KEY` is configured and prospect discovery runs
- WHEN Places returns businesses
- THEN ALL businesses are included (not filtered to no-website only)
- AND each business with a website is analyzed for chatbot presence
- AND prospects are stored with `websiteStatus` field set: `no_web` or `web_no_chatbot` or `web_chatbot`

#### Scenario: Chatbot detection (P9)

- GIVEN a prospect has a website URL from Places data
- WHEN HTML is fetched (8s timeout, User-Agent: "MarketStudyBot/1.0")
- THEN the content is searched for chatbot signatures: intercom, crisp.chat, tawk.to, tidio, drift, zendesk, zopim, hubspot, manychat, landbot, botpress, livechat, wa.me, api.whatsapp.com, chatbot
- AND if any signature is found, `websiteStatus: "web_chatbot"` is set
- AND if no signature and HTML was fetched, `websiteStatus: "web_no_chatbot"` is set
- AND if fetch fails, `websiteStatus: "web_no_chatbot"` + `unverified: true` is set

#### Scenario: Opportunity score heuristic (P9)

- GIVEN a prospect has been classified with `websiteStatus` and optional Places `rating`
- WHEN opportunity score is computed
- THEN the base score is: `no_web→5, web_no_chatbot→4, web_chatbot→2`
- AND if `unverified: true`, base score is clamped to 3 max
- AND rating adjustment: if rating < 3.5 then base += 1 (easier to win), if rating > 4.2 then base -= 1 (harder to displace)
- AND final score is clamped to [1, 5]

#### Scenario: Deduplication by placeId (P8)

- GIVEN a prospect with placeId=X already exists for this study
- WHEN discovery runs again and returns placeId=X
- THEN no duplicate row is created

#### Scenario: No API key — degraded mode (P8)

- GIVEN `GOOGLE_MAPS_API_KEY` is not set
- WHEN a study is generated or prospect discovery is triggered
- THEN the study is created/returned without prospects
- AND the UI shows the notice "Requiere GOOGLE_MAPS_API_KEY para activar prospección"
- AND no error is thrown

#### Scenario: Places API quota / network error (P8)

- GIVEN the Places API returns a quota or network error
- WHEN discovery runs
- THEN any prospects already fetched before the error are saved
- AND a non-blocking warning is surfaced in the UI
- AND the study itself is not corrupted

#### Scenario: CSV export (P8)

- GIVEN the study has prospects
- WHEN the user clicks export CSV
- THEN a CSV file is downloaded with columns: name, address, phone, rating, sector, placeId, status, websiteStatus, opportunityScore

---

### Requirement: R8 — Competitor Analysis (P9)

The system MUST automatically discover competitor businesses via Places text searches for terms: "agencia inteligencia artificial {zone}", "agencia ia {zone}", "agencia marketing digital ia {zone}". Up to 8 unique competitors (name, website, rating from Places) MUST be discovered. For each competitor with a website, the system MUST fetch and scrape (maxChars 4000) the webpage and use LLM to extract their services list. A study section `competitors` MUST be included with: markdown table of competitors, analysis of competitive positioning, and differentiation ideas. If `GOOGLE_MAPS_API_KEY` is not configured, the section MUST display a degraded message.

#### Scenario: Competitor discovery with Places key (P9)

- GIVEN `GOOGLE_MAPS_API_KEY` is configured and a study is being generated
- WHEN the system searches for competitors in the given zone
- THEN up to 8 competitors are discovered via Places API
- AND each competitor has name, website (if available), and rating
- AND the section is included in the study

#### Scenario: Website scraping and service extraction (P9)

- GIVEN a competitor has a website URL from Places data
- WHEN the system fetches and scrapes the HTML (max 4000 chars, 8s timeout)
- THEN the LLM is invoked to extract a list of services offered
- AND services are included in the competitors section

#### Scenario: Competitor section with no key — degraded (P9)

- GIVEN `GOOGLE_MAPS_API_KEY` is not configured
- WHEN a study is generated
- THEN the `competitors` section is included with a message: "Requiere GOOGLE_MAPS_API_KEY para análisis de competidores"
- AND no error is thrown

#### Scenario: Differentiation advice (P9)

- GIVEN competitors and their services have been analyzed
- WHEN the LLM generates the competitors section
- THEN the section includes concrete differentiation ideas based on gaps in competitor offerings
- AND LLM is PROHIBITED from inventing competitor names or services not from Places

---

### Requirement: R9 — Market Study Success Scoring (P9)

The `MarketStudy` model MUST have a `successScore` column (nullable integer, 1-5). When a study is generated, the LLM response MUST include a top-level `successScore` field (1-5) calculated based on market size, growth potential, competitive positioning, and resource alignment. Users MUST be able to edit the `successScore` via `PATCH /:id` with `{ successScore: number }`. The studies list MUST display the score as a star rating (★★★★☆ style), null values shown as empty stars. Studies MUST be sortable by success score.

#### Scenario: Score generation during study creation (P9)

- GIVEN a study is being generated with all market data available
- WHEN the LLM completes generation
- THEN a `successScore` (1-5) is extracted from the response
- AND persisted to the `MarketStudy` record

#### Scenario: Edit success score (P9)

- GIVEN a user is viewing a study detail page
- WHEN they click to edit the success score
- THEN they can select a value from 1-5 via a star rating UI
- AND clicking save sends `PATCH /:id` with `{ successScore: value }`
- AND the DB is updated and the UI reflects the change

#### Scenario: Studies list with star ratings (P9)

- GIVEN the studies list is displayed
- WHEN the user views the list
- THEN each study shows a professional table with columns: Nombre, Fecha, Éxito (star rating), Estado, Acciones
- AND null scores are displayed as empty stars
- AND clicking the star rating (if editable mode enabled) allows inline editing

---

### Requirement: R10 — Recommended Options within Studies (P9)

The `recommended_options` section MUST be generated by the LLM as a JSON array within the section content: `[{ title, description, successScore: 1-5, rationale }]`. Each option represents a specific action the user can take. The frontend MUST render these as expandable cards with the title, description, success score (star rating), and rationale visible. Users MUST be able to edit the section and regenerate it independently of other sections.

#### Scenario: Generation of recommended options (P9)

- GIVEN a study is being generated with market analysis complete
- WHEN the LLM generates the `recommended_options` section
- THEN a JSON array with at least 3 options is included
- AND each option has title, description, successScore (1-5), and rationale
- AND no fields are invented; all recommendations are grounded in market data

#### Scenario: Display and interaction (P9)

- GIVEN the study detail page is open
- WHEN the `recommended_options` section is rendered
- THEN each option appears as an expandable card
- AND the card shows the title, a star rating for successScore, and a brief description
- AND clicking expands to show the full description and rationale

---

### Requirement: R11 — Market Study Persistence and Navigation

The system MUST persist `MarketStudy` records with fields: `id`, `title`, `inputs` (JSON), `content` (JSON sections), `prospects` (JSON array), `successScore` (nullable), `status`, `createdAt`, `updatedAt`. Studies are global (no owner/user association). The UI MUST provide a "Estudios de mercado" tab within the Estadísticas section listing all studies with create, open, and delete actions. Delete MUST require confirmation.

#### Scenario: List and open study

- GIVEN two studies exist
- WHEN the user navigates to the "Estudios de mercado" tab
- THEN both studies are listed with title, status, createdAt, and successScore
- AND clicking a study opens its detail page

#### Scenario: Delete with confirmation

- GIVEN a study exists and the user clicks delete
- WHEN the confirmation dialog is accepted
- THEN the study is deleted and removed from the list
- AND if the dialog is dismissed the study is not deleted

#### Scenario: Study list while stats are empty

- GIVEN the stats dashboard has no data (no budgets/leads)
- WHEN the user navigates to "Estudios de mercado"
- THEN the tab and create form are accessible
- AND generation proceeds with the "insufficient data" banner (R5 scenario)

---

## Implementation Status

| Phase | Status | Date | Details |
|-------|--------|------|---------|
| P7 — Stats Dashboard | ✅ Completed & Archived | 2026-06-12 | Aggregate dashboard, KPIs, monthly/billing charts, top agents. Missing: spec/design files (partial archive). |
| P8 — Interactive Stats + Market Studies | ✅ Completed & Archived | 2026-06-12 | Parametric API, filter toolbar, drill-down, study generation, Google Places prospects, CSV export. |
| P9 — Market Study Pro | ✅ Completed & Archived | 2026-06-12 | Website analyzer & chatbot detection, opportunity scoring, competitor analysis, success scoring, recommended options. |

## Known Technical Debt

1. **P7 Stats SQL unit tests** — Tests for complex `date_trunc` aggregations with multiple filters; some edge cases in drill-down query not covered.
2. **P8 Test snapshot regression** — `getStats()` without params should match P7 baseline; snapshot test needed to ensure byte-compatibility as features grow.
3. **P8 Section naming** — Clarity on terms "content" (JSON object) vs "sections" (array) needs documentation; refactor variable names for consistency.
4. **P9 Places API quota** — Configured cap at 30 requests per study; actual quota limits and cost per search not documented; recommend monitoring in production.
5. **Website analyzer false negatives** — Chatbot detection heuristic covers common platforms but may miss custom chat implementations; documented as limitation.
6. **Competitor scraping reliability** — Fetch timeout 8s; some sites may be slow or block; unverified flag helps but needs manual review workflow.

## Notes for Future Phases

- Stats dashboard foundation supports drill-down to individual records (records view not included in P7-P9)
- Prospect management can be extended with bulk actions, campaign tracking, and CRM integration
- Market studies can evolve into templates, collaborative editing, and version history
- Competitor analysis can include automated price monitoring and feature comparison
- Success score can inform automated prospection prioritization and recommendation ranking
