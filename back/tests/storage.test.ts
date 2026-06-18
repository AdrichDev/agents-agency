import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  isImageDataUrl,
  avatarAction,
  objectPathFromPublicUrl,
  uploadPublicAsset,
  uploadImageDataUrl,
  deletePublicAsset,
  PUBLIC_ASSETS_BUCKET,
} from "@/lib/storage";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAC/aN6cAAAAAElFTkSuQmCC";
const TINY_PNG_DATAURL = `data:image/png;base64,${TINY_PNG_B64}`;

describe("isImageDataUrl", () => {
  it("acepta data URL de imagen", () => {
    expect(isImageDataUrl(TINY_PNG_DATAURL)).toBe(true);
    expect(isImageDataUrl("data:image/webp;base64,AAAA")).toBe(true);
  });
  it("rechaza no-imagen / vacío / null / url plana / base64 pelado", () => {
    expect(isImageDataUrl(undefined)).toBe(false);
    expect(isImageDataUrl(null)).toBe(false);
    expect(isImageDataUrl("")).toBe(false);
    expect(isImageDataUrl("https://cdn/x.png")).toBe(false);
    expect(isImageDataUrl(TINY_PNG_B64)).toBe(false); // sin prefijo data:
    expect(isImageDataUrl("data:application/pdf;base64,AAAA")).toBe(false);
  });
});

describe("avatarAction — decisión sin IO (el bug del wipe vive aquí)", () => {
  it("undefined -> noop (campo ausente: NO tocar el avatar)", () => {
    expect(avatarAction(undefined)).toEqual({ kind: "noop" });
  });
  it("null y '' -> clear (limpieza explícita)", () => {
    expect(avatarAction(null)).toEqual({ kind: "clear" });
    expect(avatarAction("")).toEqual({ kind: "clear" });
  });
  it("data URL -> upload", () => {
    expect(avatarAction(TINY_PNG_DATAURL)).toEqual({ kind: "upload", dataUrl: TINY_PNG_DATAURL });
  });
  it("URL ya almacenada -> noop (NUNCA borrar lo ya subido en un save no-avatar)", () => {
    const url = `https://x.supabase.co/storage/v1/object/public/${PUBLIC_ASSETS_BUCKET}/widget-avatars/a.webp`;
    expect(avatarAction(url)).toEqual({ kind: "noop" });
  });
});

describe("objectPathFromPublicUrl", () => {
  it("extrae el path del bucket", () => {
    const url = `https://x.supabase.co/storage/v1/object/public/${PUBLIC_ASSETS_BUCKET}/widget-avatars/a.webp`;
    expect(objectPathFromPublicUrl(url)).toBe("widget-avatars/a.webp");
  });
  it("null si la URL no es de este bucket (asset legacy en disco)", () => {
    expect(objectPathFromPublicUrl("https://x/landing-assets/a/b.webp")).toBeNull();
    expect(objectPathFromPublicUrl("")).toBeNull();
  });
});

// Integración real contra Supabase Storage. Valida bucket, política pública y
// content-type — lo que un mock NUNCA detecta. Se salta si SUPABASE_URL es el
// placeholder de tests/setup.ts (CI sin credenciales).
// Para ejecutarla, inyecta credenciales reales ANTES de vitest, p.ej.:
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> npx vitest run tests/storage.test.ts
const REAL_SUPABASE =
  !!process.env.SUPABASE_URL &&
  !process.env.SUPABASE_URL.includes("placeholder") &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY.includes("placeholder");

describe.skipIf(!REAL_SUPABASE)("Storage integración (real)", () => {
  it("uploadPublicAsset -> URL pública legible (200) y cleanup", async () => {
    const path = `_test/${Date.now()}-a.png`;
    const url = await uploadPublicAsset(path, Buffer.from(TINY_PNG_B64, "base64"), "image/png");
    expect(url).toContain(`/public/${PUBLIC_ASSETS_BUCKET}/`);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image");
    await deletePublicAsset(path);
  });

  it("uploadImageDataUrl convierte a webp y sube", async () => {
    // PNG válido y decodificable (sharp) — el 1x1 estático no pasa libpng.
    const pngBuf = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    }).png().toBuffer();
    const dataUrl = `data:image/png;base64,${pngBuf.toString("base64")}`;
    const path = `_test/${Date.now()}-b.webp`;
    const url = await uploadImageDataUrl(path, dataUrl);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("webp");
    await deletePublicAsset(path);
  });

  it("getPublicUrl tras borrar -> 404/400 (no servible)", async () => {
    const path = `_test/${Date.now()}-c.png`;
    const url = await uploadPublicAsset(path, Buffer.from(TINY_PNG_B64, "base64"), "image/png");
    await deletePublicAsset(path);
    const res = await fetch(url);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
