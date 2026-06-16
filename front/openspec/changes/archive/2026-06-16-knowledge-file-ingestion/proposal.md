# Proposal: Knowledge Base File Ingestion

## Intent

Today an agent's RAG knowledge base is fed only via URL scraping or pasted text (`POST /api/knowledge`, JSON, 2mb limit). Users with existing documentation (PDFs, Word docs, exports) must copy-paste content manually — slow, lossy, and impossible for binary formats. This change lets users upload loose document files and `.zip` bundles directly in the agent "conocimiento" tab, parsing them to text and feeding the existing embedding pipeline. Channel target: none (RAG knowledge base, cross-channel).

## Scope

### In Scope
- New endpoint `POST /api/knowledge/:agentId/files` (multipart) accepting multiple files.
- Loose file parsing by extension: `pdf`, `docx`, `txt`, `md`, `html`, `csv`.
- `.zip` extraction: process supported entries inside, skip unsupported ones.
- Reuse pipeline as-is: `chunkText()` → `embed()` → `saveChunkWithDuplicatePolicy(agentId, filename, chunk, policy)`. `source` = filename.
- Frontend multi-file upload UI with progress in the "conocimiento" tab (`front/app/agents/[id]/page.tsx`), using raw `fetch()` + `FormData` + `credentials:'include'`.
- Per-file success/skip/error reporting in the response.

### Out of Scope / Deferred
- **`.rar` extraction — DEFERRED to a future change** (uncommon, `node-unrar-js` is experimental WASM ~3MB).
- Other archives (`.7z`, `.tar.gz`), images/OCR, audio/video transcription.
- Schema changes (none needed — `KnowledgeChunk` already has `source`/`content`/`embedding`).
- Async/queued ingestion; this delivery is synchronous request-scoped.
- Changing the existing URL/text ingestion path or its 2mb JSON limit.

## Capabilities

### New Capabilities
- `knowledge-ingestion`: agent RAG knowledge base ingestion — covers the existing URL/text intake and the new file/zip upload intake, duplicate policy, and supported-format contract.

### Modified Capabilities
- None.

## Approach

multer `memoryStorage` mounted ONLY on the new route (no global `express.json` impact — multer intercepts multipart first). New module `back/src/lib/scraper/file.ts` dispatches a buffer by extension to a parser, returning text; `.html` reuses the existing cheerio `htmlToText()`; `txt`/`md`/`csv` use `Buffer.toString('utf8')`; `pdf-parse` and `mammoth` handle binary. `.zip` entries are read via `unzipper`, filtered by extension allowlist, and each yields text. Route loops chunks through the existing duplicate-policy save, gated by `heavyLimiter`, processing files sequentially.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `back/src/routes/knowledge.ts` | Modified | Add `POST /:agentId/files` multipart route |
| `back/src/lib/scraper/file.ts` | New | Extension dispatch + parsers + zip extractor |
| `back/package.json` | Modified | Add `multer`, `@types/multer`, `pdf-parse`, `mammoth`, `unzipper` |
| `back/tests/file-parsers.test.ts` | New | Unit tests per parser + zip filtering |
| `front/app/agents/[id]/page.tsx` | Modified | Multi-file upload + progress UI |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Zip bomb | Med | Cap total uncompressed size (~50MB) + entry count (~200); skip on breach |
| Path traversal in zip | Med | `path.basename` on entries; never write to disk (memoryStorage) |
| Unsupported types | High | Extension allowlist; skip in zip, `422` for direct upload |
| Embedding timeout on large files | Med | `heavyLimiter`, sequential processing, `fileSize` 20MB / `files` 10 limits |
| Memory spike | Low | memoryStorage + 20MB cap; sequential file handling |
| Frontend `api()` forces JSON Content-Type | High | Use raw `fetch()` with `FormData`, omit Content-Type header |

## Rollback Plan

Pure additive change. To revert: remove the `POST /:agentId/files` route, delete `back/src/lib/scraper/file.ts`, uninstall the four new deps, and remove the upload UI block. No schema migration to undo. Existing URL/text ingestion is untouched.

## Dependencies

- New npm deps: `multer`, `@types/multer`, `pdf-parse`, `mammoth`, `unzipper`.
- Existing: `embeddings.ts`, `knowledge-duplicates.ts`, cheerio `htmlToText()`, `heavyLimiter`.

## Success Criteria

- [ ] Uploading pdf/docx/txt/md/html/csv creates `KnowledgeChunk` rows with `source`=filename.
- [ ] A `.zip` ingests supported entries and skips unsupported ones with a per-entry report.
- [ ] Unsupported direct uploads return `422`; oversized/over-count uploads are rejected.
- [ ] No regression on existing URL/text ingestion.
- [ ] Frontend shows per-file progress and success/skip/error outcome.
