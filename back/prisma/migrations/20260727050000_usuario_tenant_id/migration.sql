-- H5 (aa-portal-cliente, T1.3) — Tenant del usuario, para escopar el portal de cliente.
--
-- Migración ADITIVA a propósito, y aquí está lo importante:
--
--   * La columna es NULLABLE y SIN DEFAULT. `NULL` = usuario del estudio (staff), que es literalmente
--     el comportamiento de hoy: todas las filas existentes quedan como estaban. Ponerla NOT NULL
--     obligaría a inventar un tenant para el staff, y un tenant inventado en la columna que decide el
--     aislamiento de datos es la peor fila que puede tener esta tabla.
--
--   * FK con ON DELETE RESTRICT, no SET NULL. Borrar un tenant que aún tiene usuarios de portal debe
--     fallar en voz alta. Con SET NULL esos usuarios se quedarían con `tenant_id = NULL`, es decir,
--     convertidos en staff: un borrado de cliente que termina en escalada de privilegios.
--
--   * Índice sobre `tenant_id` porque la puerta y todos los endpoints de portal filtran por él.
--
-- La invariante `rol = 'client'` ⇒ `tenant_id NOT NULL` NO se expresa aquí. Un CHECK a mano quedaría
-- fuera del schema de Prisma y se perdería en el próximo `migrate diff`; la imponen el endpoint de
-- alta (T5) y la propia puerta, que niega a un `client` sin tenant en lugar de dejarlo pasar sin
-- filtro.

ALTER TABLE "usuario" ADD COLUMN "tenant_id" TEXT;

CREATE INDEX "usuario_tenant_id_idx" ON "usuario"("tenant_id");

ALTER TABLE "usuario" ADD CONSTRAINT "usuario_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
