# Migraciones manuales (histórico)

Estos `migrate-*.sql` son parches SQL **aplicados a mano** sobre la base de datos
(Supabase) ANTES de adoptar el flujo oficial de Prisma Migrate. **No** los ejecuta
`prisma migrate` y **no** forman parte del estado de migraciones de `prisma/migrations/`.

Se conservan solo como referencia histórica de cambios ya aplicados en producción.

## Regla a partir de ahora

- La estrategia de migración **única** es `prisma/migrations/` vía `prisma migrate`.
- NO añadir nuevos `.sql` sueltos aquí. Cualquier cambio de esquema → modelo en
  `schema.prisma` + `prisma migrate dev/deploy`.
- Si alguno de estos parches NO estuviera aplicado en un entorno, revísalo contra
  el esquema actual antes de ejecutarlo (pueden estar ya incluidos en el schema).
