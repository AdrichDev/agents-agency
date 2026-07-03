-- back/prisma/migrate-agent-runtime.sql
-- F1 (openspec/changes/aa-openclaw-brain): añade Agent.runtime.
-- Aditivo puro (ADD COLUMN con DEFAULT) — no toca tablas de otros dominios,
-- no hace DROP. Filas existentes quedan en "openai" (comportamiento actual
-- intacto, zero regresión). Ver COMMANDS.md § Migraciones Prisma.
--
-- Aplicar manualmente contra Supabase (esta migración NO se aplica desde
-- este cambio — pendiente de aplicación por el orquestador):
--   psql "$DATABASE_URL" -f back/prisma/migrate-agent-runtime.sql
-- Después: cd back && npm run generate

BEGIN;

ALTER TABLE aa.agente
  ADD COLUMN IF NOT EXISTS "motor" TEXT NOT NULL DEFAULT 'openai';

COMMIT;
