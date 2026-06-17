# Propuesta — Express Request Type Augmentation

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **1** (Pequeña) · Calidad

## Intención

Eliminar los `(req as any)` repartidos por el backend declarando una augmentación
tipada de `Express.Request` con los campos que el código añade en runtime
(`user`, `rawBody`, `validatedBody/Query/Params`). Mejora la seguridad de tipos.

## Áreas afectadas
- `back/src/types/express.d.ts` (nuevo): augmentación de `Express.Request`.
- `back/src/lib/http.ts`: quita el `declare global` duplicado (consolidado).
- `index.ts`, `lib/auth.ts`, `lib/observability.ts`, `lib/channels/whatsapp-webhook.ts`:
  acceso tipado `req.user`/`req.rawBody`/`req.id` en vez de `(req as any)`.

## Notas
- Se conservan casts legítimos de librería (Prisma JSON, recharts, indexado
  dinámico en `validate`, `verify` de express.json que recibe `IncomingMessage`).
- `req.id`/`req.log` provienen de los tipos de `pino-http`.

## Criterios de éxito
- [x] `(req as any)` de Express eliminados (quedan solo casts legítimos).
- [x] `vitest` (352) y `tsc --noEmit` verdes.
