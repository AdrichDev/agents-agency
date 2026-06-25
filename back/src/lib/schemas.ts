import { z } from "zod";

// Tope de tamaño para campos base64 (imágenes inline): ~1.5MB de base64.
const MAX_BASE64_LEN = 1_500_000;

export const base64ImageSchema = z
  .string()
  .max(MAX_BASE64_LEN, "Imagen demasiado grande (máx ~1.5MB)");
