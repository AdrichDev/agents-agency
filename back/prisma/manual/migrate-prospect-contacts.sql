-- Migration: prospect contacts + client business code
--   * Client: codCliente (unique, cli-NN) + direccion
--   * New enums ContactType / ContactedStatus
--   * New table ProspectContact (codigo pc-NN, FK opcional a Client)
--   * SystemConfig: adminEmail (destinatario de notificaciones de leads)
--   * Backfill: asigna codCliente secuencial por createdAt a los clientes existentes
-- Run: psql $DATABASE_URL -f prisma/migrate-prospect-contacts.sql
-- Or: npx prisma db push (handled via schema.prisma) + tsx scripts/backfill-cod-cliente.ts

-- ── Client ────────────────────────────────────────────────────────────────────
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "codCliente" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "direccion" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Client_codCliente_key" ON "Client"("codCliente");

-- ── Enums ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ContactType" AS ENUM ('lead', 'prospecto');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ContactedStatus" AS ENUM ('si', 'no', 'nc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ProspectContact ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ProspectContact" (
  "id"          TEXT NOT NULL,
  "codigo"      TEXT NOT NULL,
  "type"        "ContactType" NOT NULL DEFAULT 'prospecto',
  "name"        TEXT NOT NULL,
  "phone"       TEXT,
  "email"       TEXT,
  "sector"      TEXT,
  "direccion"   TEXT,
  "contactado"  "ContactedStatus" NOT NULL DEFAULT 'nc',
  "contactedAt" TIMESTAMP(3),
  "clientId"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProspectContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProspectContact_codigo_key" ON "ProspectContact"("codigo");
CREATE INDEX IF NOT EXISTS "ProspectContact_type_contactado_idx" ON "ProspectContact"("type", "contactado");
CREATE INDEX IF NOT EXISTS "ProspectContact_createdAt_idx" ON "ProspectContact"("createdAt");

DO $$ BEGIN
  ALTER TABLE "ProspectContact"
    ADD CONSTRAINT "ProspectContact_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── SystemConfig ──────────────────────────────────────────────────────────────
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "adminEmail" TEXT;

-- ── Backfill codCliente (cli-01, cli-02... por createdAt) ────────────────────
WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "Client"
  WHERE "codCliente" IS NULL
)
UPDATE "Client" c
SET "codCliente" = 'cli-' || LPAD(ordered.rn::TEXT, 2, '0')
FROM ordered
WHERE c."id" = ordered."id"
  -- Solo seguro cuando ningún cliente tiene código todavía; si hubiera códigos
  -- previos, usar scripts/backfill-cod-cliente.ts que continúa desde el máximo.
  AND NOT EXISTS (SELECT 1 FROM "Client" WHERE "codCliente" IS NOT NULL);
