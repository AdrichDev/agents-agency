-- db/07-aa-uso-tokens-metering.sql — metering de tokens desde creador_CRM.
--
-- Migración ADITIVA (sin DROP de tabla/columna, sin pérdida de datos):
--   1) Añade `operacion` (tipo de consumo, p.ej. 'crm_generate') y `contexto`
--      (jsonb libre: { projectId, modulesCount, ... }).
--   2) Relaja agente_id/conversacion_id/modelo a NULL — el consumo de creador_CRM
--      no tiene agente, conversación ni modelo LLM asociados (hoy son NOT NULL,
--      heredados del único caso previo: consumo por conversación del widget).
--
-- Convención AA: el schema real vive por `prisma migrate deploy` + SQL numerado en db/
-- (las migraciones prisma/ están drifteadas tras el rename es, ver db/05). Esta
-- se aplica manualmente contra Supabase, igual que db/04-06. Idempotente y
-- transaccional. No toca permisos: service_role ya tiene GRANT ALL en schema aa
-- (db/01-supabase-setup.sql), por lo que creador_CRM puede insertar filas aquí.
BEGIN;
SET search_path TO aa;

ALTER TABLE uso_tokens ADD COLUMN IF NOT EXISTS operacion text;
ALTER TABLE uso_tokens ADD COLUMN IF NOT EXISTS contexto  jsonb;

ALTER TABLE uso_tokens ALTER COLUMN agente_id       DROP NOT NULL;
ALTER TABLE uso_tokens ALTER COLUMN conversacion_id DROP NOT NULL;
ALTER TABLE uso_tokens ALTER COLUMN modelo          DROP NOT NULL;

COMMIT;
