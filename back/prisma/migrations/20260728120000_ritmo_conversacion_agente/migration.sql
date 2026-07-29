-- aa-canales-buffer-y-respuesta-partida (T4.2) — Ritmo de conversación del agente en canales
-- de mensajería: buffer de entrada y respuesta partida.
--
-- ADITIVA y sin backfill. Los defaults reproducen EXACTAMENTE el comportamiento anterior al
-- change (AD2), y eso es el requisito, no una casualidad: hay agentes en producción sirviendo
-- tráfico por Telegram y WhatsApp y ninguno debe cambiar de conducta al aplicar esto.
--
--   buffer_entrada_ms      = 0  → sin buffer: se responde a cada mensaje, como hasta ahora.
--   respuesta_max_mensajes = 1  → sin partir: una respuesta, un mensaje, como hasta ahora.
--   respuesta_pausa_ms     = 0  → irrelevante mientras no se parta.
--
-- Con estos defaults el código nuevo queda en una rama muerta hasta que el dueño de un agente
-- lo enciende desde el panel. Eso hace el despliegue reversible sin deshacer la migración.
--
-- Los tres valores se recortan a los topes duros AL LEER (INBOUND_BUFFER_MAX_MS,
-- INBOUND_BUFFER_MAX_MESSAGES, REPLY_MAX_MESSAGES_CAP) y no aquí, para que bajar un tope en el
-- futuro afecte también a los agentes ya configurados (AD5). Por eso no hay CHECK constraint:
-- un valor fuera de rango en la columna es inocuo, no un dato corrupto.

ALTER TABLE "aa"."agente" ADD COLUMN "buffer_entrada_ms" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "aa"."agente" ADD COLUMN "respuesta_max_mensajes" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "aa"."agente" ADD COLUMN "respuesta_pausa_ms" INTEGER NOT NULL DEFAULT 0;
