-- Añade la columna config a Automation (configuración estructurada de la automatización)
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "config" JSONB NOT NULL DEFAULT '{}';
