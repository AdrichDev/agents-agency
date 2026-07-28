# Proposal — aa-knowledge-progreso-indexado

Follow-up de H2 (`aa-rag-extraccion-estatica-honesta`). P0-ish de UX.

## Intent

Hoy la ingesta de la web de conocimiento es una caja negra: el estado "Pendiente…"
(`KnowledgeTab.tsx:118`) es **texto estático**, no se refresca solo (hay que recargar la
página para ver si pasó a "Indexada ✓") y no hay ninguna señal de progreso. El operador no
sabe si está indexando bien o colgado. Este change añade **progreso en vivo**: puntos
suspensivos animados + **porcentaje de avance**, con refresco automático (polling) mientras
indexa.

## Problema (verificado `file:line`)

- Ingesta fire-and-forget en background (`service.ts:229-253`): escribe `status:"pending"`
  y, al terminar, `indexed`/`empty`/`failed` con contadores finales. **No emite progreso
  intermedio.**
- `ingestWebsite` (`web.ts:55-80`) recorre `urls.slice(0,9)` en serie (fetch ≤25s + extraer
  + chunk + 1 embedding OpenAI por chunk) pero solo devuelve `{pages,chunks}` al final.
- Front `KnowledgeTab.tsx:118`: "Pendiente…" fijo, sin animación, sin %, **sin polling** →
  requiere recarga manual para ver el cambio de estado.

## Scope

- **F1 Backend — progreso incremental:** durante `ingestWebsite`, escribir en
  `initialIngest.progress = { pagesDone, pagesTotal }` (y `status:"pending"`) tras
  descubrir enlaces (fija `pagesTotal`) y tras cada página procesada (incrementa
  `pagesDone`). Aditivo al blob JSON, sin migración.
- **F2 Backend — endpoint ligero de estado:** `GET /api/knowledge/:agentId/ingest-status`
  → `{ status, progress:{pagesDone,pagesTotal}?, chunks?, reason? }` para que el front
  haga polling barato sin recargar todo el agente.
- **F3 Front — progreso en vivo:** en `KnowledgeTab`, mientras `status==="pending"`:
  - Puntos suspensivos **animados** ("Indexando" + ellipsis que se mueve).
  - **Porcentaje** = `round(pagesDone/pagesTotal*100)` (o "Indexando… (2/9 páginas)").
  - **Polling** cada ~2s del endpoint F2; al llegar a `indexed`/`empty`/`failed`, parar el
    polling y pintar el estado final (con sus chunks/mensaje) **sin recargar la página**.

## Fuera de scope
- Progreso a nivel de chunk/embedding (basta nivel página, honesto y suficiente).
- Streaming/websocket (polling simple ~2s es suficiente).
- Reindexado programado.

## Risks
- Bajo. Backend aditivo (progress en JSON + un GET), front polling con cleanup de timers.
  Regresión cero: si el back aún no emite `progress`, el front cae a "Indexando…" animado
  sin % (lectura defensiva). El polling se corta al terminar o al desmontar.

## Dependencies
- `back/src/lib/scraper/web.ts` (ingestWebsite: emitir progreso), `back/src/lib/agent/service.ts`
  (writeInitialIngestStatus / initialIngest), `back/src/routes/knowledge.ts` (endpoint status),
  `front/components/agents/KnowledgeTab.tsx` (animación + % + polling).
