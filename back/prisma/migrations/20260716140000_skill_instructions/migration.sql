-- aa-agent-skills-install-execute F1 (T1.1)
-- Migracion ADITIVA: añade el snapshot de instrucciones curadas a `skill`
-- (motor de instrucciones, invariante instalada ⇒ ejecutable). NO altera ni
-- borra columnas existentes. null permitido: una skill sigue siendo instalable
-- sin cuerpo curado (el baseline cae a descripcion/uso en runtime via usar_skill).

-- AlterTable
ALTER TABLE "skill" ADD COLUMN "instrucciones" TEXT;
ALTER TABLE "skill" ADD COLUMN "instrucciones_actualizado_en" TIMESTAMP(3);
