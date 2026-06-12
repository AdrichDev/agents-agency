# Spec — Interactive Stats + Market Studies (P8)

> Change: `interactive-stats-market-studies` · Status: **draft**
> Capabilities: `stats-dashboard` (new full spec), `market-studies` (new full spec)

---

## Domain: stats-dashboard

### Purpose

Parametric, backward-compatible stats API and reactive front-end dashboard with filters and drill-down.

---

### Requirement: R1 — Parametric Stats API

`GET /api/stats` MUST accept optional query parameters: `granularity` (`year|month|week`), `range` (`12m|ytd|all|custom`), `from` (ISO date, required when `range=custom`), `to` (ISO date, required when `range=custom`), `clientId`, `serviceId`, `revenueType` (`all|impl|maint`), `sector`. When called with no parameters the response MUST be byte-identical to the P7 response (regression guarantee). Weekly granularity MUST use ISO weeks (Monday start). Invalid parameter values MUST return HTTP 400.

#### Scenario: No-params regression

- GIVEN the API receives `GET /api/stats` with no query parameters
- WHEN the handler resolves
- THEN the response body is structurally and numerically identical to the P7 baseline
- AND HTTP status is 200

#### Scenario: Granularity week — ISO weeks

- GIVEN `granularity=week` is provided
- WHEN the handler resolves
- THEN each period key in `monthly` uses the ISO-8601 week format (`YYYY-Www`)
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

## Domain: market-studies

### Purpose

AI-generated, persistable, editable market studies anchored to real business data, with optional Google Places prospect discovery.

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

### Requirement: R5 — AI Study Generation (STRONG_MODEL)

Study generation MUST use `STRONG_MODEL`. The prompt MUST inject real business metrics as numeric context: accepted-budget revenue by service and sector, active client count by sector, average accepted ticket. The generated content MUST include sections: executive summary, SWOT, target segments, zone analysis, suggested pricing, expansion plan, next steps. The system MUST NOT invent figures for the business; business metrics come exclusively from injected real data. Market-size estimates MUST be labeled as "estimación". The response MUST be parsed as strict JSON with defensive fallback per section.

#### Scenario: Generation with real data

- GIVEN a study is requested and real billing data exists (≥1 accepted budget)
- WHEN generation completes
- THEN the study JSON contains all seven required sections, non-empty
- AND no section contains invented figures for revenue, clients, or accepted budgets

#### Scenario: Generation with insufficient data

- GIVEN no accepted budgets exist in the database
- WHEN generation is requested
- THEN the study is generated with a visible banner "Base de datos insuficiente — estimaciones de mercado sin respaldo de datos reales"
- AND generation still completes (does not error)

#### Scenario: JSON parse failure (defensive)

- GIVEN the model returns malformed JSON for one section
- WHEN the parser encounters the error
- THEN the affected section is set to a placeholder "Contenido no disponible — regenerar sección"
- AND the rest of the study is saved normally

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

When `GOOGLE_MAPS_API_KEY` is set, the system MUST execute a Text Search via the official Places API for the given zone and target sectors, retrieve Place Details to check the `website` field, filter to businesses WITHOUT a website, cap results at 20 per search query, and persist prospects with fields: `name`, `address`, `phone`, `rating`, `sector`, `placeId`, `status` (`new`). Deduplication MUST be by `placeId`. Prospect status MUST be updatable to `contacted` or `discarded`. Prospects MUST be exportable as CSV. When `GOOGLE_MAPS_API_KEY` is absent the system MUST skip prospecting, return the study without prospects, and surface a visible UI notice "Requiere GOOGLE_MAPS_API_KEY para activar prospección". Web scraping of Google is PROHIBITED.

#### Scenario: Prospect discovery with API key

- GIVEN `GOOGLE_MAPS_API_KEY` is configured and the zone/sector inputs are valid
- WHEN prospect discovery runs
- THEN at most 20 prospects are returned per search query
- AND each prospect has website=null or website="" confirmed via Place Details
- AND prospects are stored with status "new" and unique placeId

#### Scenario: Deduplication by placeId

- GIVEN a prospect with placeId=X already exists for this study
- WHEN discovery runs again and returns placeId=X
- THEN no duplicate row is created

#### Scenario: No API key — degraded mode

- GIVEN `GOOGLE_MAPS_API_KEY` is not set
- WHEN a study is generated or prospect discovery is triggered
- THEN the study is created/returned without prospects
- AND the UI shows the notice "Requiere GOOGLE_MAPS_API_KEY para activar prospección"
- AND no error is thrown

#### Scenario: Places API quota / network error

- GIVEN the Places API returns a quota or network error
- WHEN discovery runs
- THEN any prospects already fetched before the error are saved
- AND a non-blocking warning is surfaced in the UI
- AND the study itself is not corrupted

#### Scenario: CSV export

- GIVEN the study has prospects
- WHEN the user clicks export CSV
- THEN a CSV file is downloaded with columns: name, address, phone, rating, sector, placeId, status

---

### Requirement: R8 — MarketStudy Persistence and Navigation

The system MUST persist `MarketStudy` records with fields: `id`, `title`, `inputs` (JSON), `content` (JSON sections), `prospects` (JSON array), `status`, `createdAt`, `updatedAt`. Studies are global (no owner/user association). The UI MUST provide a "Estudios de mercado" tab within the Estadísticas section listing all studies with create, open, and delete actions. Delete MUST require confirmation.

#### Scenario: List and open study

- GIVEN two studies exist
- WHEN the user navigates to the "Estudios de mercado" tab
- THEN both studies are listed with title, status, and createdAt
- AND clicking a study opens its detail page

#### Scenario: Delete with confirmation

- GIVEN a study exists and the user clicks delete
- WHEN the confirmation dialog is accepted
- THEN the study is deleted and removed from the list
- AND if the dialog is dismissed the study is not deleted

#### Scenario: Study list while stats are empty (P7 vacío)

- GIVEN the stats dashboard has no data (no budgets/leads)
- WHEN the user navigates to "Estudios de mercado"
- THEN the tab and create form are accessible
- AND generation proceeds with the "insufficient data" banner (R5 scenario)
