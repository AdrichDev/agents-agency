-- ============================================================================
-- check-security.sql — Gate de postura RLS/grants para Supabase (crm + aa).
-- Uso (CI o manual):
--   psql "<session-pooler-conn>" -v ON_ERROR_STOP=1 -f db/check-security.sql
-- Falla (raise exception) si la postura se degrada. Idempotente / read-only.
-- ============================================================================

DO $$
DECLARE
  v_total int;
  v_enabled int;
  v_forced int;
  v_write_grants int;
  v_aa_anon_select int;
  v_anon_aa_usage boolean;
BEGIN
  -- 1. RLS ENABLED + FORCED en todas las tablas crm.*
  SELECT count(*),
         count(*) FILTER (WHERE relrowsecurity),
         count(*) FILTER (WHERE relforcerowsecurity)
    INTO v_total, v_enabled, v_forced
  FROM pg_class WHERE relnamespace = 'crm'::regnamespace AND relkind = 'r';

  IF v_enabled <> v_total THEN
    RAISE EXCEPTION 'SECURITY FAIL: RLS no habilitado en % de % tablas crm', v_total - v_enabled, v_total;
  END IF;
  IF v_forced <> v_total THEN
    RAISE EXCEPTION 'SECURITY FAIL: FORCE RLS no aplicado en % de % tablas crm', v_total - v_forced, v_total;
  END IF;

  -- 2. CERO grants de escritura a anon/authenticated en crm/aa (writes diferidos)
  SELECT count(*) INTO v_write_grants
  FROM information_schema.role_table_grants
  WHERE table_schema IN ('crm','aa')
    AND grantee IN ('anon','authenticated')
    AND privilege_type IN ('INSERT','UPDATE','DELETE');
  IF v_write_grants <> 0 THEN
    RAISE EXCEPTION 'SECURITY FAIL: % grants de escritura a anon/authenticated en crm/aa', v_write_grants;
  END IF;

  -- 3. aa (sin RLS) no expuesto a anon: ni USAGE ni SELECT de tabla
  SELECT has_schema_privilege('anon','aa','USAGE') INTO v_anon_aa_usage;
  IF v_anon_aa_usage THEN
    RAISE EXCEPTION 'SECURITY FAIL: anon tiene USAGE en schema aa (revocar)';
  END IF;

  SELECT count(*) INTO v_aa_anon_select
  FROM information_schema.role_table_grants
  WHERE table_schema = 'aa' AND grantee IN ('anon','authenticated') AND privilege_type = 'SELECT';
  IF v_aa_anon_select <> 0 THEN
    RAISE EXCEPTION 'SECURITY FAIL: % grants SELECT a anon/authenticated en aa.*', v_aa_anon_select;
  END IF;

  RAISE NOTICE 'SECURITY OK: crm RLS % enabled/% forced; 0 write grants; aa no expuesto a anon.', v_enabled, v_forced;
END $$;
