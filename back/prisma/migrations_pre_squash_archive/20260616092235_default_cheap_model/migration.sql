-- AlterTable
ALTER TABLE "Agent" ALTER COLUMN "model" SET DEFAULT 'gpt-4.1-nano';

-- AlterTable
ALTER TABLE "SystemConfig" ALTER COLUMN "defaultAgentModel" SET DEFAULT 'gpt-4.1-nano';
