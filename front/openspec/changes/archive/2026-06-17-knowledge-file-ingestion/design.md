# Design: Knowledge Base File Ingestion

## Technical Approach
Add a multipart upload path alongside the existing JSON intake. A new `POST /api/knowledge/:agentId/files` route (back/src/routes/knowledge.ts) uses multer memoryStorage to receive up to 10 files (20MB each), gated by the existing `heavyLimiter`. A new pure module `back/src/lib/scraper/file.ts` exposes `parseFile(filename, buffer)` that dispatches by extension to a text extractor and returns an array of `{source,text}` (a .zip expands into many sources). The route then reuses the unchanged indexing pipeline: `chunkText()` -> `saveChunkWithDuplicatePolicy(agentId, source, chunk, policy)` per chunk, aggregating counts. No schema change (project uses `prisma db push`; KnowledgeChunk already has source/content/embedding).

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Transport | multer memoryStorage on new route only | base64-in-JSON (landing pattern); global multer | base64 inflates >2mb JSON cap; memoryStorage avoids disk writes (path-traversal safe). Multer intercepts multipart before global `express.json` (index.ts:81) — no conflict. |
| Parser shape | `parseFile()->{source,text}[]` array | single string return | zip yields N entries -> N sources; array unifies loose-file and zip handling. |
| Indexing | reuse `chunkText`+`saveChunkWithDuplicatePolicy` loop | new bulk insert | identical to existing text/url path (knowledge.ts:21-31, web.ts:66-77); zero pipeline risk. |
| Sync vs async | synchronous request-scoped now | queue/worker | matches current code; deferred per proposal. Bounded by 20MB/10-file/heavyLimiter. Async tracked as Open Question. |
| Frontend transport | raw `fetch()`+FormData+`credentials:'include'` | api() helper | api() hardcodes `Content-Type: application/json` (lib/api.ts:19), breaking FormData boundary. |

## Data Flow
    [browser multi-file input] --FormData(raw fetch)--> POST /api/knowledge/:agentId/files
        -> heavyLimiter -> multer.array (memoryStorage, fileSize 20MB, files 10)
        -> for each file: parseFile(name, buffer) -> {source,text}[]
             (.zip -> unzipper entries -> per-entry {source,text})
        -> for each {source,text}: chunkText() -> per chunk saveChunkWithDuplicatePolicy(agentId, source, chunk, policy)
        -> aggregate {file, source, saved, duplicates, skipped|error}[]
        -> JSON response -> frontend refresh loadSources()+load()

## File Changes
| File | Action | Description |
|---|---|---|
| back/src/routes/knowledge.ts | Modify | Add `POST /:agentId/files` w/ heavyLimiter + multer.array("files"); validate `agentId` param; derive policy from `overwriteDuplicates` (true->overwrite,false->suffix,undef->ask) mirroring lines 17-18; loop parseFile->chunk->save; return per-file report. |
| back/src/lib/scraper/file.ts | Create | `parseFile(filename,buffer):Promise<{source,text}[]>`; extension dispatch (lowercased); zip extractor w/ budget+cap guards. |
| back/package.json | Modify | Add deps: multer, pdf-parse, mammoth, unzipper; devDeps: @types/multer (and @types/unzipper if needed). |
| back/tests/file-parsers.test.ts | Create | Unit tests: dispatch per extension, zip multi-entry expansion, unsupported skip, budget/entry-cap breach. |
| front/app/agents/[id]/page.tsx | Modify | conocimiento tab: multi `<input type=file accept=...>`; raw fetch upload; per-file progress/status; on done refresh loadSources()+load(). |

## Interfaces / Contracts
```ts
// back/src/lib/scraper/file.ts
export async function parseFile(
  filename: string,
  buffer: Buffer
): Promise<{ source: string; text: string }[]>;
// Dispatch (lowercased ext): pdf->pdf-parse; docx->mammoth.extractRawText;
// html/htm->htmlToText() (reuse scraper/web.ts:20); txt/md/csv->buffer.toString('utf8');
// zip->iterate unzipper entries (recurse non-zip parse); unsupported->throw/skip.
```
Route response: `{ results: { file, source, saved, duplicates, skipped?, error? }[], requiresConfirmation }`.
Accept attr: `.pdf,.docx,.txt,.md,.html,.htm,.csv,.zip`.

## Zip-bomb / Path-traversal Mitigations (concrete)
- memoryStorage only — nothing written to disk, so traversal cannot escape FS.
- Entry source name = `path.basename(entry.path)` — strips any `../` or absolute components.
- Skip directory entries and entries whose lowercased ext is not in the allowlist (no nested .zip recursion beyond top level — treat nested zip as unsupported to bound work).
- Running uncompressed byte budget ~50MB across all entries; increment as each entry buffers; throw `HttpError(413/422)` and abort the whole upload if exceeded.
- Entry count cap ~200; abort with HttpError on breach.
- Per-file 20MB enforced by multer `limits.fileSize`; >10 files rejected by multer `limits.files` -> map multer error to HttpError.

## Error Handling
- Keep `asyncHandler` + `HttpError` pattern (http.ts).
- Missing `agentId` param -> `HttpError(400)`.
- Unsupported direct-upload extension -> `HttpError(422)`.
- Unsupported entries inside zip -> skip, report in per-entry `skipped`.
- multer LIMIT_FILE_SIZE / LIMIT_FILE_COUNT -> caught and mapped to HttpError (413/400).
- Per-file parse failure -> capture in results[].error, continue other files (mirrors web.ts try/catch:67-76).

## Sequencing / Timeout
- Files and chunks processed sequentially (one embed call per chunk via saveChunk -> embed). Worst case 10x20MB -> many chunks -> long request. Bounded by heavyLimiter (10/min) + size/count caps.
- Recommendation: ship synchronous now; defer async/queued ingestion (Open Question) if real-world latency exceeds proxy/gateway timeout.

## Testing Strategy
| Layer | What | Approach |
|---|---|---|
| Unit | parseFile dispatch per ext, utf8 decode, html->text | vitest pure-function tests (back/tests) with small fixture buffers |
| Unit | zip multi-entry expansion + unsupported skip + basename | build in-memory zip, assert {source,text}[] and skips |
| Unit | budget/entry-cap breach | oversized synthetic zip -> expect throw |
| Integration (manual/deferred) | route + multer limits | not auto per existing test pattern (pure-fn focus) |

## Migration / Rollout
No migration required. Pure additive (no schema, `prisma db push` only). Rollback: remove route + file.ts, uninstall deps, remove UI.

## Open Questions
- [ ] Async/queued ingestion if synchronous latency exceeds gateway timeout for max-size uploads (deferred per proposal).
- [ ] Exact HTTP code for over-size/over-count (413 vs 422) — pick on impl.
- [ ] Nested .zip: confirmed treated as unsupported/skip to bound work.
