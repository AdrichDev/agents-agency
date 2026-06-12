-- Migration: add LandingProject table
-- Run with: npx prisma db execute --file prisma/migrate-landing-project.sql
-- Or simply: npm run db:push

CREATE TABLE IF NOT EXISTS "LandingProject" (
  "id"               TEXT        NOT NULL,
  "name"             TEXT        NOT NULL,
  "business"         TEXT,
  "answers"          JSONB       NOT NULL DEFAULT '{}',
  "generationPrompt" TEXT,
  "dbProvider"       TEXT        NOT NULL DEFAULT 'none',
  "files"            JSONB       NOT NULL DEFAULT '{}',
  "mobileFiles"      JSONB       NOT NULL DEFAULT '{}',
  "mobileStack"      TEXT,
  "status"           TEXT        NOT NULL DEFAULT 'draft',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LandingProject_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LandingProject_updatedAt_idx" ON "LandingProject"("updatedAt");
