-- ============================================================================
-- 03-auth-supabase-phase1.sql — SDD auth-supabase-migration, FASE 1 (DB).
-- Idempotente donde se puede. Correr en UNA transacción (ON_ERROR_STOP=1) contra
-- Supabase (session pooler 5432). Reversible con 03-auth-supabase-phase1-rollback.sql.
--
-- Precondición verificada (2026-06-18): crm.User/Membership/Employee/AuthToken/Customer
-- = 0 filas; aa.User = 1 (admin achozas9@gmail.com, id cuid). auth.users = 0.
-- Estrategia: Opción B. PK identidad = auth.users.id (uuid). RLS = Membership join
-- (staff-only, role<>'CLIENT'); portal CLIENT fino se hará en Fase 3. Q-A: Customer.userId
-- FK -> auth.users. Q-C: policies de ESCRITURA diferidas.
-- ============================================================================

-- ---------- AA: migrar el único admin a auth.users (password bcrypt preservado) ----------
DO $$
DECLARE uid uuid := gen_random_uuid();
DECLARE pw  text;
DECLARE em  text;
BEGIN
  SELECT "passwordHash", email INTO pw, em FROM aa."User" LIMIT 1;

  -- OJO: los token cols (confirmation_token, recovery_token, email_change*, etc.) deben ir
  -- a '' (NO NULL): GoTrue los escanea como string NOT NULL y un NULL provoca
  -- "Database error finding users" (500) en admin.listUsers / cualquier flujo admin.
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em, pw,
    now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', '', '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, provider, identity_data, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), uid, uid::text, 'email',
    jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true),
    now(), now()
  );

  UPDATE aa."User" SET id = uid::text;  -- repoint id al uuid (sin FKs entrantes)
END $$;

ALTER TABLE aa."User" ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE aa."User" DROP COLUMN IF EXISTS "passwordHash";
-- AA conserva `role` (admin ve todo, app-level). Sin RLS en aa.

-- ---------- CRM: PK cuid -> uuid (tablas vacías) + DROP AuthToken ----------
ALTER TABLE crm."Membership" DROP CONSTRAINT IF EXISTS "Membership_userId_fkey";
ALTER TABLE crm."Employee"   DROP CONSTRAINT IF EXISTS "Employee_userId_fkey";
ALTER TABLE crm."AuthToken"  DROP CONSTRAINT IF EXISTS "AuthToken_userId_fkey";

ALTER TABLE crm."User"       ALTER COLUMN id       TYPE uuid USING id::uuid;
ALTER TABLE crm."Membership" ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid;
ALTER TABLE crm."Employee"   ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid;

-- Perfil CRM ligado a la identidad global
ALTER TABLE crm."User" ADD CONSTRAINT "User_id_authusers_fkey"
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE crm."Membership" ADD CONSTRAINT "Membership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES crm."User"(id) ON DELETE CASCADE;
ALTER TABLE crm."Employee" ADD CONSTRAINT "Employee_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES crm."User"(id) ON DELETE SET NULL;

-- Columnas que ahora gestiona Supabase Auth
ALTER TABLE crm."User"
  DROP COLUMN IF EXISTS "passwordHash",
  DROP COLUMN IF EXISTS "passwordChangedAt",
  DROP COLUMN IF EXISTS "emailVerifiedAt",
  DROP COLUMN IF EXISTS status;

DROP TABLE IF EXISTS crm."AuthToken";

-- Q-A: vínculo explícito Customer -> identidad (para portal /me/*)
ALTER TABLE crm."Customer" ADD COLUMN IF NOT EXISTS "userId" uuid;
ALTER TABLE crm."Customer" ADD CONSTRAINT "Customer_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_userId_key" ON crm."Customer"("userId");

-- Índice para el join de las policies RLS
CREATE INDEX IF NOT EXISTS membership_user_business_idx
  ON crm."Membership" ("userId", "businessId");

-- ---------- RLS: ENABLE + FORCE en todas las tablas crm.* (idempotente) ----------
-- IMPORTANTE: sin ENABLE, las policies de abajo son NO-OP y el GRANT SELECT a
-- authenticated expondria TODO. FORCE cierra el escape por owner no-bypass.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='crm' LOOP
    EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;

-- ---------- RLS: policies. Solo LECTURA (Q-C difiere writes) ----------
-- Membership: el usuario ve sus propias membresías.
DROP POLICY IF EXISTS membership_self_read ON crm."Membership";
CREATE POLICY membership_self_read ON crm."Membership"
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid());

-- Customer: staff del negocio ve todos; el propio cliente ve su fila.
DROP POLICY IF EXISTS customer_read ON crm."Customer";
CREATE POLICY customer_read ON crm."Customer"
  FOR SELECT TO authenticated
  USING (
    "userId" = auth.uid()
    OR "businessId" IN (
      SELECT "businessId" FROM crm."Membership"
      WHERE "userId" = auth.uid() AND role <> 'CLIENT'
    )
  );

-- Resto de tablas con businessId: solo STAFF del negocio (role<>'CLIENT').
-- (El portal CLIENT /me/* con scoping por cliente se añade en Fase 3.)
DO $$
DECLARE t text;
  staff_tables text[] := ARRAY[
    'Booking','BusinessSetting','Campaign','CustomerPackage','Document','Employee',
    'Fichaje','Invoice','Location','Notification','Package','Product','Resource',
    'Sale','SectorModule','Service','Tag','TimeOffRequest'
  ];
BEGIN
  FOREACH t IN ARRAY staff_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_business_read ON crm.%I;', t);
    EXECUTE format($f$
      CREATE POLICY staff_business_read ON crm.%I
        FOR SELECT TO authenticated
        USING ("businessId" IN (
          SELECT "businessId" FROM crm."Membership"
          WHERE "userId" = auth.uid() AND role <> 'CLIENT'
        ));
    $f$, t);
  END LOOP;
END $$;

-- authenticated necesita USAGE + SELECT para que las policies apliquen (writes diferidos).
GRANT USAGE ON SCHEMA crm TO authenticated;
GRANT SELECT ON
  crm."Membership", crm."Customer", crm."Booking", crm."BusinessSetting", crm."Campaign",
  crm."CustomerPackage", crm."Document", crm."Employee", crm."Fichaje", crm."Invoice",
  crm."Location", crm."Notification", crm."Package", crm."Product", crm."Resource",
  crm."Sale", crm."SectorModule", crm."Service", crm."Tag", crm."TimeOffRequest"
  TO authenticated;
