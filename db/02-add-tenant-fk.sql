-- ============================================================================
-- 02-add-tenant-fk.sql — FK cross-schema crm.business.tenant_id → aa.tenant.id
-- Correr DESPUÉS de prisma db push de AMBAS apps (aa.tenant y crm."Business" deben
-- existir). Postgres soporta FK entre schemas en la misma database de forma nativa;
-- Prisma no la modela (clientes separados), por eso se aplica aquí por SQL.
-- ============================================================================

-- 1:1 — un Business pertenece como mucho a un Tenant (cliente general).
-- ON DELETE SET NULL: borrar el tenant no borra el negocio (decisión conservadora).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_tenant_id_fkey'
  ) THEN
    ALTER TABLE crm."Business"
      ADD CONSTRAINT business_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES aa.tenant(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Índice para joins/filtrados por tenant (el @unique de Prisma ya crea uno; este es
-- defensivo por si se relaja a 1:N en el futuro).
CREATE INDEX IF NOT EXISTS business_tenant_id_idx ON crm."Business" (tenant_id);
