-- Migration: soft delete on prospect contacts
-- ProspectContact.deletedAt: timestamp del borrado lógico (NULL = activo).
-- Los listados/contador/conversión filtran deletedAt IS NULL.
ALTER TABLE "ProspectContact" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "ProspectContact_deletedAt_idx" ON "ProspectContact" ("deletedAt");
