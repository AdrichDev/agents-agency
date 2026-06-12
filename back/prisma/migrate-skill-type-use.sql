-- Migración Skill: category → use (UPPERCASE) + nueva columna type (enum 5 valores)
-- Idempotente: se puede ejecutar varias veces sin romper nada.
-- Ejecutar con: npx prisma db execute --file prisma/migrate-skill-type-use.sql
-- Después: npm run db:push

-- 1) Renombrar category → use (solo si todavía existe la columna antigua)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Skill' AND column_name = 'category'
  ) THEN
    ALTER TABLE "Skill" RENAME COLUMN "category" TO "use";
  END IF;
END $$;

-- 2) Use siempre en UPPERCASE y nunca vacío
ALTER TABLE "Skill" ALTER COLUMN "use" SET DEFAULT 'GENERAL';
UPDATE "Skill" SET "use" = UPPER(COALESCE(NULLIF(TRIM("use"), ''), 'GENERAL'));

-- 3) Enum SkillType (5 valores permitidos)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SkillType') THEN
    CREATE TYPE "SkillType" AS ENUM ('SKILL', 'AGENT', 'EXTENSION', 'PLUGIN', 'MCP');
  END IF;
END $$;

-- 4) Nueva columna type
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "type" "SkillType" NOT NULL DEFAULT 'SKILL';

-- 5) Backfill del type a partir del valor antiguo de category (que mezclaba tipos y usos)
UPDATE "Skill" SET "type" = CASE
  WHEN "use" = 'MCP' THEN 'MCP'::"SkillType"
  WHEN "use" IN ('AGENTES', 'AGENTS', 'AGENTE', 'AGENT') THEN 'AGENT'::"SkillType"
  WHEN "use" IN ('EXTENSIONES', 'EXTENSIONS', 'EXTENSION', 'EXTENSIÓN') THEN 'EXTENSION'::"SkillType"
  WHEN "use" IN ('PLUGINS', 'PLUGIN') THEN 'PLUGIN'::"SkillType"
  ELSE 'SKILL'::"SkillType"
END
WHERE "type" = 'SKILL';

-- 6) Los valores de use que en realidad eran tipos pasan a GENERAL.
--    (El uso real se recalcula con IA al volver a pulsar "Importar de GitHub" / "Importar de Google")
UPDATE "Skill" SET "use" = 'GENERAL'
WHERE "use" IN ('MCP', 'AGENTES', 'AGENTS', 'AGENTE', 'AGENT',
                'EXTENSIONES', 'EXTENSIONS', 'EXTENSION', 'EXTENSIÓN',
                'PLUGINS', 'PLUGIN');
