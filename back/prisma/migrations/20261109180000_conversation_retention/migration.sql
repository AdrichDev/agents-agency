-- S3 (conversation-persistence, T2) — Retención de conversaciones: última actividad + índices.
--
-- ADITIVA. `actualizado_en` entra NOT NULL con DEFAULT CURRENT_TIMESTAMP, así que el código que ya
-- escribe conversaciones sigue funcionando sin cambios. Sin esta columna la purga no tenía con qué
-- medir inactividad: `creado_en` sólo dice cuándo empezó la conversación, y una conversación viva
-- durante meses habría parecido inactiva desde el primer día.
--
-- NO se crea ni se toca ninguna tabla de canales: la purga es la única consumidora y su filtro es
-- `canal = 'widget' OR canal IS NULL` (ver src/lib/conversation-retention.ts). Un hilo de
-- Telegram/WhatsApp es de por vida del contacto y no se purga nunca.

ALTER TABLE "conversacion" ADD COLUMN "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: la última actividad de una conversación existente es su último mensaje y, si no tiene
-- ninguno, su creación. Es obligatorio, no cosmético: con el DEFAULT todas las filas históricas
-- nacerían con la hora de la migración, la primera pasada de la purga las vería como "activas hoy"
-- y la retención no borraría nada durante 30 días (y con un DEFAULT en el pasado, al revés, se
-- llevaría por delante conversaciones vivas en el primer barrido).
UPDATE "conversacion" c
SET "actualizado_en" = COALESCE(
    (SELECT MAX(m."creado_en") FROM "mensaje" m WHERE m."conversacion_id" = c."id"),
    c."creado_en"
);

-- Índice de la lectura de candidatas: `WHERE actualizado_en < cutoff AND (canal = 'widget' OR
-- canal IS NULL)`. Es la consulta que corre el cron de retención, y sin él sería un seq scan de la
-- tabla que más crece del sistema.
CREATE INDEX IF NOT EXISTS "conversacion_actualizado_en_idx" ON "conversacion"("actualizado_en");

-- Índice de "widget/test por agente": listados y analítica filtran por (agente_id, es_prueba), y
-- sin él cada consulta de la consola recorre las conversaciones del agente entero. No lo usa la
-- purga (esa acota por fecha y canal): son dos índices distintos para dos preguntas distintas.
CREATE INDEX IF NOT EXISTS "conversacion_agente_id_es_prueba_idx" ON "conversacion"("agente_id", "es_prueba");
