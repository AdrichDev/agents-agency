-- La cita guarda su propio horario.
--
-- Hasta ahora la fecha de una reserva vivia SOLO en `franja_horaria`. Desde que cancelar borra
-- la franja (para liberar el instante y que el hueco vuelva a ser reservable), una cita
-- cancelada se quedaba sin fecha: el negocio no podia saber que se habia cancelado ni cuando.
-- La franja pasa a ser inventario puro; el horario de la reserva es dato de la reserva.

ALTER TABLE "cita"
    ADD COLUMN "inicio" TIMESTAMP(3),
    ADD COLUMN "fin" TIMESTAMP(3);

UPDATE "cita" c
SET "inicio" = f."inicio", "fin" = f."fin"
FROM "franja_horaria" f
WHERE f."id" = c."franja_id";

-- Red de seguridad: hoy no existe ninguna cita sin franja, pero la columna pasa a NOT NULL y
-- una sola fila nula abortaria la migracion. `creado_en` es un valor honesto: es lo unico que
-- se sabe con certeza de una reserva que perdio su franja.
UPDATE "cita" SET "inicio" = "creado_en", "fin" = "creado_en" WHERE "inicio" IS NULL;

ALTER TABLE "cita"
    ALTER COLUMN "inicio" SET NOT NULL,
    ALTER COLUMN "fin" SET NOT NULL;

CREATE INDEX "cita_inicio_idx" ON "cita"("inicio");
