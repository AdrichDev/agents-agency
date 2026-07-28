# Validation — aa-rag-extraccion-estatica-honesta

## User story

Como operador que da conocimiento a un agente, quiero que al indexar la web del negocio
se extraiga de verdad el contenido (aunque sea WordPress/Elementor/estática) y que, si no
se puede leer, el sistema me lo diga con claridad y me proponga alternativa (subir PDF /
pegar texto), en vez de mentirme con "Indexada ✓ (0 chunks)". Y quiero poder comprobar
qué recupera el agente ante una pregunta.

## Acceptance criteria

- **AC1**: Del HTML real de fpeuroformac.com (fixture WordPress) la extracción recupera
  el contenido (≥3.000 chars) y produce ≥5 chunks reales — hoy da ~0. Sin render JS, sin
  navegador headless, sin servicio externo.
- **AC2**: El estado NUNCA es `indexed` con 0 chunks. 0 chunks → `empty` con `reason`
  (`no_readable_text`|`fetch_failed`|`timeout`). El front pinta ese estado con mensaje
  accionable.
- **AC3**: Los errores de fetch/timeout dejan de tragarse en silencio; el motivo llega al
  estado. Timeout subido para webs grandes.
- **AC4**: El filtro de chunks no descarta el único contenido útil por el umbral `<50`.
- **AC5**: `POST /api/knowledge/:agentId/search` devuelve fuente + snippet + % de
  similitud de lo que recuperaría el agente; gated por tenant; sin knowledge → [] sin error.
- **AC6 (regresión cero)**: la ingesta de texto pegado y de ficheros (PDF/docx/txt/zip)
  sigue funcionando igual; extracción de HTML de artículo simple no empeora.

## Given-When-Then

**Escenario 1 (AC1 — el bug real):**
Given el fixture WordPress de fpeuroformac.com (582 KB, no SPA)
When se pasa por el nuevo extractor + `chunkText`
Then se obtienen ≥3.000 chars y ≥5 chunks (antes: 0), con banners repetidos deduplicados.

**Escenario 2 (AC2 — honestidad):**
Given una web que se descarga pero no deja texto legible
When termina el ingest
Then el estado es `empty` con `reason: no_readable_text` (jamás `indexed`), y el front
muestra "esta web no expone texto legible; sube el PDF o pega el texto".

**Escenario 3 (AC3 — no más silencio):**
Given una web que excede el timeout
When falla la descarga
Then el estado es `empty` con `reason: timeout`, no un `indexed` falso.

**Escenario 4 (AC5 — RAG visible):**
Given un agente con conocimiento indexado
When el operador consulta `POST /api/knowledge/:agentId/search` con una pregunta
Then recibe las fuentes + snippets + % de similitud que el agente usaría.

## Test por tarea
- T1.1 → fixture WordPress ≥3.000 chars / ≥5 chunks + dedup.
- T1.2 → regresión artículo simple + ficheros/texto.
- T2.1 → 0 chunks→empty+reason; >0→indexed. T2.2 → front pinta empty.
- T3.1 → timeout/fetch-fail→empty+reason, sin silencio.
- T4.1 → texto 30-49 chars único no se pierde.
- T5.1 → search devuelve fuente+snippet+similarity, gated, []-safe.

Regla del repo: DONE solo con test verde; sin spec, revertido.
