-- H3 aa-agente-ciclo-vida-publicacion (T1.1 / T1.2) / Nivel 4
-- Migracion ADITIVA: separa "existir" de "estar publicado". Antes de esto,
-- `agente.clave_publica` se generaba en el alta, asi que crear = publicar =
-- facturable, en el mismo instante y sin que nadie lo decidiera.
--
-- SIN BACKFILL, Y ES DELIBERADO. No es un olvido.
--   El gate humano T0.2 (27/07/2026) aporto el dato que decide esto: NINGUNO de
--   los 14 agentes existentes es de un cliente, todos son pruebas del
--   propietario. Por tanto el DEFAULT de columna ('draft') es el backfill
--   completo y correcto: nada esta vendido, nada debe quedar publicado ni
--   facturable.
--   La version descartada publicaba a los agentes con tenant y >=1 conversacion
--   con `es_prueba = false`. Ese criterio era FALSO, no solo innecesario:
--   `es_prueba = false` significa "se probo desde fuera de la consola de
--   operador", que es exactamente lo que hace el propio dueno al abrir la URL
--   publica del widget. Habria marcado 6 agentes como facturables, con historia
--   de publicacion fechada en junio, sin que nadie los comprara.
--
-- Efecto al aplicar: los agentes existentes dejan de responder por su clave
-- publica hasta que se pulse Publicar. La consola de operador sigue funcionando
-- (exencion `es_prueba` con sesion). Por eso esta migracion se despliega junto
-- con el gate de trafico (T2) y los endpoints de publicacion (T3): migrar sola
-- dejaria agentes mudos y sin boton para revivirlos.

-- draft | published | suspended | archived
-- (String + comentario, no enum nativo: el repo ya lo hace asi para `motor`,
--  `canal` y `esfuerzo_razonamiento`, y un enum obliga a migrar el tipo en
--  Postgres por cada estado nuevo. Se valida con Zod en el borde.)
ALTER TABLE "agente" ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'draft';

-- PRIMERA publicacion. No se pisa al republicar: es la fecha desde la que se
-- factura, y republicar no reescribe la historia.
ALTER TABLE "agente" ADD COLUMN "publicado_en" TIMESTAMP(3);

-- Ultima transicion, cualquiera que sea.
ALTER TABLE "agente" ADD COLUMN "estado_cambiado_en" TIMESTAMP(3);

-- Rastro de transiciones. Sin esto no se puede responder "estuvo publicado en
-- junio?", que es LA pregunta de la factura: el cobro es por agente activo y
-- `agente.estado` solo dice el ahora.
CREATE TABLE "evento_estado_agente" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "desde" TEXT,
    "hasta" TEXT NOT NULL,
    "actor" TEXT,
    "motivo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_estado_agente_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "evento_estado_agente_agente_id_creado_en_idx" ON "evento_estado_agente"("agente_id", "creado_en");

ALTER TABLE "evento_estado_agente" ADD CONSTRAINT "evento_estado_agente_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
