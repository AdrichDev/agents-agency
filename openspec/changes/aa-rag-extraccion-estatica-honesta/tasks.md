# Tasks — aa-rag-extraccion-estatica-honesta

Tests **vitest** (AA back) + front `tsc`. DONE solo con test verde. Fixture hermético:
`back/tests/fixtures/fpeuroformac-wordpress.html`.

## F1 — Extracción robusta

- [x] **T1.1 — Extractor de contenido principal.** Reemplazada la cascada
  `main||article||body` de `htmlToText` (`web.ts`).
  **Opción elegida: `@mozilla/readability` + `linkedom` (DOM ligero JS puro, sin binarios
  nativos → OK Render free) CON fallback de recall alto cheerio.** Selección corregida
  (fix sdd-verify CRITICAL): **prima Readability (contenido LIMPIO) salvo que la extracción
  esté degradada** — o bien Readability < `READABILITY_MIN_CHARS` (400, suelo load-bearing),
  o bien el fallback cheerio la dobla en tamaño (`FALLBACK_DOMINANCE_FACTOR = 2`), señal de
  que Readability perdió el cuerpo (maquetadores tipo Elementor). Solo entonces se cede al
  texto de mayor recall. La regla anterior "el más largo" contaminaba el RAG: en un
  WordPress normal (sidebar `<aside class="widget-area">` con "Entradas recientes"/
  "Categorías" + `<div id="comments">` fuera de nav/footer/header) Readability daba ~1.212
  chars LIMPIOS y cheerio ~1.669 SUCIOS → elegía el sucio. La heurística cheerio
  (quita script/style/noscript/svg/iframe/nav/footer/header/form/button + cookies, inserta
  saltos en límites de bloque, colapsa whitespace y **deduplica líneas repetidas** — los
  banners Elementor se repiten x4).
  - Fixture Elementor: Readability 1.239 vs cheerio 5.646 → 5.646 > 2·1.239 (2.478) →
    degradada → usa cheerio (recall). Artículo WordPress normal: 736 vs 974 → 974 ≤ 2·736
    (1.472) y 736 ≥ 400 → NO degradada → usa Readability LIMPIO.
  - Test verde (`tests/web-extraction.test.ts`): del fixture WordPress/Elementor → **5.646
    chars** (≥3.000); `chunkText` → **6 chunks** (≥5); líneas repetidas deduplicadas.
  - **Test de regresión nuevo (F1.3)**: WordPress normal con sidebar + comentarios NO
    envueltos en nav/footer/header → el output INCLUYE el cuerpo del artículo y EXCLUYE
    "Entradas recientes"/"Categorías" y el texto del comentario ("Excelente articulo").
    Verificado empíricamente: FALLA con la lógica vieja "más largo" (2 asserts rojos:
    widgets + comentario), PASA con el fix.
- [x] **T1.2 — Regresión de extracción.** Artículo HTML simple sigue extrayendo bien y no
  arrastra header/footer (`tests/web-extraction.test.ts`). Parseo de ficheros (`file.ts`)
  intacto: solo la rama html/htm usa `htmlToText`; txt/md/csv/pdf/docx/zip sin cambios.
  Suite completa verde (976 passed / 3 skipped, 0 fail).

## F2 — Estado honesto

- [x] **T2.1 — Status por conteo real.** `InitialIngestRecord` (`service.ts`) gana estado
  `empty` + `reason` (`no_readable_text|fetch_failed|timeout`, tipo `IngestReason` exportado
  desde `web.ts`). Auto-ingest en background (`service.ts` ~L244) y `refreshInitialIngestStatus`
  derivan del conteo real: `chunks>0`→indexed, `==0`→empty+reason. Nunca `indexed` con 0.
  - Test verde (`tests/initial-ingest-honest-status.test.ts` + `ingest-website-status.test.ts`):
    0 chunks→`empty`+reason (jamás indexed); >0→indexed; reason por defecto `no_readable_text`.
- [x] **T2.2 — Front estado empty.** `KnowledgeTab.tsx:49-96` pinta `empty` (ámbar/rojo)
  con mensaje accionable según `reason` ("esta web no expone texto legible; sube el PDF o
  pega el texto"). Mantener pending/indexed/failed.
  - Test: `front npx tsc --noEmit` verde; render del estado empty con su mensaje.
  - Hecho: tipo `initialIngest.status` ampliado con `"empty"` + `reason?: "no_readable_text"
    | "fetch_failed" | "timeout"` (lectura defensiva, opcional). Label "Sin contenido ⚠"
    ámbar + mensaje accionable por-reason bajo la URL. CTA "📎 Subir contenido" reutiliza
    `fileInputRef` existente (abre el picker nativo, sin flujo nuevo). `front npx tsc
    --noEmit` verde.

## F3 — Fetch robusto

- [x] **T3.1 — Timeout + no tragar errores.** `DEFAULT_FETCH_TIMEOUT_MS` subido a **25s**
  (parametrizable por arg). `ingestWebsite` deja de hacer `catch {}` mudo: acumula el motivo
  por página, clasifica timeout/abort vs fetch_failed y lo propaga vía `reason` cuando
  `chunks===0`. Cuenta páginas con contenido real (`pages`=pagesWithContent, `pagesAttempted`
  aparte).
  - Test verde (`tests/ingest-website-status.test.ts`): timeout→reason `timeout`;
    HTTP fail→`fetch_failed`; body sin texto→`no_readable_text`; sin silencio.

## F4 — Filtro de chunks

- [x] **T4.1 — Umbral del filtro.** `embeddings.ts`: umbral bajado de `>50` a `>=25`
  (const `MIN_CHUNK_CHARS`). Mantiene maxLen 1000 + split por párrafos. Opción elegida:
  bajar umbral (no la variante "keep-if-zero") para no romper la regresión existente
  `chunkText("hola")→[]`.
  - Test verde (`tests/web-extraction.test.ts`): texto de 33 chars único → 1 chunk (antes
    descartado); trivial `<25` sigue fuera.

## F5 — RAG visible

- [x] **T5.1 — Endpoint search.** `POST /api/knowledge/:agentId/search` añadido a
  `routes/knowledge.ts`; body `{query, k?}` (k acotado a [1,20], default 5); reusa
  `searchKnowledge`; devuelve `{results:[{source, snippet≤200, similarity=round((1-dist)*100)}]}`.
  Gate: hereda el gate central de `/api` (sesión); NO está en la allowlist pública.
  - Test verde (`tests/knowledge-search.test.ts`): fuente+snippet+similarity (90/60);
    `isPublic` false; sin knowledge→[] status 200; query ausente→400.

## Verificaciones finales

- [ ] **T6.1 — Typecheck + suite** (`back` vitest + tsc, `front` tsc) verde.
- [ ] **T6.2 — Prueba real (HITL):** re-indexar fpeuroformac.com desde la tab Conocimiento
  → ver chunks > 0 y estado honesto; probar el endpoint search.
- [ ] **T6.3 — sec-review:** el extractor no ejecuta JS/remoto (SSRF sigue vía
  `safeFetch`); endpoint search gated; no fuga de contenido de otros tenants.
- [ ] **T6.4 — Engram:** persistir el hallazgo (NO era SPA; fix por código; readability).

## Follow-ups (fuera de scope)
- Render de JS para SPAs reales (provider externo tras env flag) — otro hijo.
- Tabla `KnowledgeSource` con status por-fuente de primer nivel.
- Re-crawl programado / detección de cambios en la web.
