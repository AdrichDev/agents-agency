# Design — aa-rag-extraccion-estatica-honesta

## §A. Evidencia base (verificada)

- HTML real fpeuroformac.com: 582 KB, WordPress/Elementor, **no SPA**, ~25.451 chars de
  texto extraíbles con strip crudo. Fixture: `back/tests/fixtures/fpeuroformac-wordpress.html`.
- Extracción actual `web.ts:20-25`: `cheerio.load` → `.remove(script,style,nav,footer,
  header,noscript,svg,iframe)` → `$("main").text() || $("article").text() || $("body").text()`.
- Deps presentes (`back/package.json`): cheerio, mammoth, pdf-parse, unzipper, openai.
  **Ausentes**: readability, linkedom, jsdom.
- Embeddings: `text-embedding-3-small` dim 1536 (`embeddings.ts:4`); chunk maxLen 1000,
  filtro `<50` (`embeddings.ts:35-49`); vector nullable `KnowledgeChunk`/`fragmento_conocimiento`
  (`schema.prisma:202-213`).
- Status: `ecommerceConfig.initialIngest` JSON (`service.ts:294-316`), estados
  `pending|indexed|failed`, marca `indexed` sin validar chunks (`service.ts:244`). Solo
  cubre la web del wizard.
- Sources: `GET /api/knowledge/:agentId/sources` groupBy con conteo REAL (`knowledge.ts:151-165`).

## §B. F1 — Extracción robusta

**Estrategia: main-content extraction con fallback de recall alto.**

Opción recomendada: `@mozilla/readability` + `linkedom` (DOM ligero, JS puro, sin
binarios → OK en Render free). Pipeline nuevo en `web.ts`:

1. Parse HTML con linkedom → documento.
2. `Readability(doc).parse()` → `textContent` del contenido principal.
3. **Fallback de recall**: si el texto de readability es corto (< umbral, p.ej. 400
   chars) o vacío, usar extracción cheerio mejorada: quitar boilerplate
   (`script,style,noscript,svg,iframe,nav,footer,header,form,button` + selectores de
   menú/cookie comunes), tomar `$("body").text()`, colapsar whitespace, **deduplicar
   líneas repetidas** (los menús Elementor repiten banners: "¡Últimas plazas!" x4).
4. Normalizar (whitespace, entidades).

Alternativa sin dep nueva: heurística cheerio pura (el strip crudo ya dio 25k chars) con
dedup + limpieza. El builder elige; **preferir readability+linkedom por robustez** salvo
que el footprint moleste. Decisión documentada en tasks.md.

Criterio de éxito (test con fixture): del fixture WordPress se extraen **≥ 3.000 chars**
de contenido real y `chunkText` produce **≥ 5 chunks** (hoy: ~0).

## §C. F2 — Estado honesto

- Tras ingestar, el status se deriva del **conteo real** de chunks guardados:
  - `chunks > 0` → `indexed` (con `chunks`, `pages`).
  - `chunks == 0` → **`empty`** (nunca `indexed`) con `reason`:
    - `fetch_failed` / `timeout` (no se pudo descargar),
    - `no_readable_text` (se descargó pero no había texto legible → aquí sugerir "sube
      el PDF o pega el texto"; probable SPA real u HTML sin contenido).
- Ampliar `InitialIngestRecord` (`service.ts:294`) con estado `empty` + `reason`.
- **Manual**: aplicar la misma honestidad al re-indexado (`refreshInitialIngestStatus`) y
  al POST url. La ingesta de texto/ficheros ya produce chunks deterministas; su estado
  también debe reflejar 0 si el fichero salió vacío.
- **Front** (`KnowledgeTab.tsx:49-96`): pintar el nuevo estado `empty` en ámbar/rojo con
  el mensaje accionable según `reason` (no "Indexada ✓"). Mantener los 3 existentes.

**Data model**: NO se crea tabla `KnowledgeSource` en este hijo (el conteo real ya sale
del groupBy y el status del blob basta para la honestidad). Se anota como follow-up si en
el futuro se quiere status por-fuente de primer nivel.

## §D. F3 — Fetch robusto

- `DEFAULT_FETCH_TIMEOUT_MS` (`web.ts:6`): subir a ~20-25s o parametrizar; una web de
  582 KB en 10s puede fallar.
- `ingestWebsite` (`web.ts:55-80`): dejar de tragar el error por página en silencio;
  acumular el motivo del fallo y propagarlo al status (F2). Mantener el `slice(0,9)` de
  páginas pero contar páginas con contenido real (chunks>0), no solo intentadas.

## §E. F4 — Filtro de chunks

- `chunkText` filtro `<50` (`embeddings.ts:48`): bajar umbral (p.ej. 25) o no descartar
  si dejaría 0 chunks habiendo texto. No perder el único contenido útil.
- Mantener maxLen 1000 y el split por párrafos.

## §F. F5 — RAG visible (verificación)

Nuevo endpoint operador (gate como el resto de rutas de agente del tenant):
`POST /api/knowledge/:agentId/search` body `{ query, k? }` → reusa `searchKnowledge`
(`embeddings.ts:22`) → devuelve `[{ source, snippet (content ≤200), similarity }]` con
`similarity = round((1-distance)*100)`. Para que el operador (y la consola H1) confirmen:
"con esta pregunta, ¿qué recupera el agente?".

(Opcional, si es barato) exponer el contenido de chunks por fuente para inspección, o
dejarlo al endpoint de search. No listar todo el corpus por defecto (coste).

## §G. Tests (vitest — AA)

- **F1**: dado el fixture WordPress → el extractor devuelve ≥3.000 chars y `chunkText`
  ≥5 chunks. Dedup: banners repetidos no se cuentan N veces.
- **F1 regresión**: extracción de un HTML de artículo simple sigue funcionando;
  ingesta de texto pegado y de ficheros (PDF/docx) **no cambia** (regresión cero).
- **F2**: ingest que resulta en 0 chunks → status `empty` + `reason` (nunca `indexed`);
  ingest con chunks → `indexed`. Front pinta `empty` con mensaje.
- **F3**: timeout/fetch fail → status `empty` reason `fetch_failed`/`timeout`, no silencio.
- **F4**: `chunkText` con texto de 30-49 chars ya no se pierde íntegro si es el único
  contenido.
- **F5**: `POST /api/knowledge/:agentId/search` devuelve fuente+snippet+similarity;
  gate correcto; sin knowledge → lista vacía, no error.

Regla del repo: DONE solo con test verde.
