# Historial de migraciones pre-squash (archivado)

Estas 7 migraciones son el historial **incoherente** anterior al squash. Mezclaban
tres convenciones incompatibles y no se podian reproducir desde cero:

- Baseline `20260616071855_agents_agency` y las dos siguientes: tablas en ingles
  PascalCase (`"User"`, `"Budget"`, `"Agent"`), esquema por defecto (`public`), sin cualificar.
- `20260704120000_add_invoice`: nombres en espanol (`factura`, FK a `presupuesto`) sin
  cualificar. Fallaba con P3018 (`relation "presupuesto" does not exist`) porque el
  baseline creaba `"Budget"`, no `presupuesto`.
- `20260707*_add_platform_*`: nombres en espanol cualificados con el esquema `aa`.

El renombrado ingles->espanol (`db/05-aa-rename-es.sql`) y el traslado al esquema `aa`
(`db/01-supabase-setup.sql`) se aplicaron a mano fuera de `prisma/migrations`, por lo que
esta carpeta nunca los capturo y el historial no podia reconstruir la base desde vacio.

**Reemplazado por un baseline unico** (`prisma/migrations/20260708000000_squashed_baseline`)
generado desde `schema.prisma` el 2026-07-08. Probado con replay verde en DB limpia.

**No usar.** Se conserva solo como referencia historica.
