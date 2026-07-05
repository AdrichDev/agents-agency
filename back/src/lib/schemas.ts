import { z } from "zod";

// Tope de tamaño para campos base64 (imágenes inline): ~1.5MB de base64.
const MAX_BASE64_LEN = 1_500_000;

// Exige el prefijo data:image/...;base64, — sin esto, un string arbitrario
// (p.ej. "javascript:alert(1)") pasaba el schema y solo quedaba a salvo por
// el noop de avatarAction() en storage.ts (protección implícita, no contrato).
// "" se admite aparte: es la señal de "limpiar avatar" (avatarAction -> clear).
const DATA_URL_IMAGE_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

export const base64ImageSchema = z
  .string()
  .max(MAX_BASE64_LEN, "Imagen demasiado grande (máx ~1.5MB)")
  .refine((s) => s === "" || DATA_URL_IMAGE_RE.test(s), {
    message: "Debe ser un data URL de imagen (data:image/...;base64,...) o vacío para limpiar",
  });
