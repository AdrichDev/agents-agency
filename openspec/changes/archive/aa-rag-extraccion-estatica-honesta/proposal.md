# Proposal — aa-rag-extraccion-estatica-honesta

Hijo H2 del plan maestro `aa-agentes-rediseno-operativo` (P0, fundamento).
**Reencuadrado**: el título original era "render-js-estado-honesto" partiendo de que
fpeuroformac.com era una SPA. **Verificado con evidencia: es FALSO.**

## Descubrimiento clave (verificado, no asumido)

`curl` del HTML real de fpeuroformac.com:
- **582 KB de HTML servido**, WordPress + Elementor (190 `wp-content`, 5299 `elementor`,
  4 `<article>`), **cero marcadores SPA** (0 `__NEXT_DATA__`, 0 `id="root"`, 0 react/next).
- Un strip crudo (quitar script/style, quitar tags) extrae **25.451 caracteres de texto
  español real** (cursos, títulos, descripciones).

El contenido **SÍ está en el HTML**. El "0 chunks" NO es un problema de JS/SPA. Por
tanto: **NO se necesita Chromium, ni navegador headless, ni servicio de render de pago.**
Se arregla por código, gratis. (Fixture hermético guardado:
`back/tests/fixtures/fpeuroformac-wordpress.html`.)

## Problema real (causa raíz, `file:line`)

1. **Extracción pobre** — `htmlToText` (`web.ts:20-25`) hace cascada ingenua
   `$("main").text() || $("article").text() || $("body").text()`. En WordPress/Elementor
   el grueso del texto vive en `<div>` con clases elementor, NO en `<main>` (0) ni en un
   `<article>` limpio; la cascada coge un teaser pequeño o poco y pierde los 25k chars.
2. **Estado que miente** — `service.ts:244` marca `status:"indexed"` sin comprobar
   `chunks>0`. El usuario ve "Indexada ✓ (0 chunks)".
3. **Errores tragados** — `ingestWebsite` (`web.ts:74`) hace `catch {}` por página; un
   timeout (10s, `web.ts:6`) en una web pesada de 582 KB se traga en silencio → 0 chunks
   + status "indexed" falso, sin motivo registrado.
4. **Filtro ciego** — `chunkText` descarta chunks `<50 chars` (`embeddings.ts:48`);
   agrava cuando ya queda poco.
5. **RAG invisible** — no hay endpoint HTTP que muestre qué chunks tiene un agente ni qué
   recupera una query (`searchKnowledge` existe en `embeddings.ts:22` pero solo lo usa la
   tool del agente, `executor.ts:159`). El operador no puede verificar que el RAG funciona.

## Scope

- **F1 Extracción robusta (código, gratis):** reemplazar la cascada ingenua por un
  extractor de contenido principal real (readability + DOM ligero, o heurística cheerio
  mejorada). Objetivo: del fixture WordPress recuperar la mayoría de los ~25k chars →
  múltiples chunks reales. Dedup de nav/boilerplate repetido.
- **F2 Estado honesto:** el status refleja el nº REAL de chunks. 0 chunks → NO "indexed";
  estado `empty`/`no_content` con motivo (`no_readable_text` | `fetch_failed` |
  `timeout`). Registrar el motivo en vez de tragarlo. Aplicar también a re-indexado manual.
- **F3 Robustez de fetch:** subir/parametrizar el timeout para páginas grandes; no tragar
  el error — propagar el motivo al estado.
- **F4 Filtro de chunks:** revisar el `<50` (bajar el umbral o no descartar si es el único
  contenido); no perder texto útil.
- **F5 RAG visible:** endpoint operador `GET/POST /api/knowledge/:agentId/search` que
  devuelve lo que `searchKnowledge` recuperaría (fuente + snippet + % similitud), para que
  el operador (y la consola H1) verifiquen el RAG.

## Fuera de scope (follow-up)

- **Render de JS para SPAs de verdad** (React/Vue con shell vacío): edge-case real pero
  raro para PYMEs. Cubierto por el fallback honesto ("sube el PDF / pega el texto"). Si
  hiciera falta, sería un provider externo tras env flag — otro hijo, no aquí.
- Tabla `KnowledgeSource` con status por fuente de primer nivel (hoy el estado vive en el
  blob `ecommerceConfig.initialIngest` y el conteo real ya sale del groupBy de
  `knowledge.ts:151`). Evaluar en design; preferir lo mínimo honesto sin sobre-construir.

## Risks

- **Nueva dependencia de extracción** (readability/linkedom): ligera, JS puro, compatible
  con Render `node:22-slim` free (sin binarios nativos). Verificar footprint.
- **Cambio en hot-path de ingest**: no romper la ingesta de texto/ficheros (PDF/docx/zip)
  que YA funciona (`file.ts:22`). Regresión cero en esos caminos.

## Dependencies

- `back/src/lib/scraper/web.ts` (fetch + htmlToText + ingestWebsite), `embeddings.ts`
  (chunkText/searchKnowledge), `back/src/lib/agent/service.ts` (status initialIngest),
  `back/src/routes/knowledge.ts` (endpoints), `front/components/agents/KnowledgeTab.tsx`.
- Fixture: `back/tests/fixtures/fpeuroformac-wordpress.html`.
