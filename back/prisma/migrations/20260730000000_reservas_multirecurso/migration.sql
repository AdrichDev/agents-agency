-- Reservas multi-recurso.
--
-- Convierte "una reserva por servicio e instante" en "una reserva por recurso e instante",
-- que es lo que permite representar un restaurante con doce mesas, una barberia con tres
-- barberos o un centro de estetica con cuatro cabinas.
--
-- Orden deliberado: las columnas nuevas entran nullable, se rellenan, y solo despues se
-- endurecen. El unico paso irreversible es el DROP del unique antiguo, al final.

-- ── 1. Inventario reservable ────────────────────────────────────────────────

CREATE TABLE "recurso" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'room',
    "capacidad_min" INTEGER NOT NULL DEFAULT 1,
    "capacidad_max" INTEGER NOT NULL DEFAULT 1,
    "zona" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurso_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "servicio_recurso" (
    "servicio_id" TEXT NOT NULL,
    "recurso_id" TEXT NOT NULL,

    CONSTRAINT "servicio_recurso_pkey" PRIMARY KEY ("servicio_id","recurso_id")
);

CREATE UNIQUE INDEX "recurso_agente_id_nombre_key" ON "recurso"("agente_id", "nombre");
CREATE INDEX "recurso_agente_id_activo_idx" ON "recurso"("agente_id", "activo");
CREATE INDEX "servicio_recurso_recurso_id_idx" ON "servicio_recurso"("recurso_id");

ALTER TABLE "recurso" ADD CONSTRAINT "recurso_agente_id_fkey"
    FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "servicio_recurso" ADD CONSTRAINT "servicio_recurso_servicio_id_fkey"
    FOREIGN KEY ("servicio_id") REFERENCES "servicio_agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "servicio_recurso" ADD CONSTRAINT "servicio_recurso_recurso_id_fkey"
    FOREIGN KEY ("recurso_id") REFERENCES "recurso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. Parametros de turno del servicio ─────────────────────────────────────
-- Los defaults reproducen el comportamiento anterior: paso de 30 min (el literal que estaba
-- escrito a fuego en generateSlots), sin buffer, grupo maximo 1, sin horario propio.

ALTER TABLE "servicio_agente"
    ADD COLUMN "paso_minutos" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN "buffer_minutos" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "max_comensales" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "horario" JSONB;

-- ── 3. Datos de la reserva ──────────────────────────────────────────────────

ALTER TABLE "cita"
    ADD COLUMN "comensales" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "nombre_cliente" TEXT,
    ADD COLUMN "codigo_confirmacion" TEXT;

-- franja_id pasa a nullable: cancelar BORRA la franja para liberar el instante, y la cita
-- sobrevive como registro cancelado sin retener inventario.
ALTER TABLE "cita" ALTER COLUMN "franja_id" DROP NOT NULL;

-- ── 4. Backfill ─────────────────────────────────────────────────────────────

ALTER TABLE "franja_horaria" ADD COLUMN "recurso_id" TEXT;

-- Un recurso implicito POR SERVICIO, no por agente. Con uno por agente, dos servicios del
-- mismo agente con franjas al mismo instante colisionarian contra el nuevo unique: antes
-- eran reservables por separado (el unique era por servicio) y la migracion les quitaria
-- capacidad. Uno por servicio hace la equivalencia exacta.
INSERT INTO "recurso" ("id", "agente_id", "nombre", "tipo", "capacidad_min", "capacidad_max", "activo", "creado_en")
SELECT gen_random_uuid()::text, s."agente_id", s."nombre", 'room', 1, 1, true, CURRENT_TIMESTAMP
FROM "servicio_agente" s;

INSERT INTO "servicio_recurso" ("servicio_id", "recurso_id")
SELECT s."id", r."id"
FROM "servicio_agente" s
JOIN "recurso" r ON r."agente_id" = s."agente_id" AND r."nombre" = s."nombre";

UPDATE "franja_horaria" f
SET "recurso_id" = sr."recurso_id"
FROM "servicio_recurso" sr
WHERE sr."servicio_id" = f."servicio_id";

-- Codigo para las reservas preexistentes: sin el no serian cancelables desde el bot.
-- Derivado del id, asi que es estable y no colisiona.
UPDATE "cita"
SET "codigo_confirmacion" = 'LEG-' || upper(substr(md5("id"), 1, 6))
WHERE "codigo_confirmacion" IS NULL;

ALTER TABLE "franja_horaria" ALTER COLUMN "recurso_id" SET NOT NULL;

-- ── 5. Claves e indices ─────────────────────────────────────────────────────

ALTER TABLE "franja_horaria" ADD CONSTRAINT "franja_horaria_recurso_id_fkey"
    FOREIGN KEY ("recurso_id") REFERENCES "recurso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cita" DROP CONSTRAINT "cita_franja_id_fkey";
ALTER TABLE "cita" ADD CONSTRAINT "cita_franja_id_fkey"
    FOREIGN KEY ("franja_id") REFERENCES "franja_horaria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "cita_codigo_confirmacion_key" ON "cita"("codigo_confirmacion");
CREATE INDEX "cita_servicio_id_estado_idx" ON "cita"("servicio_id", "estado");
CREATE INDEX "franja_horaria_recurso_id_inicio_fin_idx" ON "franja_horaria"("recurso_id", "inicio", "fin");

-- Paso irreversible: el unique deja de ser por servicio y pasa a ser por recurso.
DROP INDEX "franja_horaria_servicio_id_inicio_key";
CREATE UNIQUE INDEX "franja_horaria_recurso_id_inicio_key" ON "franja_horaria"("recurso_id", "inicio");
