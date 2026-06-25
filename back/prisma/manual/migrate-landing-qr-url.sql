-- Migration: add LandingProject.qrUrl column
-- Run with: npx prisma db execute --file prisma/migrate-landing-qr-url.sql
-- Or simply: npm run db:push

ALTER TABLE "LandingProject" ADD COLUMN IF NOT EXISTS "qrUrl" TEXT;
