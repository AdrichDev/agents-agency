-- migrate-automation-n8n.sql
-- Adds n8n integration columns to Automation table (non-destructive).
-- Legacy rows will have n8nWorkflowId=NULL and syncStatus='pending' (cron covers them).
--
-- Rollback:
--   ALTER TABLE "Automation" DROP COLUMN "n8nWorkflowId";
--   ALTER TABLE "Automation" DROP COLUMN "syncStatus";

ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "n8nWorkflowId" TEXT;
ALTER TABLE "Automation" ADD COLUMN IF NOT EXISTS "syncStatus" TEXT NOT NULL DEFAULT 'pending';
