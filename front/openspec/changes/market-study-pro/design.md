# Design: market-study-pro (P9)

## Architecture Decisions

### D1 — No separate competitors endpoint
Competitor data is generated as a study section during `/generate`. Included in `sections[]` with key `competitors`. Rationale: fewer endpoints, consistent with existing section model.

### D2 — Prospect fields added to Json column (no migration)
`websiteStatus`, `websiteUrl`, `opportunityScore`, `unverified` are added to prospect objects stored in the `prospects Json` column. No schema migration needed for these fields. Only `successScore` on `MarketStudy` requires a migration.

### D3 — website-analyzer.ts is a pure utility module
`back/src/lib/market-study/website-analyzer.ts` exports:
- `analyzeWebsite(url: string): Promise<{ websiteStatus: "web_chatbot" | "web_no_chatbot"; unverified?: boolean; }>`
- `computeOpportunityScore(websiteStatus: string, unverified: boolean, rating?: number): number`
No Prisma access. Testable in isolation.

### D4 — competitors.ts is a focused module
`back/src/lib/market-study/competitors.ts` exports:
- `findCompetitors(zone: string): Promise<Competitor[]>`
- `buildCompetitorSection(competitors: Competitor[], inputs: MarketStudyInputs, hasPlacesKey: boolean): Promise<StudySection>`
Depends on `places.ts` textSearch (re-exported or duplicated query) and `scrapeUrl`.

### D5 — places.ts changes
- Remove filter `if (hasWebsite) continue` — keep ALL businesses
- For each business with website: call `analyzeWebsite`
- Set `websiteStatus` on each prospect
- Cap raised to 30 (was 20)
- Add generic types: `"store"` and `"establishment"` as fallback search terms

### D6 — study-generator.ts changes
- `generateStudy` accepts optional `competitorSection?: StudySection`
- Adds sections `action_plan`, `recommended_options`, `competitors` to expected keys
- LLM returns 10 sections (was 7) + `successScore` field at top level
- Response format: `{ sections: [...], successScore: 1-5 }`
- `buildSystemPrompt` includes competitor data context and real success cases

### D7 — SECTION_KEYS updated
Add to `STUDY_SECTION_KEYS`: `"action_plan"`, `"recommended_options"`, `"competitors"`
Add to `SECTION_TITLES`: translations for these 3 keys

### D8 — Opportunity Score Heuristic
```
function computeOpportunityScore(websiteStatus, unverified, rating?):
  base = { no_web: 5, web_no_chatbot: 4, web_chatbot: 2 }[websiteStatus] ?? 3
  if websiteStatus === "web_no_chatbot" && unverified: base = 3
  if rating < 3.5: base = min(5, base + 1)   // low rating → easier to get in
  if rating > 4.2: base = max(1, base - 1)   // strong competitor → harder
  return clamp(base, 1, 5)
```

### D9 — PATCH /:id expanded
```ts
z.object({
  title: z.string().optional(),
  successScore: z.number().int().min(1).max(5).optional().nullable(),
})
```

### D10 — Frontend component StarRating
`front/components/stats/StarRating.tsx`
- Props: `value: number | null`, `max?: number (default 5)`, `editable?: boolean`, `onChange?: (v: number) => void`
- Display: filled star (★) for 1..value, empty star (☆) for rest
- No external deps

### D11 — Frontend studies table
Replace card-list in `estadisticas/page.tsx` estudios tab with `<table>`.
Columns: Nombre | Fecha | Éxito | Estado | Acciones

### D12 — Prospect table enhancement
In `[id]/page.tsx`, ProspectsTable gains:
- websiteStatus badge: `sin web` (gray), `web s/chatbot` (blue), `web c/chatbot` (green)
- opportunityScore as StarRating (display only)
- filter buttons: All / Sin web / Web sin chatbot / Web con chatbot
- default sort: opportunityScore desc (nulls last → treated as 0)
