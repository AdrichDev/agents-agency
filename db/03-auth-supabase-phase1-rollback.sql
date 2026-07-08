-- ============================================================================
-- 03-auth-supabase-phase1-rollback.sql — Revierte 03-auth-supabase-phase1.sql.
-- Correr en UNA transacción (ON_ERROR_STOP=1) contra Supabase (session pooler 5432).
--
-- NOTA: revierte la ESTRUCTURA (tipos, policies, columnas, FKs, auth.users del admin).
-- Los DATOS dropeados (crm.User.passwordHash, crm.AuthToken, los cuid originales) NO se
-- pueden reconstruir desde SQL: si se necesitan, restaurar desde los backups del 2026-06-18
-- (agents-agency/aa_backup_*.dump, creador_CRM/back/backups/crm_fresh_*.dump). En la práctica
-- todo CRM estaba vacío salvo el admin AA, cuyo password vive ahora en auth.users.
-- ============================================================================

-- ---------- RLS: quitar policies y grants añadidos ----------
DO $$
DECLARE t text;
  tbls text[] := ARRAY[
    'Booking','BusinessSetting','Campaign','CustomerPackage','Document','Employee',
    'Fichaje','Invoice','Location','Notification','Package','Product','Resource',
    'Sale','SectorModule','Service','Tag','TimeOffRequest'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_business_read ON crm.%I;', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS customer_read       ON crm."Customer";
DROP POLICY IF EXISTS membership_self_read ON crm."Membership";

REVOKE SELECT ON ALL TABLES IN SCHEMA crm FROM authenticated;
REVOKE USAGE ON SCHEMA crm FROM authenticated;

-- ---------- Q-A: deshacer Customer.userId ----------
DROP INDEX IF EXISTS crm."Customer_userId_key";
ALTER TABLE crm."Customer" DROP CONSTRAINT IF EXISTS "Customer_userId_fkey";
ALTER TABLE crm."Customer" DROP COLUMN IF EXISTS "userId";

DROP INDEX IF EXISTS crm.membership_user_business_idx;

-- ---------- CRM: revertir tipos uuid -> text y FKs ----------
ALTER TABLE crm."Membership" DROP CONSTRAINT IF EXISTS "Membership_userId_fkey";
ALTER TABLE crm."Employee"   DROP CONSTRAINT IF EXISTS "Employee_userId_fkey";
ALTER TABLE crm."User"       DROP CONSTRAINT IF EXISTS "User_id_authusers_fkey";

ALTER TABLE crm."User"       ALTER COLUMN id       TYPE text USING id::text;
ALTER TABLE crm."Membership" ALTER COLUMN "userId" TYPE text USING "userId"::text;
ALTER TABLE crm."Employee"   ALTER COLUMN "userId" TYPE text USING "userId"::text;

ALTER TABLE crm."Membership" ADD CONSTRAINT "Membership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES crm."User"(id) ON DELETE CASCADE;
ALTER TABLE crm."Employee" ADD CONSTRAINT "Employee_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES crm."User"(id) ON DELETE SET NULL;

-- Columnas auth: re-crear vacías (los valores requieren backup).
ALTER TABLE crm."User"
  ADD COLUMN IF NOT EXISTS "passwordHash"      text,
  ADD COLUMN IF NOT EXISTS "passwordChangedAt" timestamp without time zone,
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt"   timestamp without time zone,
  ADD COLUMN IF NOT EXISTS status              text;
-- crm."AuthToken": re-crear desde prisma (prisma migrate deploy) o backup — no se modela aquí.

-- ---------- AA: revertir admin ----------
ALTER TABLE aa."User" ALTER COLUMN id TYPE text USING id::text;
ALTER TABLE aa."User" ADD COLUMN IF NOT EXISTS "passwordHash" text;
-- (restaurar valor passwordHash y cuid original desde aa_backup_*.dump si se requiere)
DELETE FROM auth.identities WHERE provider = 'email'
  AND email = (SELECT email FROM aa."User" LIMIT 1);
DELETE FROM auth.users WHERE email = (SELECT email FROM aa."User" LIMIT 1);
