# knowledge-ingestion Specification

## Purpose

Describes the agent RAG knowledge base ingestion contract: supported intake channels
(URL/text and file/zip upload), the format allowlist, duplicate policy, zip safety
limits, and per-file response shape. All requirements apply to the backend API; the
frontend upload UI requirements are noted separately.

---

## Requirements

### Requirement: File Upload Endpoint

The system MUST expose `POST /api/knowledge/:agentId/files` as a multipart/form-data
endpoint. It MUST use multer `memoryStorage` (no disk writes). It MUST enforce:
`fileSize` ≤ 20 MB per file and `files` ≤ 10 per request. It MUST be gated by
`heavyLimiter`. It MUST NOT affect the existing `POST /api/knowledge` JSON route.

#### Scenario: Happy path — single PDF upload

- GIVEN a valid `agentId` and a PDF file ≤ 20 MB
- WHEN the client POSTs to `/api/knowledge/:agentId/files` with `multipart/form-data`
- THEN the server responds `200` with `{ files: [{ source, chunks, duplicates }], requiresConfirmation }`
- AND `KnowledgeChunk` rows are created with `source` = sanitized basename of the file

#### Scenario: Multi-file mixed upload

- GIVEN a valid `agentId` and a request containing pdf, docx, txt, md, html, csv files (each ≤ 20 MB, total ≤ 10 files)
- WHEN the client POSTs them together
- THEN each file is parsed independently and the response `files` array contains one entry per file
- AND all parsed chunks are saved via `saveChunkWithDuplicatePolicy`

#### Scenario: Exceeds per-file size limit

- GIVEN a file larger than 20 MB
- WHEN the client POSTs it
- THEN the server rejects the entire request before parsing

#### Scenario: Exceeds file count limit

- GIVEN more than 10 files in one request
- WHEN the client POSTs them
- THEN the server rejects the entire request before parsing

---

### Requirement: Supported Format Allowlist

The system MUST accept direct (non-zip) uploads only for the extensions:
`pdf`, `docx`, `txt`, `md`, `html`, `csv`. Any other extension MUST be rejected
immediately with `HttpError(422, "Tipo no soportado: .<ext>")` where `<ext>` is the
actual extension from the filename.

#### Scenario: Unsupported direct file type

- GIVEN a client uploads a file with extension `.rar` (or any extension not in the allowlist)
- WHEN the request is processed
- THEN the server responds `422` with message `"Tipo no soportado: .rar"`
- AND no chunks are saved

#### Scenario: Supported extension — txt

- GIVEN a `.txt` file with UTF-8 text
- WHEN uploaded
- THEN it is parsed as plain UTF-8 and chunked normally

#### Scenario: Supported extension — html

- GIVEN a `.html` file
- WHEN uploaded
- THEN it is converted to plain text using the existing `htmlToText()`/cheerio pipeline before chunking

---

### Requirement: Per-Extension Parsing

The system MUST parse each supported extension to a plain text string before chunking:

| Extension | Parser |
|-----------|--------|
| `pdf`     | pdf-parse |
| `docx`    | mammoth |
| `html`    | existing cheerio `htmlToText()` |
| `txt`     | `Buffer.toString('utf8')` |
| `md`      | `Buffer.toString('utf8')` |
| `csv`     | `Buffer.toString('utf8')` |

The parsed text MUST be fed into `chunkText()` then into
`saveChunkWithDuplicatePolicy(agentId, filename, chunk, policy)` with
`source` = `path.basename(filename)`.

#### Scenario: PDF parsed and chunked

- GIVEN a valid multi-page PDF
- WHEN uploaded
- THEN pdf-parse extracts full text, `chunkText()` splits it into chunks ≥ 50 chars
- AND each chunk is saved with `source` = PDF filename (basename only)

#### Scenario: DOCX parsed and chunked

- GIVEN a valid `.docx` Word document
- WHEN uploaded
- THEN mammoth extracts text, which is chunked and saved with `source` = docx filename

---

### Requirement: Empty and Parse-Failure Tolerance

The system MUST NOT fail the entire request when a single file is empty or fails to
parse. Such files MUST be skipped with a per-file note in the response. All other
files in the same request MUST continue to be processed.

#### Scenario: Corrupt or empty file in a batch

- GIVEN a request containing a valid PDF and a corrupt/empty PDF
- WHEN both are uploaded together
- THEN the valid PDF is chunked and saved normally
- AND the corrupt file appears in the response `files` array with `chunks: 0` and a descriptive `note`
- AND the overall response status is `200` (not `500`)

#### Scenario: File that produces zero chunks after parsing

- GIVEN a text file containing only whitespace or content shorter than 50 chars
- WHEN uploaded
- THEN it is skipped with `chunks: 0` in the response and no `KnowledgeChunk` rows are created for it

---

### Requirement: ZIP Extraction

The system MUST accept `.zip` files. When a `.zip` is received, it MUST extract
entries in memory (no disk writes) and process each entry whose extension is in the
allowlist. Entries with unsupported extensions inside the zip MUST be skipped
silently (no error). Nested `.zip` files inside the archive MUST be treated as
unsupported entries (skipped silently, not recursively extracted).

Entry filenames MUST be sanitized with `path.basename` before use as `source` to
prevent path traversal.

#### Scenario: ZIP with mixed supported and unsupported entries

- GIVEN a `.zip` containing `report.pdf`, `notes.txt`, and `image.png`
- WHEN the zip is uploaded
- THEN `report.pdf` and `notes.txt` are parsed and their chunks saved
- AND `image.png` is silently skipped
- AND the response entry for the zip lists each processed source with its chunk count

#### Scenario: Nested zip skipped

- GIVEN a `.zip` containing another `.zip` file as an entry
- WHEN the outer zip is uploaded
- THEN the inner `.zip` entry is skipped silently without recursive extraction

#### Scenario: Unsupported direct zip alternative — .rar

- GIVEN a client uploads a `.rar` file directly
- WHEN the request is processed
- THEN the server responds `422` with `"Tipo no soportado: .rar"`

---

### Requirement: ZIP Safety Limits

The system MUST enforce the following limits during zip extraction to prevent
zip-bomb and resource exhaustion attacks:

| Limit | Value |
|-------|-------|
| Maximum total uncompressed size | 50 MB |
| Maximum entry count | 200 entries |

If either limit is exceeded during extraction, the system MUST stop processing and
reject the request with `HttpError(422, ...)`. No chunks from that zip MUST be
saved.

#### Scenario: Zip bomb rejected — uncompressed size exceeded

- GIVEN a `.zip` whose total uncompressed size exceeds 50 MB
- WHEN uploaded
- THEN the server stops extraction and responds with `422`
- AND no `KnowledgeChunk` rows are created for that upload

#### Scenario: Zip entry count exceeded

- GIVEN a `.zip` containing more than 200 entries
- WHEN uploaded
- THEN the server stops extraction and responds with `422`
- AND no `KnowledgeChunk` rows are created for that upload

#### Scenario: Zip within limits processed normally

- GIVEN a `.zip` with 50 entries and 10 MB uncompressed total
- WHEN uploaded
- THEN all supported entries are parsed and saved

---

### Requirement: Duplicate Policy

The system MUST reuse the existing `ask|overwrite|suffix` duplicate policy via
`saveChunkWithDuplicatePolicy`. The policy MUST be accepted as a request parameter.
The response MUST include `requiresConfirmation: true` when any file produced chunks
that were flagged as duplicates under the `ask` policy and confirmation is pending.

#### Scenario: Duplicate chunks with ask policy

- GIVEN a file whose chunks already exist for `agentId` and `policy=ask`
- WHEN uploaded
- THEN the response includes `requiresConfirmation: true`
- AND the affected file entry has a non-zero `duplicates` count

#### Scenario: Overwrite policy — existing chunks replaced

- GIVEN a file whose chunks already exist for `agentId` and `policy=overwrite`
- WHEN uploaded
- THEN existing matching chunks are replaced
- AND `requiresConfirmation: false`

#### Scenario: Suffix policy — no conflicts

- GIVEN `policy=suffix`
- WHEN a duplicate chunk is encountered
- THEN the chunk is saved with a suffixed `source` and `requiresConfirmation: false`

---

### Requirement: Response Shape

The system MUST respond with the following shape on success:

```
{
  files: [
    {
      source: string,        // sanitized basename
      chunks: number,        // chunks saved
      duplicates: number,    // chunks flagged as duplicates
      note?: string          // present only on skip/error
    }
  ],
  requiresConfirmation: boolean
}
```

#### Scenario: Full success response

- GIVEN two files uploaded successfully with no duplicates
- WHEN the response is received
- THEN `files` has two entries, each with `source`, `chunks > 0`, `duplicates: 0`
- AND `requiresConfirmation: false`

#### Scenario: Partial skip response

- GIVEN one valid file and one parse-failure file
- WHEN the response is received
- THEN the valid file entry has `chunks > 0`
- AND the skipped file entry has `chunks: 0` and a `note` string
- AND HTTP status is `200`

---

### Requirement: Frontend Upload UI

The frontend `front/app/agents/[id]/page.tsx` MUST provide a multi-file upload
control in the "conocimiento" tab. It MUST use raw `fetch()` with `FormData` and
`credentials: 'include'`. It MUST NOT use the `api()` helper (which forces
`Content-Type: application/json`). It SHOULD display per-file progress and show
success/skip/error outcome per file after the response is received.

#### Scenario: User selects and uploads multiple files

- GIVEN the user is on the conocimiento tab
- WHEN they select multiple files and submit
- THEN a `POST` with `multipart/form-data` is sent to `/api/knowledge/:agentId/files`
- AND the UI shows the outcome for each file (success, skipped, or error)

#### Scenario: api() is NOT used for file upload

- GIVEN the upload code path
- WHEN inspected
- THEN it uses `fetch()` directly with `FormData`, not the `api()` helper
- AND no `Content-Type` header is set manually (browser sets boundary automatically)
