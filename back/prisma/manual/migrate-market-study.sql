-- Migración MarketStudy (P8)
-- Idempotente: se puede ejecutar varias veces sin romper nada.
-- Ejecutar con: npx prisma db execute --file prisma/migrate-market-study.sql
-- Después: npm run db:push  (o npx prisma generate && npx prisma db push)

CREATE TABLE IF NOT EXISTS "MarketStudy" (
  "id"        TEXT        NOT NULL,
  "title"     TEXT        NOT NULL,
  "inputs"    JSONB       NOT NULL DEFAULT '{}',
  "sections"  JSONB       NOT NULL DEFAULT '[]',
  "prospects" JSONB       NOT NULL DEFAULT '[]',
  "status"    TEXT        NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketStudy_pkey" PRIMARY KEY ("id")
);

-- Index on createdAt (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'MarketStudy' AND indexname = 'MarketStudy_createdAt_idx'
  ) THEN
    CREATE INDEX "MarketStudy_createdAt_idx" ON "MarketStudy"("createdAt");
  END IF;
END $$;
