/**
 * data-layer.ts — Regenerate only the data layer for a landing project and
 * merge the delta over the existing files, surfacing collisions for
 * confirmation. Extracted from routes/landing.ts.
 */

import {
  generateFiles,
  findCollisions,
  buildSimpleDiff,
  type DbProvider,
} from "./generator";

export type SwitchDataLayerResult =
  | { kind: "collision"; collisions: string[]; diff: string }
  | { kind: "merged"; files: Record<string, string>; truncated: boolean };

/**
 * Regenerates the data layer for `dbProvider` against `previousFiles`. When the
 * delta collides with existing files and `confirm` is false, returns the
 * collisions + diff for the caller to surface (409). Otherwise merges and
 * returns the combined files.
 */
export async function switchDataLayer(
  generationPrompt: string,
  dbProvider: DbProvider,
  previousFiles: Record<string, string>,
  confirm: boolean
): Promise<SwitchDataLayerResult> {
  const deltaResult = await generateFiles(generationPrompt, dbProvider, {
    previous: previousFiles,
    onlyDataLayer: true,
  });

  const deltaFiles = Object.fromEntries(
    Object.entries(deltaResult.files).filter(
      ([k]) => !(k in previousFiles) || deltaResult.files[k] !== previousFiles[k]
    )
  );

  // Check for collisions with the existing files (excluding identical content)
  const collisions = findCollisions(previousFiles, deltaFiles);

  if (collisions.length > 0 && !confirm) {
    const diff = buildSimpleDiff(previousFiles, deltaFiles, collisions);
    return { kind: "collision", collisions, diff };
  }

  // Apply merge
  const merged = { ...previousFiles, ...deltaFiles };
  return { kind: "merged", files: merged, truncated: deltaResult.truncated };
}
