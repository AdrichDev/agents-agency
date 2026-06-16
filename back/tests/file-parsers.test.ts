import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseFile } from "@/lib/scraper/file";
import { HttpError } from "@/lib/http";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an in-memory zip from a map of { entryName -> content }. */
async function buildZip(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Task 4.1 — parseFile dispatch: txt
// ---------------------------------------------------------------------------

describe("parseFile — txt", () => {
  it("returns [{source, text}] with the exact utf8 content", async () => {
    const text = "Hello, world! This is a plain text file with enough chars.";
    const buf = Buffer.from(text, "utf8");
    const result = await parseFile("notes.txt", buf);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("notes.txt");
    expect(result[0].text).toBe(text);
  });

  it("handles md extension the same as txt", async () => {
    const text = "# Title\n\nSome markdown content here.";
    const buf = Buffer.from(text, "utf8");
    const result = await parseFile("readme.md", buf);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("readme.md");
    expect(result[0].text).toBe(text);
  });

  it("handles csv extension the same as txt", async () => {
    const text = "col1,col2\nval1,val2";
    const buf = Buffer.from(text, "utf8");
    const result = await parseFile("data.csv", buf);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("data.csv");
    expect(result[0].text).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Task 4.1 — parseFile dispatch: pdf
// (minimal test: pdf-parse requires a valid PDF, so we test the parse path
//  works for a known minimal PDF fixture; if the buffer is invalid pdf-parse
//  will throw, which is caught by the route — that's expected behavior.)
// ---------------------------------------------------------------------------

describe("parseFile — pdf", () => {
  it("throws when buffer is not a valid PDF (not a silent empty return)", async () => {
    const buf = Buffer.from("not a pdf", "utf8");
    // pdf-parse will throw an error for invalid PDF content
    await expect(parseFile("file.pdf", buf)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Task 4.2 — parseFile dispatch: docx
// ---------------------------------------------------------------------------

describe("parseFile — docx", () => {
  it("throws when buffer is not a valid docx (mammoth rejects invalid content)", async () => {
    const buf = Buffer.from("not a docx", "utf8");
    // mammoth will throw or return error for invalid docx
    await expect(parseFile("doc.docx", buf)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Task 4.3 — Unsupported extension
// ---------------------------------------------------------------------------

describe("parseFile — unsupported extension", () => {
  it("throws HttpError(422) for .exe files", async () => {
    const buf = Buffer.from("binary data");
    const err = await parseFile("malware.exe", buf).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(422);
    expect((err as HttpError).message).toMatch(/\.exe/);
  });

  it("throws HttpError(422) for .rar files", async () => {
    const buf = Buffer.from("rar data");
    const err = await parseFile("archive.rar", buf).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(422);
    expect((err as HttpError).message).toMatch(/\.rar/);
  });

  it("throws HttpError(422) for files with no extension", async () => {
    const buf = Buffer.from("data");
    const err = await parseFile("noextension", buf).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Task 4.4 — Empty file
// ---------------------------------------------------------------------------

describe("parseFile — empty file", () => {
  it("returns [{source, text: ''}] for an empty txt buffer (no throw)", async () => {
    const buf = Buffer.from("", "utf8");
    const result = await parseFile("empty.txt", buf);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("empty.txt");
    expect(result[0].text).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Task 4.5 — Zip multi-entry expansion + unsupported skip
// ---------------------------------------------------------------------------

describe("parseFile — zip extraction", () => {
  it("extracts supported entries and skips unsupported ones", async () => {
    const zipBuf = await buildZip({
      "notes.txt": "This is a text file inside the zip archive.",
      "readme.md": "# Markdown\n\nContent inside zip.",
      "image.exe": Buffer.from([0x4d, 0x5a, 0x90, 0x00]), // unsupported
    });

    const result = await parseFile("archive.zip", zipBuf);

    // Should have exactly 2 supported entries; .exe is skipped.
    expect(result).toHaveLength(2);
    const sources = result.map((r) => r.source);
    expect(sources).toContain("notes.txt");
    expect(sources).toContain("readme.md");
    expect(sources).not.toContain("image.exe");
  });

  it("sanitizes entry names with path.basename", async () => {
    const zipBuf = await buildZip({
      "../../../etc/passwd": "root:x:0:0",
      "safe.txt": "safe content in this file for the test",
    });

    const result = await parseFile("malicious.zip", zipBuf);
    const sources = result.map((r) => r.source);
    // Path traversal component stripped; basename should be "passwd" (unsupported) or "safe.txt"
    expect(sources).not.toContain("../../../etc/passwd");
  });
});

// ---------------------------------------------------------------------------
// Task 4.6 — Zip byte budget breach (atomic: no partial output)
// ---------------------------------------------------------------------------

describe("parseFile — zip byte budget", () => {
  it("throws HttpError(413) when total uncompressed size exceeds 50 MB", async () => {
    // Build a zip where uncompressed size metadata exceeds limit.
    // We'll create many entries each claiming large uncompressed sizes
    // by creating actual large content.
    // To avoid actually building 50 MB in memory, we verify the guard triggers
    // by building entries that sum past the limit.

    // Build 3 entries of ~17 MB each = ~51 MB total.
    const bigChunk = "A".repeat(17 * 1024 * 1024);
    const zipBuf = await buildZip({
      "a.txt": bigChunk,
      "b.txt": bigChunk,
      "c.txt": bigChunk,
    });

    const err = await parseFile("big.zip", zipBuf).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(413);
  }, 30_000); // allow 30s for large buffer
});

// ---------------------------------------------------------------------------
// Task 4.7 — Zip entry count cap
// ---------------------------------------------------------------------------

describe("parseFile — zip entry count cap", () => {
  it("throws HttpError(413) when zip has more than 200 entries", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 201; i++) {
      entries[`file${i}.txt`] = `content of file ${i}`;
    }
    const zipBuf = await buildZip(entries);

    const err = await parseFile("many.zip", zipBuf).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(413);
  });
});

// ---------------------------------------------------------------------------
// Task 4.8 — Nested zip treated as unsupported (not recursed)
// ---------------------------------------------------------------------------

describe("parseFile — nested zip skipped", () => {
  it("skips nested .zip entries and processes outer entries normally", async () => {
    // Inner zip containing a txt file.
    const innerZip = await buildZip({ "inner.txt": "inner content" });

    // Outer zip: one txt entry + one nested .zip entry.
    const outerZip = await buildZip({
      "outer.txt": "outer content that is long enough to matter here",
      "nested.zip": innerZip,
    });

    const result = await parseFile("outer.zip", outerZip);

    // Only outer.txt should be processed; nested.zip is skipped.
    const sources = result.map((r) => r.source);
    expect(sources).toContain("outer.txt");
    expect(sources).not.toContain("nested.zip");
    expect(sources).not.toContain("inner.txt");
  });
});

// ---------------------------------------------------------------------------
// Success paths (WARNING-1 / WARNING-2 de sdd-verify): parseo real de docx y html.
// ---------------------------------------------------------------------------

describe("parseFile — docx success", () => {
  it("extracts non-empty text from a real .docx", async () => {
    const buf = readFileSync(new URL("./fixtures/sample.docx", import.meta.url));
    const result = await parseFile("sample.docx", buf);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("sample.docx");
    expect(result[0].text.trim().length).toBeGreaterThan(0);
    // El texto extraído no debe contener XML/markup de OOXML.
    expect(result[0].text).not.toContain("<w:");
  });
});

describe("parseFile — html success", () => {
  it("strips tags and returns visible text", async () => {
    const html =
      "<html><head><title>x</title></head><body><h1>Hola</h1>" +
      "<p>Contenido de prueba con suficientes caracteres para indexar.</p></body></html>";
    const result = await parseFile("page.html", Buffer.from(html, "utf8"));
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("page.html");
    expect(result[0].text).toContain("Contenido de prueba");
    expect(result[0].text).not.toContain("<p>");
    expect(result[0].text).not.toContain("<h1>");
  });
});
