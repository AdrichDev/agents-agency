-- aa-agent-external-crm-and-lead-qualification F2 (T2.1)
-- Migracion ADITIVA: agrega calificacion de lead (hot/warm/cold/unknown) +
-- motivo a la tabla `lead` ya existente. NO borra ni altera columnas
-- existentes, NO requiere backfill (DEFAULT cubre las filas actuales).

-- AlterTable
ALTER TABLE "lead" ADD COLUMN "calificacion" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "lead" ADD COLUMN "motivo_calificacion" TEXT;
