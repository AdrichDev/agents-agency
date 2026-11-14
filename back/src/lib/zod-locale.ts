import { z } from "zod";

// Mensajes por defecto de zod en español para los campos sin mensaje propio. Sin esto, zod 4
// devuelve textos en inglés ("Invalid input: expected string, received undefined") que llegan
// al usuario a través de `.flatten()`. Los mensajes propios de cada esquema siguen ganando.
// Configuración global del proceso: se importa una vez al principio de `src/index.ts`.
z.config(z.locales.es());
