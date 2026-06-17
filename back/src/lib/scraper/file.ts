import path from "path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import * as unzipper from "unzipper";
import { htmlToText } from "./web.js";
import { HttpError } from "@/lib/http";

/** Extensions supported as direct uploads (and inside zips). */
const ALLOWED_EXTS = new Set(["pdf", "docx", "txt", "md", "csv", "html", "htm"]);

/** Max total uncompressed bytes across all zip entries (~50 MB). */
const ZIP_MAX_BYTES = 50 * 1024 * 1024;

/** Max number of entries to process in a single zip. */
const ZIP_MAX_ENTRIES = 200;

/**
 * Parses a file (by extension) to an array of { source, text } objects.
 * A .zip expands into one entry per supported archive member.
 * Unsupported extensions throw so the caller can map them to HttpError(422).
 */
export async function parseFile(
  filename: string,
  buffer: Buffer
): Promise<{ source: string; text: string }[]> {
  const basename = path.basename(filename);
  const ext = basename.split(".").pop()?.toLowerCase() ?? "";

  switch (ext) {
    case "pdf": {
      const data = await pdfParse(buffer);
      return [{ source: basename, text: data.text }];
    }

    case "docx": {
      const result = await mammoth.extractRawText({ buffer });
      return [{ source: basename, text: result.value }];
    }

    case "html":
    case "htm": {
      const text = htmlToText(buffer.toString("utf8"));
      return [{ source: basename, text }];
    }

    case "txt":
    case "md":
    case "csv": {
      return [{ source: basename, text: buffer.toString("utf8") }];
    }

    case "zip": {
      return extractZip(buffer);
    }

    default:
      throw new HttpError(422, `Tipo no soportado: .${ext}`);
  }
}

/** Extracts all supported entries from a zip buffer (atomic — validates first). */
async function extractZip(buffer: Buffer): Promise<{ source: string; text: string }[]> {
  const directory = await unzipper.Open.buffer(buffer);

  // Validate limits before processing anything (atomic).
  if (directory.files.length > ZIP_MAX_ENTRIES) {
    throw new HttpError(
      413,
      `Zip excede límite de entradas (máx ${ZIP_MAX_ENTRIES}, encontradas ${directory.files.length})`
    );
  }

  let totalUncompressed = 0;
  for (const entry of directory.files) {
    totalUncompressed += entry.uncompressedSize ?? 0;
    if (totalUncompressed > ZIP_MAX_BYTES) {
      throw new HttpError(
        413,
        `Zip excede límite de tamaño descomprimido (máx 50 MB)`
      );
    }
  }

  const results: { source: string; text: string }[] = [];

  for (const entry of directory.files) {
    // Skip directory entries.
    if (entry.type === "Directory") continue;

    const entryName = path.basename(entry.path);
    const entryExt = entryName.split(".").pop()?.toLowerCase() ?? "";

    // Skip nested zips and unsupported extensions silently.
    if (entryExt === "zip" || !ALLOWED_EXTS.has(entryExt)) continue;

    const entryBuffer = await entry.buffer();

    try {
      const parsed = await parseFile(entryName, entryBuffer);
      results.push(...parsed);
    } catch {
      // Skip individual entries that fail to parse (non-fatal inside zip).
    }
  }

  return results;
}
