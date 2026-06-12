-- Migration: add successScore to MarketStudy
-- Run: psql $DATABASE_URL -f prisma/migrate-market-study-score.sql
-- Or: npx prisma db push (handled via schema.prisma)

ALTER TABLE "MarketStudy" ADD COLUMN IF NOT EXISTS "successScore" INTEGER;
