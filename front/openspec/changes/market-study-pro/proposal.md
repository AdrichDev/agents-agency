# Proposal: market-study-pro (P9)

## Problem
MarketStudy module generates basic studies with limited prospecting (only no-web businesses), no competitor analysis, no action plan, and no success scoring. Users can't prioritize prospects by opportunity or understand competitive landscape.

## Solution
- Add `successScore` column to `MarketStudy` (1-5, null until generated).
- Expand Prospect JSON fields: `websiteStatus`, `websiteUrl?`, `opportunityScore`.
- Detect chatbots in HTML (fetch per prospect with website) → classify prospects.
- Find real AI/marketing competitors via Places text search → scrape + LLM analysis.
- Enrich study generation: action plan, recommended options (each with successScore), competitor table.
- Frontend: professional table for studies list with star rating; expanded prospect table with website status badges, opportunity stars, filters.

## Scope
- Back: schema migration, website-analyzer.ts, competitors.ts, updated places.ts + study-generator.ts + market-studies.ts routes
- Front: estadisticas page (studies table), [id] page (new sections, expanded prospect table), StarRating component
- Tests: website-analyzer, opportunity heuristic, competitors (mock), successScore persistence, classified prospects

## Risks
- Places API quota: mitigated by configurable cap (30) and graceful degradation
- Chatbot detection false negatives: heuristic, documented
- LLM hallucinating competitors: prompt explicitly forbids inventing names; only Places-returned results used
