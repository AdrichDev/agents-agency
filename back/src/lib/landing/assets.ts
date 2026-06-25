/**
 * assets.ts — Optimize an uploaded image and store it as a public webp asset.
 * Extracted from routes/landing.ts. Throws HttpError on invalid/undecodable
 * input so the route maps it to the right status.
 */

import crypto from "crypto";
import sharp from "sharp";
import { HttpError } from "@/lib/http";
import { uploadPublicAsset } from "@/lib/storage";

/**
 * Decodes a data URL (or raw base64) image, optimizes it (auto-rotate, max
 * 1600px, webp q80), uploads it under the project's asset folder and returns
 * the public URL.
 */
export async function processLandingAsset(projectId: string, dataUrl: string): Promise<string> {
  // Acepta data URL (data:image/...;base64,XXXX) o base64 puro.
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  const b64 = match ? match[1] : dataUrl;
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) throw new HttpError(400, "Imagen no válida");

  // Optimiza: corrige orientación, redimensiona a máx 1600px y convierte a webp.
  let out: Buffer;
  try {
    out = await sharp(buf)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new HttpError(400, "No se pudo procesar la imagen");
  }

  const hash = crypto.createHash("sha1").update(out).digest("hex").slice(0, 12);
  const fileName = `${hash}.webp`;
  // Antes: disco local (efímero, se pierde en redeploy). Ahora: Supabase Storage.
  return uploadPublicAsset(`landing/${projectId}/${fileName}`, out, "image/webp");
}
