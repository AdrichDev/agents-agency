import sharp from "sharp";
import { supabaseAdmin } from "@/lib/auth";

const DATA_URL_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/;

/** true si el string es un data URL de imagen (lo que manda el front al subir). */
export function isImageDataUrl(s: string | null | undefined): s is string {
  return typeof s === "string" && DATA_URL_RE.test(s);
}

/**
 * Decide qué hacer con el campo avatar recibido, SIN tocar IO (puro → testeable):
 * - undefined            → noop  (el campo no vino: no tocar nada)
 * - null | ""            → clear (limpiar avatar y blob)
 * - data:image/...       → upload (subir a Storage)
 * - cualquier otra cosa  → noop  (ya es URL u otro: NO reprocesar ni borrar)
 *
 * El último caso es clave: si llega una URL ya almacenada, NO debe borrarse. Así
 * un guardado que no toca el avatar nunca lo elimina por accidente.
 */
export type AvatarAction =
  | { kind: "noop" }
  | { kind: "clear" }
  | { kind: "upload"; dataUrl: string };

export function avatarAction(input: string | null | undefined): AvatarAction {
  if (input === undefined) return { kind: "noop" };
  if (input === null || input === "") return { kind: "clear" };
  if (isImageDataUrl(input)) return { kind: "upload", dataUrl: input };
  return { kind: "noop" };
}

/**
 * Supabase Storage — assets públicos (servidos en páginas anónimas: widget en
 * sitios de clientes, landings publicadas). Bucket creado por
 * scripts/setup-storage-bucket.ts. La subida la media siempre el back (service
 * role); el front nunca escribe en Storage directamente.
 */
export const PUBLIC_ASSETS_BUCKET = "public-assets";

/** Sube un buffer y devuelve su URL pública. upsert: re-subir misma ruta no falla. */
export async function uploadPublicAsset(
  objectPath: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const { error } = await supabaseAdmin.storage
    .from(PUBLIC_ASSETS_BUCKET)
    .upload(objectPath, body, { contentType, upsert: true });
  if (error) throw error;
  const { data } = supabaseAdmin.storage.from(PUBLIC_ASSETS_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

/**
 * Decodifica un data URL de imagen, lo optimiza a webp (máx 512px) y lo sube.
 * Devuelve la URL pública. Lanza si la imagen es inválida. Valida por contenido
 * (sharp falla si no es imagen real) → no nos fiamos del prefijo data:.
 */
export async function uploadImageDataUrl(objectPath: string, dataUrl: string): Promise<string> {
  const m = dataUrl.match(DATA_URL_RE);
  const buf = Buffer.from(m ? m[1] : dataUrl, "base64");
  if (buf.length === 0) throw new Error("imagen vacía");
  const webp = await sharp(buf).rotate().resize({ width: 512, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return uploadPublicAsset(objectPath, webp, "image/webp");
}

/** Borra un objeto (best-effort, nunca lanza) — para GC de huérfanos. */
export async function deletePublicAsset(objectPath: string): Promise<void> {
  await supabaseAdmin.storage.from(PUBLIC_ASSETS_BUCKET).remove([objectPath]).catch(() => {});
}

/** Borra todos los objetos bajo un prefijo/carpeta (best-effort) — GC al borrar el dueño. */
export async function deletePublicAssetFolder(prefix: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin.storage.from(PUBLIC_ASSETS_BUCKET).list(prefix);
    if (data?.length) {
      await supabaseAdmin.storage
        .from(PUBLIC_ASSETS_BUCKET)
        .remove(data.map((f) => `${prefix}/${f.name}`));
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Extrae el objectPath de una URL pública del bucket; null si la URL no pertenece
 * a este bucket (p.ej. un asset legacy en disco). Útil para borrar el blob al
 * reemplazar/eliminar el registro que lo referencia.
 */
export function objectPathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${PUBLIC_ASSETS_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}
