-- Migration: add chatMessages column to LandingProject
ALTER TABLE "LandingProject" ADD COLUMN IF NOT EXISTS "chatMessages" JSONB NOT NULL DEFAULT '[]';
