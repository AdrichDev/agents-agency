# Tasks: Knowledge Base File Ingestion

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 350–480 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (backend: deps + file.ts + route + tests) → PR 2 (frontend: UI + wiring) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Backend: deps, parser lib, route, unit tests | PR 1 | base = main; self-contained; testable in isolation |
| 2 | Frontend: file input UI + raw fetch wiring | PR 2 | base = main (after PR 1 merged); depends on PR 1 route existing |

---

## Phase 1: Backend Dependencies

- [x] 1.1 Add `multer`, `pdf-parse`, `mammoth`, `unzipper` to `dependencies` in `back/package.json`. Add `@types/multer` (and `@types/pdf-parse` if needed) to `devDependencies`. Run `npm install` in `back/`. Acceptance: `npm run typecheck` passes with no missing-module errors for these packages.

---

## Phase 2: Core Parser Module

- [x] 2.1 Create `back/src/lib/scraper/file.ts`. Export `parseFile(filename: string, buffer: Buffer): Promise<{ source: string; text: string }[]>`. Dispatch by lowercased extension: `pdf` → `pdf-parse`; `docx` → `mammoth.extractRawText`; `html`/`htm` → import and call `htmlToText` from `./web.ts`; `txt`/`md`/`csv` → `buffer.toString('utf8')`; `zip` → zip extractor branch (task 2.2); any other ext → throw with message used by route to emit 422. Source name = `path.basename(filename)`. Acceptance: unit tests in task 4.x all pass.

- [x] 2.2 Implement zip extraction inside `file.ts` (private helper). Use `unzipper.Open.buffer()`. Iterate entries sequentially; skip directory entries; skip nested `.zip` entries (treat as unsupported); sanitize entry source = `path.basename(entry.path)`. Track running uncompressed byte budget (cap 50 MB) and entry count (cap 200); on breach throw `HttpError(413, "Zip excede límite de tamaño/entradas")` before any entry result is returned (atomic: no partial saves). Skip entries whose lowercased ext is not in the allowlist (pdf/docx/txt/md/html/htm/csv); collect `{ source, text }[]` for supported entries. Acceptance: zip tests in task 4.x assert multi-entry expansion, unsupported skips, budget breach throws with no partial output.

---

## Phase 3: Route Integration

- [x] 3.1 Add `POST /:agentId/files` handler to `back/src/routes/knowledge.ts`. Mount `heavyLimiter` (imported from `@/lib/limiters`) then `multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 10 } }).array("files")` as middleware on this route only — no global multer. Validate `agentId` param; throw `HttpError(400)` if absent. Derive `duplicatePolicy` from form field `overwriteDuplicates`: `"true"` → `"overwrite"`, `"false"` → `"suffix"`, absent/other → `"ask"` (mirrors knowledge.ts lines 17–18). Catch multer `LIMIT_FILE_SIZE` → `HttpError(413)`; `LIMIT_FILE_COUNT` → `HttpError(400)`. Acceptance: route is reachable at `POST /api/knowledge/:agentId/files`; existing JSON route `POST /api/knowledge` unaffected (confirmed by existing tests passing).

- [x] 3.2 Implement per-file processing loop inside the route handler. For each uploaded file: call `parseFile(file.originalname, file.buffer)`; on unsupported-ext throw from `parseFile` → catch → append `{ source: path.basename(file.originalname), chunks: 0, note: "Tipo no soportado: .<ext>" }` to results and continue. For each `{ source, text }` entry from `parseFile`: call `chunkText(text)`, then loop chunks calling `saveChunkWithDuplicatePolicy(agentId, source, chunk, duplicatePolicy)`; tally `saved` and `duplicates`. Append `{ source, chunks: saved, duplicates }` to results. On per-file parse failure (non-422): catch and append with `chunks: 0, note: error.message`. Respond `{ files: results, requiresConfirmation: results.some(r => r.duplicates > 0 && policy === "ask") }`. Acceptance: spec scenario "multi-file mixed" returns one entry per file; "single file failure does not fail request" verified.

---

## Phase 4: Unit Tests

- [x] 4.1 Create `back/tests/file-parsers.test.ts`. Test `parseFile` dispatch: pass a minimal valid PDF buffer → assert returns `[{ source: "file.pdf", text: <non-empty string> }]`; pass a plain text buffer with `.txt` ext → assert `[{ source, text }]` with correct text. Acceptance: `npm test` green for these cases.

- [x] 4.2 Add test: `parseFile` with `.docx` fixture buffer (minimal mammoth-valid docx) → returns `[{ source, text }]`. Acceptance: mammoth integration works.

- [x] 4.3 Add test: `parseFile` with unsupported ext (`.exe`) → throws (or returns empty / error that route converts to 422). Confirm the exact throw shape matches route catch logic. Acceptance: route task 3.2 catch branch fires correctly.

- [x] 4.4 Add test: empty `.txt` buffer → `parseFile` returns `[{ source, text: "" }]` (no throw); route produces `chunks: 0`. Acceptance: empty file does not crash.

- [x] 4.5 Add test: in-memory zip containing two `.txt` entries + one `.exe` entry (unsupported) → `parseFile` returns 2 entries, `.exe` skipped. Acceptance: unsupported entries inside zip are silently skipped.

- [x] 4.6 Add test: zip with byte budget exceeded (synthetic oversized uncompressed content) → `parseFile` throws `HttpError(413)` before returning any result. Acceptance: atomic behavior — no partial `{ source, text }` array returned on breach.

- [x] 4.7 Add test: zip with entry count > 200 → throws `HttpError(413)` on entry 201 before processing. Acceptance: entry-cap guard fires.

- [x] 4.8 Add test: zip containing a nested `.zip` entry → that entry is skipped (treated as unsupported), outer zip entries still processed. Acceptance: no recursion into nested zip.

---

## Phase 5: Frontend UI

- [x] 5.1 In `front/app/agents/[id]/page.tsx`, inside the `conocimiento` tab block (after the existing URL input), add a file input section: `<input type="file" multiple accept=".pdf,.docx,.txt,.md,.html,.htm,.csv,.zip" />` with a state variable `fileList` (`FileList | null`). Add an "Subir archivos" button disabled when `fileList` is empty or null. Acceptance: file picker opens, multiple files selectable, button disabled state correct.

- [x] 5.2 Implement `uploadFiles()` async function. Build a `FormData` with `files` key for each `File` in `fileList`; append `overwriteDuplicates` field as string if a prior confirmation dialog resolved to a boolean. Use raw `fetch(\`/api/knowledge/${id}/files\`, { method: "POST", body: formData, credentials: "include" })` — no manual `Content-Type` header, do NOT use `api()` helper. Parse JSON response. Acceptance: network request goes out as `multipart/form-data`; backend receives files.

- [x] 5.3 Add per-file status display. After `uploadFiles()` resolves, store `fileResults` state (`{ source, chunks, duplicates, note? }[]`). Render a list under the file input showing each file's `source`, `chunks` count, and `note` if present. On `requiresConfirmation: true` (policy was `ask` and duplicates exist), call existing `confirm()` dialog and re-POST with `overwriteDuplicates` set. On done (final response), call `loadSources()` and `load()` to refresh. Acceptance: spec scenario "per-file status shown"; sources list refreshes after upload.

- [x] 5.4 Reset `fileList` state and clear the file input ref after a successful upload completes. Acceptance: file input clears; user can start a new upload without page reload.

---

## Phase 6: Manual Verification

- [ ] 6.1 Verify happy path: upload one PDF via the UI → sources list shows new entry with correct chunk count; backend logs show no disk writes.

- [ ] 6.2 Verify multi-file: upload PDF + TXT + DOCX in one request → three entries in sources list; no cross-contamination of source names.

- [ ] 6.3 Verify zip: upload a zip with 3 txt files → 3 source entries created; zip itself not listed as a source.

- [ ] 6.4 Verify zip safety: upload a zip exceeding 50 MB uncompressed → 413 response; no sources created; existing sources unaffected.

- [ ] 6.5 Verify unsupported type: upload `.exe` file directly → 422 response; UI shows error note; no sources created.

- [ ] 6.6 Verify duplicate policy: upload same file twice with `overwriteDuplicates` absent → `requiresConfirmation: true` on second upload; confirm dialog appears; re-POST with `overwriteDuplicates=true` → chunks overwritten.

- [ ] 6.7 Verify existing JSON route: `POST /api/knowledge` with `{ agentId, url }` still works normally after changes — no regression.
