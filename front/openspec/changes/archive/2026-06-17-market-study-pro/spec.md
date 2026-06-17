# Spec: market-study-pro (P9)

## Acceptance Criteria

### S1 — Schema
- `MarketStudy` has `successScore Int?` (nullable, 1-5)
- Migration file `migrate-market-study-score.sql` contains `ALTER TABLE "MarketStudy" ADD COLUMN "successScore" INTEGER;`
- Prospects JSON items may contain `websiteStatus: "no_web" | "web_no_chatbot" | "web_chatbot"`, `websiteUrl?: string`, `opportunityScore: 1-5`, `unverified?: boolean`

### S2 — Website Analyzer
- For each prospect WITH a website URL from Places: fetches HTML (timeout 8s, User-Agent: "MarketStudyBot/1.0")
- Chatbot detection: searches HTML (lowercased) for signatures: `intercom`, `crisp.chat`, `tawk.to`, `tidio`, `drift`, `zendesk`, `zopim`, `hubspot`, `manychat`, `landbot`, `botpress`, `livechat`, `wa.me`, `api.whatsapp.com`, `chatbot`
- Returns `web_chatbot` if any signature found, `web_no_chatbot` otherwise
- On fetch failure: returns `web_no_chatbot` + `unverified: true`
- Prospect with no website in Places data → `no_web`

### S3 — Opportunity Score Heuristic
- `no_web` → base 5
- `web_no_chatbot` + verified → base 4
- `web_no_chatbot` + unverified → base 3
- `web_chatbot` → base 2
- Adjust by Places rating: rating < 3.5 → +1 (low-rated = easier to win), rating > 4.2 → -1 (already strong = harder to displace)
- Final score clamped to [1, 5]

### S4 — Competitors
- Places text searches: "agencia inteligencia artificial {zone}", "agencia ia {zone}", "agencia marketing digital ia {zone}"
- Up to 8 unique competitors (name, website, rating from Places)
- For each competitor with website: scrapeUrl (maxChars 4000) → LLM extracts services list
- Study section `competitors`: markdown table of competitors + analysis + differentiation ideas
- If no Places key: section shows degraded message

### S5 — Generation Enhancements
- Sections added to every study: `action_plan` (steps with deadlines), `recommended_options` (JSON array within section: `[{title, description, successScore: 1-5, rationale}]`)
- Global `successScore` 1-5 calculated by LLM, persisted to DB column
- Prompt rules: PROHIBIT inventing business figures or competitor names not returned by Places; estimates labeled "(estimación)"
- Users can edit `successScore` via `PATCH /:id` with `{ successScore: number }`

### S6 — Endpoints
- `PATCH /:id` accepts `successScore` field (1-5 int) in addition to `title`
- `GET /:id` returns `successScore` in response
- `POST /:id/prospect` returns prospects with new `websiteStatus`, `websiteUrl`, `opportunityScore`, `unverified` fields
- Competitor data included in the study `sections` (no separate endpoint needed)

### S7 — Frontend: Studies List Table
- Replace card list with table: columns Nombre, Fecha, Éxito (StarRating), Estado, Acciones
- `StarRating` component: `value: number | null`, `max: 5`, `editable?: boolean`, `onChange?: (v: number) => void`
- Empty star for null, filled for 1-5

### S8 — Frontend: Prospect Table
- Additional columns: Web (badge: sin web/web sin chatbot/web con chatbot), Oportunidad (StarRating display)
- Default sort: opportunityScore desc
- Quick filters: All / Sin web / Web sin chatbot / Web con chatbot

### S9 — Frontend: New Sections
- `action_plan` and `recommended_options` rendered in study detail (expandable like other sections, editable)
- `competitors` section rendered as rich markdown table
- `recommended_options` section shows cards with star scores

### S10 — Tests
- `website-analyzer`: HTML with chatbot signature → `web_chatbot`; HTML without → `web_no_chatbot`; fetch fail → `unverified: true`
- opportunityScore heuristic: no_web→5, web_no_chatbot→4, web_chatbot→2, unverified→3, rating adjustments
- competitors: mock Places + mock scrapeUrl → competitor section present
- successScore: PATCH /:id with successScore persists to DB
- Prospect classification: prospects returned by searchProspects include websiteStatus
