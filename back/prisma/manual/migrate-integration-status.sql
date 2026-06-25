-- Migración manual: columna status en Integration + unificación gmail/calendar → google
-- Ejecutar con: psql $DATABASE_URL -f migrate-integration-status.sql
-- Luego: npx prisma generate && npx prisma db push

-- Paso 1: añadir columna status (no destructivo)
ALTER TABLE "Integration"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'connected';

-- Paso 2: unificación google (D-P2-1)
-- BACKUP OBLIGATORIO antes de ejecutar este bloque.
-- El script encrypt-tokens.ts genera back/prisma/backup-integrations-<timestamp>.json.
-- NO ejecutar este bloque sin el backup escrito en disco.

-- Por cada agentId con filas gmail/calendar, crear una fila google
-- conservando el refreshToken más reciente (mayor createdAt).
-- Luego eliminar las filas gmail y calendar.

DO $$
DECLARE
  r RECORD;
  existing_google TEXT;
  best_refresh TEXT;
  best_expires TIMESTAMP WITH TIME ZONE;
  best_access TEXT;
  best_meta JSONB;
BEGIN
  FOR r IN
    SELECT DISTINCT "agentId"
    FROM "Integration"
    WHERE "provider" IN ('gmail', 'calendar')
  LOOP
    -- Verificar si ya existe fila google para este agente
    SELECT id INTO existing_google
    FROM "Integration"
    WHERE "agentId" = r."agentId" AND "provider" = 'google'
    LIMIT 1;

    -- Tomar los valores más recientes entre gmail y calendar (R2-2-a)
    SELECT "accessToken", "refreshToken", "expiresAt", "metadata"
    INTO best_access, best_refresh, best_expires, best_meta
    FROM "Integration"
    WHERE "agentId" = r."agentId" AND "provider" IN ('gmail', 'calendar')
    ORDER BY "createdAt" DESC
    LIMIT 1;

    IF existing_google IS NULL THEN
      INSERT INTO "Integration" ("id", "agentId", "provider", "accessToken", "refreshToken", "expiresAt", "status", "metadata", "createdAt")
      VALUES (
        gen_random_uuid()::text,
        r."agentId",
        'google',
        best_access,
        best_refresh,
        best_expires,
        'connected',
        COALESCE(best_meta, '{}'),
        NOW()
      )
      ON CONFLICT ("agentId", "provider") DO NOTHING;
    ELSE
      -- Ya existe fila google: actualizar con el refreshToken más reciente de gmail/calendar
      UPDATE "Integration"
      SET
        "refreshToken" = best_refresh,
        "expiresAt"   = best_expires
      WHERE "id" = existing_google;
    END IF;

    -- Eliminar filas gmail y calendar (la fila google ya existe o acaba de crearse)
    DELETE FROM "Integration"
    WHERE "agentId" = r."agentId" AND "provider" IN ('gmail', 'calendar');
  END LOOP;
END $$;
