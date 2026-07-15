-- aa-agent-backend-foundation F1 (T1.1 + T1.2)
-- Migracion ADITIVA: crea `backend_datos_agente` (1:1 con `agente`) y
-- backfillea una fila por agente existente. NO altera ni borra columnas de
-- tablas existentes (config_ecommerce queda intacta: sigue siendo la fuente
-- legada de get_order_status — retrocompat T1.3).

-- CreateTable
CREATE TABLE "backend_datos_agente" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "modo" TEXT NOT NULL DEFAULT 'none_yet',
    "db_url_cifrada" TEXT,
    "esquema_db" JSONB NOT NULL DEFAULT '{}',
    "api_base_url" TEXT,
    "api_key_cifrada" TEXT,
    "capacidades" JSONB NOT NULL DEFAULT '[]',
    "config_notificaciones" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backend_datos_agente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "backend_datos_agente_agente_id_key" ON "backend_datos_agente"("agente_id");

-- AddForeignKey
ALTER TABLE "backend_datos_agente" ADD CONSTRAINT "backend_datos_agente_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (T1.2): una fila por agente existente con modo 'none_yet' (AC1:
-- v1 solo cablea managed_db | none_yet). Si el agente ya tenia
-- config_ecommerce.orderStatusUrl se infiere la capacidad "pedidos" — la
-- resolucion sigue leyendo config_ecommerce (path legado, sin cambios).
-- Idempotente via ON CONFLICT sobre el unique de agente_id.
INSERT INTO "backend_datos_agente" ("id", "agente_id", "modo", "capacidades", "actualizado_en")
SELECT
    gen_random_uuid()::text,
    a."id",
    'none_yet',
    CASE
        WHEN COALESCE(a."config_ecommerce"->>'orderStatusUrl', '') <> ''
            THEN '["pedidos"]'::jsonb
        ELSE '[]'::jsonb
    END,
    CURRENT_TIMESTAMP
FROM "agente" a
ON CONFLICT ("agente_id") DO NOTHING;
