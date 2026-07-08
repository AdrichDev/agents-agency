-- AlterTable
ALTER TABLE "MarketStudy" ADD COLUMN     "model" TEXT NOT NULL DEFAULT 'gpt-4.1-nano',
ADD COLUMN     "reasoningEffort" TEXT NOT NULL DEFAULT 'low';
