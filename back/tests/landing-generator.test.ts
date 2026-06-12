import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseAndValidateFiles, MAX_FILES_BYTES } from "@/lib/landing/llm-files";
import { generateFiles } from "@/lib/landing/generator";

// Mock openai module
vi.mock("@/lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  DEFAULT_MODEL: "test-model",
  STRONG_MODEL: "test-strong-model",
}));

import { openai } from "@/lib/openai";

const mockCreate = openai.chat.completions.create as ReturnType<typeof vi.fn>;

function makeCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── parseAndValidateFiles ────────────────────────────────────────────────────

describe("parseAndValidateFiles", () => {
  it("accepts valid {path→content} with index.html", () => {
    const files = parseAndValidateFiles(
      JSON.stringify({ "index.html": "<html>test</html>", "style.css": "body {}" })
    );
    expect(files["index.html"]).toBe("<html>test</html>");
    expect(files["style.css"]).toBe("body {}");
  });

  it("strips markdown code blocks before parsing", () => {
    const raw = "```json\n" + JSON.stringify({ "index.html": "<html/>" }) + "\n```";
    const files = parseAndValidateFiles(raw);
    expect(files["index.html"]).toBe("<html/>");
  });

  it("throws if index.html is missing", () => {
    expect(() =>
      parseAndValidateFiles(JSON.stringify({ "style.css": "body {}" }))
    ).toThrow(/index\.html/);
  });

  it("throws if value is not a string", () => {
    expect(() =>
      parseAndValidateFiles(JSON.stringify({ "index.html": 123 }))
    ).toThrow();
  });

  it("throws on non-object input", () => {
    expect(() => parseAndValidateFiles(JSON.stringify([1, 2]))).toThrow();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseAndValidateFiles("not json")).toThrow();
  });
});

// ── generateFiles — retry logic ──────────────────────────────────────────────

describe("generateFiles — retry logic", () => {
  it("succeeds on first attempt with valid JSON", async () => {
    const validFiles = { "index.html": "<html>ok</html>" };
    mockCreate.mockResolvedValueOnce(makeCompletion(JSON.stringify(validFiles)));

    const result = await generateFiles("Build a landing", "none");
    expect(result.files["index.html"]).toBe("<html>ok</html>");
    expect(result.truncated).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("retries twice on invalid JSON then succeeds on 3rd attempt", async () => {
    const validFiles = { "index.html": "<html>retry success</html>" };
    mockCreate
      .mockResolvedValueOnce(makeCompletion("not json"))
      .mockResolvedValueOnce(makeCompletion("still not json"))
      .mockResolvedValueOnce(makeCompletion(JSON.stringify(validFiles)));

    const result = await generateFiles("Build a landing", "none");
    expect(result.files["index.html"]).toBe("<html>retry success</html>");
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("throws with raw content after 3 failed attempts", async () => {
    const rawJunk = "junk response that is not json";
    mockCreate
      .mockResolvedValueOnce(makeCompletion(rawJunk))
      .mockResolvedValueOnce(makeCompletion(rawJunk))
      .mockResolvedValueOnce(makeCompletion(rawJunk));

    await expect(generateFiles("Build a landing", "none")).rejects.toMatchObject({
      raw: rawJunk,
    });
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});

// ── generateFiles — size limit ────────────────────────────────────────────────

describe("generateFiles — size limit", () => {
  it("sets truncated:true when files exceed MAX_FILES_BYTES", async () => {
    // Generate a large file content that exceeds the limit
    const bigContent = "x".repeat(MAX_FILES_BYTES + 1000);
    const largeFiles = { "index.html": bigContent };
    mockCreate.mockResolvedValueOnce(makeCompletion(JSON.stringify(largeFiles)));

    const result = await generateFiles("Build a landing", "none");
    expect(result.truncated).toBe(true);
  });
});

// ── generateFiles — merge on regeneration ────────────────────────────────────

describe("generateFiles — regeneration merge", () => {
  it("merges delta with previous files, preserving unchanged files", async () => {
    const delta = { "index.html": "<html>updated</html>", "new-section.js": "// new" };
    mockCreate.mockResolvedValueOnce(makeCompletion(JSON.stringify(delta)));

    const previous = {
      "index.html": "<html>original</html>",
      "style.css": "body { margin: 0; }",
      "script.js": "console.log('hi')",
    };

    const result = await generateFiles("Build a landing", "none", {
      previous,
      feedback: "Add a new section",
    });

    // Delta replaces/adds
    expect(result.files["index.html"]).toBe("<html>updated</html>");
    expect(result.files["new-section.js"]).toBe("// new");
    // Previous unchanged files preserved
    expect(result.files["style.css"]).toBe("body { margin: 0; }");
    expect(result.files["script.js"]).toBe("console.log('hi')");
  });
});
