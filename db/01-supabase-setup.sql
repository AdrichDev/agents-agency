-- ============================================================================
-- 01-supabase-setup.sql — Idempotente. Correr UNA vez contra Supabase (SQL Editor
-- o psql con la conexión DIRECTA, puerto 5432). Prepara schemas, extensión y grants
-- ANTES de hacer prisma db push y cargar datos.
-- ============================================================================

-- Schemas destino (aa = agents-agency / tenant canónico; crm = OperaOS).
CREATE SCHEMA IF NOT EXISTS aa;
CREATE SCHEMA IF NOT EXISTS crm;

-- pgvector vive en el schema `extensions` de Supabase (NO en public).
-- Solo AA lo usa (aa.knowledge_chunk.embedding vector(1536)).
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Grants para que PostgREST / RLS / Prisma vean los schemas nuevos.
GRANT USAGE ON SCHEMA aa  TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA crm TO authenticated, anon, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA aa  TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA aa  TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA crm TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA crm TO service_role;

-- Que los privilegios apliquen a objetos creados después (por prisma db push).
ALTER DEFAULT PRIVILEGES IN SCHEMA aa  GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA aa  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm GRANT ALL ON SEQUENCES TO service_role;
