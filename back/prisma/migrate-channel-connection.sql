-- migrate-channel-connection.sql
-- Crea la tabla ChannelConnection para canales de mensajería (Telegram/WhatsApp).
-- Idempotente: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- Rollback: DROP TABLE "ChannelConnection";
--
-- Ejecutar antes de: npx prisma generate && npx prisma db push

CREATE TABLE IF NOT EXISTS "ChannelConnection" (
  "id"            TEXT        NOT NULL,
  "agentId"       TEXT        NOT NULL,
  "provider"      TEXT        NOT NULL,
  "credentials"   JSONB       NOT NULL,
  "status"        TEXT        NOT NULL DEFAULT 'pending',
  "statusDetail"  TEXT,
  "webhookSecret" TEXT,
  "botUsername"   TEXT,
  "botName"       TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelConnection_agentId_provider_key"
  ON "ChannelConnection" ("agentId", "provider");

-- FK hacia Agent (solo añade si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ChannelConnection_agentId_fkey'
      AND table_name = 'ChannelConnection'
  ) THEN
    ALTER TABLE "ChannelConnection"
      ADD CONSTRAINT "ChannelConnection_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
