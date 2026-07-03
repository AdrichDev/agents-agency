-- back/prisma/migrate-channel-connection-metadata.sql
-- F2 (openspec/changes/aa-openclaw-brain): añade ChannelConnection.metadata.
-- Aditivo puro (ADD COLUMN con DEFAULT) — no toca tablas de otros dominios,
-- no hace DROP. Filas existentes quedan en "{}" (comportamiento actual
-- intacto, zero regresión). Guarda { managedBy: "openclaw" } cuando OpenClaw
-- pasa a poseer el canal (handover de Telegram, ver lib/openclaw/provision.ts).
-- Ver COMMANDS.md § Migraciones Prisma.
--
-- Aplicar manualmente contra Supabase (esta migración NO se aplica desde
-- este cambio — pendiente de aplicación por el orquestador):
--   psql "$DATABASE_URL" -f back/prisma/migrate-channel-connection-metadata.sql
-- Después: cd back && npm run generate

BEGIN;

ALTER TABLE aa.conexion_canal
  ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
