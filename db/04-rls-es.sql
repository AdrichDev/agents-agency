-- ============================================================================
-- 04-rls-es.sql — RLS + FKs + Storage policies para el schema crm en castellano.
-- Reemplaza la sección RLS de 03-auth-supabase-phase1.sql tras renombrar las tablas
-- y columnas crm a snake_case español (negocio, cliente, membresia, usuario_id,
-- negocio_id, …). Idempotente. Correr con ON_ERROR_STOP=1 contra el session pooler.
--
-- Enum VALUES intactos: la RLS sigue filtrando por role<>'CLIENT' (rol en DB).
-- ============================================================================

-- ---------- FKs hacia auth.users (re-aplicadas tras db push) ----------
ALTER TABLE crm.usuario  DROP CONSTRAINT IF EXISTS usuario_id_authusers_fkey;
ALTER TABLE crm.usuario  ADD CONSTRAINT usuario_id_authusers_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE crm.cliente  DROP CONSTRAINT IF EXISTS cliente_usuario_id_authusers_fkey;
ALTER TABLE crm.cliente  ADD CONSTRAINT cliente_usuario_id_authusers_fkey
  FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------- FK cross-schema crm.negocio.tenant_id → aa.tenant.id ----------
ALTER TABLE crm.negocio DROP CONSTRAINT IF EXISTS negocio_tenant_id_fkey;
ALTER TABLE crm.negocio ADD CONSTRAINT negocio_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES aa.tenant(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS negocio_tenant_id_idx ON crm.negocio (tenant_id);

-- Índice para el join de las policies RLS
CREATE INDEX IF NOT EXISTS membresia_usuario_negocio_idx
  ON crm.membresia ("usuario_id", "negocio_id");

-- ---------- RLS: ENABLE + FORCE en todas las tablas crm.* (idempotente) ----------
-- Sin ENABLE las policies son NO-OP y el GRANT SELECT a authenticated expondría todo.
-- FORCE cierra el escape por owner no-bypass.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='crm' LOOP
    EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;

-- ---------- RLS: policies. Solo LECTURA (writes diferidos) ----------
-- membresia: el usuario ve sus propias membresías.
DROP POLICY IF EXISTS membresia_self_read ON crm.membresia;
CREATE POLICY membresia_self_read ON crm.membresia
  FOR SELECT TO authenticated
  USING ("usuario_id" = auth.uid());

-- cliente: staff del negocio ve todos; el propio cliente ve su fila.
DROP POLICY IF EXISTS cliente_read ON crm.cliente;
CREATE POLICY cliente_read ON crm.cliente
  FOR SELECT TO authenticated
  USING (
    "usuario_id" = auth.uid()
    OR "negocio_id" IN (
      SELECT "negocio_id" FROM crm.membresia
      WHERE "usuario_id" = auth.uid() AND rol <> 'CLIENT'
    )
  );

-- Resto de tablas con negocio_id: solo STAFF del negocio (rol<>'CLIENT').
DO $$
DECLARE t text;
  staff_tables text[] := ARRAY[
    'reserva','config_negocio','campana','paquete_cliente','documento','empleado',
    'fichaje','factura','sucursal','notificacion','paquete','producto','recurso',
    'venta','servicio','etiqueta','solicitud_ausencia'
  ];
BEGIN
  FOREACH t IN ARRAY staff_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_negocio_read ON crm.%I;', t);
    EXECUTE format($f$
      CREATE POLICY staff_negocio_read ON crm.%I
        FOR SELECT TO authenticated
        USING ("negocio_id" IN (
          SELECT "negocio_id" FROM crm.membresia
          WHERE "usuario_id" = auth.uid() AND rol <> 'CLIENT'
        ));
    $f$, t);
  END LOOP;
END $$;

-- authenticated necesita USAGE + SELECT para que las policies apliquen (writes diferidos).
GRANT USAGE ON SCHEMA crm TO authenticated;
GRANT SELECT ON
  crm.membresia, crm.cliente, crm.reserva, crm.config_negocio, crm.campana,
  crm.paquete_cliente, crm.documento, crm.empleado, crm.fichaje, crm.factura,
  crm.sucursal, crm.notificacion, crm.paquete, crm.producto, crm.recurso,
  crm.venta, crm.servicio, crm.etiqueta, crm.solicitud_ausencia
  TO authenticated;

-- ---------- Storage policies (storage.objects) reescritas a identificadores ES ----------
-- branding (logos por negocio): escritura/actualización solo para staff del negocio.
-- Convención de ruta: <negocio_id>/<archivo> dentro del bucket 'tenant-branding'.
DROP POLICY IF EXISTS tbranding_write ON storage.objects;
CREATE POLICY tbranding_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-branding'
    AND (storage.foldername(name))[1] IN (
      SELECT "negocio_id" FROM crm.membresia
      WHERE "usuario_id" = auth.uid() AND rol <> 'CLIENT'
    )
  );

DROP POLICY IF EXISTS tbranding_update ON storage.objects;
CREATE POLICY tbranding_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'tenant-branding'
    AND (storage.foldername(name))[1] IN (
      SELECT "negocio_id" FROM crm.membresia
      WHERE "usuario_id" = auth.uid() AND rol <> 'CLIENT'
    )
  );

-- documents (adjuntos por negocio): lectura/escritura para staff del negocio.
DROP POLICY IF EXISTS documents_tenant_rw ON storage.objects;
CREATE POLICY documents_tenant_rw ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (
      SELECT "negocio_id" FROM crm.membresia
      WHERE "usuario_id" = auth.uid() AND rol <> 'CLIENT'
    )
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (
      SELECT "negocio_id" FROM crm.membresia
      WHERE "usuario_id" = auth.uid() AND rol <> 'CLIENT'
    )
  );

-- ---------- PostgREST: recargar caché de schema ----------
NOTIFY pgrst, 'reload schema';
