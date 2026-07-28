# Design — aa-knowledge-progreso-indexado

Aditivo. Sin migración (progreso en el JSON `initialIngest`). Polling simple.

## §A. Evidencia

- `service.ts:229-253` auto-ingest fire-and-forget; `writeInitialIngestStatus`
  (`service.ts:304-316`) mergea solo `initialIngest`. `InitialIngestRecord` (`service.ts:294`).
- `ingestWebsite(agentId,url,crawl,{...})` (`web.ts:55-80`) recorre `urls.slice(0,9)`.
- `KnowledgeTab.tsx:70-138`: lee `agent.ecommerceConfig.initialIngest`, "Pendiente…" fijo.
- Endpoint de fuentes ya existe: `GET /api/knowledge/:agentId/sources` (`knowledge.ts:151`).

## §B. F1 — Progreso incremental (backend)

- **`ingestWebsite`**: aceptar un callback opcional `onProgress?: (done:number, total:number) => void`.
  Tras `discoverLinks` fijar `total = urls.length`; llamar `onProgress(0,total)` al empezar y
  `onProgress(i+1,total)` tras procesar cada página. Mantener `web.ts` **agnóstico de DB**
  (no escribe el estado; solo notifica).
- **Service wrapper** (`service.ts:229-253`): pasar `onProgress` que hace
  `writeInitialIngestStatus(agentId,{ status:"pending", progress:{pagesDone:done,pagesTotal:total}, url })`.
  Throttle simple para no escribir en exceso (p.ej. cada página está bien; ≤9 escrituras).
- Ampliar `InitialIngestRecord` (`service.ts:294`) con `progress?: {pagesDone,pagesTotal}`.
- Al terminar: el `.then` ya escribe `indexed`/`empty`/`failed`; limpiar/omitir `progress`.

## §C. F2 — Endpoint de estado (backend)

`GET /api/knowledge/:agentId/ingest-status` (gate como el resto de knowledge routes):
- Lee `initialIngest` del agente → `{ status, progress?, chunks?, reason?, url? }`.
- Ligero (solo el blob), pensado para polling ~2s. No devuelve secretos.

## §D. F3 — Progreso en vivo (front)

En `KnowledgeTab`:
- **Animación**: mientras `status==="pending"`, "Indexando" + ellipsis animada (CSS
  `@keyframes` o 3 puntos que aparecen por turnos vía estado/interval). Debe **moverse**.
- **Porcentaje**: si hay `progress` → `Indexando… {round(pagesDone/pagesTotal*100)}%` (o
  "(pagesDone/pagesTotal páginas)"). Sin `progress` → "Indexando…" animado sin % (defensivo).
- **Polling**: cuando `status==="pending"`, `setInterval` cada ~2s a
  `GET /api/knowledge/:agentId/ingest-status`; actualizar estado/progreso; al recibir
  `indexed`/`empty`/`failed` → parar el interval y pintar el final (chunks / mensaje) **sin
  recargar la página**. Limpiar el interval al desmontar y al terminar. Timeout de guarda
  (~3 min) para no sondear indefinidamente.
- Reusar `emptyIngestMessage` y los estados finales ya existentes (`:96-118`).
- Nota: `KnowledgeTab` recibe hoy props del padre; el polling puede vivir en `KnowledgeTab`
  o en el hook/página que lo monta — elegir lo más limpio sin romper el contrato de props.

## §E. Tests

- **F1**: `ingestWebsite` llama `onProgress` con `(0,total)` y luego incremental hasta
  `(total,total)`; el service escribe `progress` en `initialIngest` (mock).
- **F2**: `GET ingest-status` devuelve `{status,progress,chunks}`; gate correcto; sin
  ingest → status neutro sin romper.
- **F3**: `front tsc` verde; con `status:"pending"`+progress pinta el %, la animación se
  monta; al pasar a `indexed` el polling para (test de que el interval se limpia).

Regla del repo: DONE con test verde (+ HITL visual del front).
