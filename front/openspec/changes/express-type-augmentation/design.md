# Design — Express Request Type Augmentation

## Decisión
Un único `src/types/express.d.ts` con `declare global { namespace Express { interface Request {...} } }`
importando `SessionUser`. Se elimina el bloque duplicado de `http.ts`. Los casts
de librería (Prisma JSON, recharts, `verify` IncomingMessage, indexado dinámico)
se conservan por ser gaps legítimos de tipado de terceros.

## Rollback
Revertir el commit.
