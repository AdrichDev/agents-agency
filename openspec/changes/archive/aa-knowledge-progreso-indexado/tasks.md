# Tasks — aa-knowledge-progreso-indexado

Tests **vitest** (back) + front `tsc` (+ HITL visual). SIN migración. DONE con verde.

## F1 — Progreso incremental (backend)

- [x] **T1.1 — `ingestWebsite` emite progreso.** Callback opcional `onProgress(done,total)`
  en `web.ts:55-80`: fijar `total=urls.length` tras discoverLinks, `onProgress(0,total)` al
  empezar y `onProgress(i+1,total)` tras cada página. `web.ts` sin DB (solo notifica).
  - Test: onProgress se llama (0,total)…(total,total) en orden. → `tests/ingest-website-progress.test.ts` (verde)
- [x] **T1.2 — Service escribe progress.** El wrapper de auto-ingest (`service.ts:229-253`)
  pasa `onProgress` → `writeInitialIngestStatus(..., {status:"pending", progress:{pagesDone,
  pagesTotal}})`. Ampliar `InitialIngestRecord` con `progress?`. Al terminar, estado final
  sin progress.
  - Test: durante la ingesta `initialIngest.progress` refleja el avance; al final indexed/empty. → `tests/initial-ingest-progress.test.ts` (verde)

## F2 — Endpoint de estado (backend)

- [x] **T2.1 — `GET /api/knowledge/:agentId/ingest-status`** → `{status, progress?, chunks?,
  reason?, url?}`, gated, ligero. Sin secretos.
  - Test: devuelve el estado/progreso; gate correcto; sin ingest → neutro sin romper. → `tests/knowledge-ingest-status.test.ts` (verde)

## F3 — Progreso en vivo (front)

- [x] **T3.1 — Animación + % + polling** en `KnowledgeTab`: mientras `pending`, "Indexando"
  con ellipsis ANIMADA + `round(pagesDone/pagesTotal*100)%` (o "(N/M páginas)"; sin progress
  → animado sin %). Polling ~2s a ingest-status; parar y pintar final al llegar a
  indexed/empty/failed SIN recargar. Limpiar interval al desmontar/terminar; timeout guarda ~3min.
  - Test: `front tsc` verde; pending+progress pinta %; al pasar a indexed el interval se limpia.
  - **Fix verify CRITICAL:** el camino MANUAL (botón "Indexar"/"⟳ Re-indexar") ahora también
    dispara el progreso: back `POST /api/knowledge` (url) usa `runTrackedIngest` (pending →
    progress por página → estado final, mismo mecanismo que la auto-ingesta); front
    `KnowledgeTab.handleIngest` pone `live` a `pending` de inmediato (optimista) para arrancar
    animación + polling sin bloquear en el POST. Escenario 1 de validation.md ahora se cumple.

## Verificaciones finales

- [x] **T4.1 — Typecheck + suite** (`back` vitest+tsc, `front` tsc) verde. → back `vitest run`
  97 files, 1019 passed / 3 skipped, 0 failed; back `tsc --noEmit` exit 0; front `tsc --noEmit` exit 0.
- [ ] **T4.2 — HITL visual:** re-indexar una web y ver los puntos moverse + el % subir +
  pasar a "Indexada ✓" solo, sin recargar. *(Pendiente HITL — pulsar el botón "⟳ Re-indexar".)* — ⏳ GATE HUMANO: el código ya está (`front/components/agents/KnowledgeTab.tsx:235` muestra `Indexada ✓` y `:250` calcula el porcentaje con `Math.round((pagesDone/pagesTotal)*100)`). Falta únicamente pulsar "⟳ Re-indexar" en el navegador y confirmarlo a la vista.
- [x] **T4.3 — Engram.**

## Notas
- Aditivo, sin migración (progress en JSON initialIngest). Regresión cero: sin progress el
  front cae a "Indexando…" animado. Polling con cleanup obligatorio (no leaks).

## Cierre — 28/07/2026

Cierre con una única acción humana pendiente (T4.2, comprobación visual del progreso de indexado). El código de la animación y del porcentaje está verificado en `KnowledgeTab.tsx`.
