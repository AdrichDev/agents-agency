-- H4 (aa-planes-y-cuotas, T5) — Cuota por agente.
--
-- Con el cobro por agente activo (T4), el cupo viaja con el agente: lo que se paga por unidad se
-- limita por unidad. Sin esto el cupo del tenant es un bote común y un agente puede consumirse el
-- que otro ya está pagando.
--
-- Dos cambios, ninguno destructivo:
--
--   1. `agente.cupo_tokens_override` — tope propio del agente. NULL (el valor con el que nacen
--      todas las filas existentes) significa "lo dicta el plan", así que el comportamiento no
--      cambia para ningún agente ya creado.
--
--   2. Índice `(agente_id, creado_en)` en `uso_tokens`. El consumo por agente NO se cachea en una
--      columna: se suma de `uso_tokens`, que es la fuente de verdad. La alternativa —un contador
--      por agente— añadiría una segunda caché que deriva (el contador del tenant ya necesitó un
--      script de reconciliación en T3) y habría que resetearla en cada renovación de periodo.
--      El precio de derivarlo es esta suma por mensaje, y sin el índice esa suma escanearía todo
--      el histórico del tenant.

ALTER TABLE "agente" ADD COLUMN "cupo_tokens_override" INTEGER;

CREATE INDEX "uso_tokens_agente_id_creado_en_idx" ON "uso_tokens"("agente_id", "creado_en");
