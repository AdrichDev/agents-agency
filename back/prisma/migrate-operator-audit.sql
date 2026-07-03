-- back/prisma/migrate-operator-audit.sql
-- F1 (openspec/changes/aa-operator-agent): tabla de auditoría del Operator Agent.
-- Aditivo puro (CREATE TABLE IF NOT EXISTS) — no toca tablas de otros dominios,
-- no hace DROP. Registra cada escritura del router /service/operator.
--
-- Aplicar manualmente contra Supabase (esta migración NO se aplica desde
-- este cambio — pendiente de aplicación por el orquestador):
--   psql "$DATABASE_URL" -f back/prisma/migrate-operator-audit.sql
-- Después: cd back && npm run generate

BEGIN;

CREATE TABLE IF NOT EXISTS aa.operator_audit (
  "id"        TEXT PRIMARY KEY,
  "accion"    TEXT NOT NULL,
  "payload"   JSONB NOT NULL DEFAULT '{}',
  "origen"    TEXT NOT NULL,
  "resultado" TEXT NOT NULL,
  "detalle"   TEXT,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "operator_audit_creado_en_idx"
  ON aa.operator_audit ("creado_en");

COMMIT;
