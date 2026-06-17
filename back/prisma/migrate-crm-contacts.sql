-- Migración aditiva idempotente: CRM contactos (Bloque D — crm-contacts-and-polish)
-- Crea enums ContactType/ContactedStatus, añade Client.codCliente + Client.direccion
-- (con backfill secuencial cli-NN) y la tabla ProspectContact.
--
-- SEGURA: solo ADD/CREATE; NUNCA DROP. Re-ejecutable sin error (IF NOT EXISTS / DO blocks).
-- Ejecutar: npx prisma db execute --file prisma/migrate-crm-contacts.sql --schema prisma/schema.prisma
--           && npx prisma generate
-- Nombres de índice/constraint alineados con los que genera Prisma para evitar drift.

BEGIN;

-- 1. Enums (idempotente: ignora si el tipo ya existe)
DO $$ BEGIN
  CREATE TYPE "ContactType" AS ENUM ('lead', 'prospecto');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ContactedStatus" AS ENUM ('si', 'no', 'nc');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Columnas nuevas en Client
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "codCliente" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "direccion" TEXT;

-- 3. Backfill de codCliente para los clientes sin código (cli-NN secuencial,
--    continuando desde el máximo existente, ordenados por antigüedad).
WITH base AS (
  SELECT COALESCE(
    MAX(CAST(substring("codCliente" FROM '^cli-([0-9]+)$') AS INTEGER)), 0
  ) AS maxn
  FROM "Client"
  WHERE "codCliente" ~ '^cli-[0-9]+$'
),
ranked AS (
  SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS rn
  FROM "Client"
  WHERE "codCliente" IS NULL
)
UPDATE "Client" c
SET "codCliente" = 'cli-' || lpad((base.maxn + ranked.rn)::text, 2, '0')
FROM ranked, base
WHERE c.id = ranked.id;

-- 4. Unique en codCliente (tras el backfill). Nombre = el de Prisma @unique.
CREATE UNIQUE INDEX IF NOT EXISTS "Client_codCliente_key" ON "Client"("codCliente");

-- 5. Tabla ProspectContact
CREATE TABLE IF NOT EXISTS "ProspectContact" (
  "id"          TEXT NOT NULL,
  "codigo"      TEXT NOT NULL,
  "type"        "ContactType" NOT NULL DEFAULT 'prospecto',
  "name"        TEXT NOT NULL,
  "phone"       TEXT,
  "email"       TEXT,
  "sector"      TEXT,
  "direccion"   TEXT,
  "peticion"    TEXT,
  "contactado"  "ContactedStatus" NOT NULL DEFAULT 'no',
  "contactedAt" TIMESTAMP(3),
  "clientId"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"   TIMESTAMP(3),
  CONSTRAINT "ProspectContact_pkey" PRIMARY KEY ("id")
);

-- 6. Índices de ProspectContact (unique codigo + los @@index del schema)
CREATE UNIQUE INDEX IF NOT EXISTS "ProspectContact_codigo_key" ON "ProspectContact"("codigo");
CREATE INDEX IF NOT EXISTS "ProspectContact_type_contactado_idx" ON "ProspectContact"("type", "contactado");
CREATE INDEX IF NOT EXISTS "ProspectContact_createdAt_idx" ON "ProspectContact"("createdAt");
CREATE INDEX IF NOT EXISTS "ProspectContact_deletedAt_idx" ON "ProspectContact"("deletedAt");

-- 7. FK ProspectContact.clientId → Client.id (SetNull al borrar cliente).
DO $$ BEGIN
  ALTER TABLE "ProspectContact"
    ADD CONSTRAINT "ProspectContact_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

COMMIT;
