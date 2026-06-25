-- Migración: Agent.ecommerceConfig (horario comercial, handoff Slack, order status).
-- Idempotente. Ejecutar: npx prisma db execute --file prisma/migrate-ecommerce-config.sql
-- Rollback: ALTER TABLE "Agent" DROP COLUMN IF EXISTS "ecommerceConfig";
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "ecommerceConfig" JSONB NOT NULL DEFAULT '{}';
