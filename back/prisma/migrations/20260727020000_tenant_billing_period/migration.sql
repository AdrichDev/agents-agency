-- H4 (aa-planes-y-cuotas, T3.1) — Periodo de facturación en `tenant`.
--
-- Migración ADITIVA. No hay DROP, ni ALTER de columna existente, ni borrado de datos.
-- `tokens_usados` NO se toca ni se recalcula: es el acumulado histórico de consumo y
-- recalcularlo sería destruir historia.
--
-- El único UPDATE de este fichero escribe SOBRE UNA COLUMNA CREADA EN ESTE MISMO FICHERO
-- (`periodo_dia_ancla`), porque un DEFAULT de Postgres no puede referirse a otra columna y el
-- día de ancla tiene que ser coherente con el inicio de periodo que se acaba de fijar.
--
-- Efecto al aplicar, dicho claro: a partir del despliegue del código el cupo se mide contra
-- `tokens_usados_periodo`, que arranca en 0 para todos. Es decir, todo tenant existente empieza
-- con el cupo entero disponible aunque su `tokens_usados` histórico fuera alto. Es intencionado
-- —el cupo pasa a ser cuota de periodo, no saldo de prepago— y hoy es inocuo: no hay ningún
-- cliente de pago en producción.
--
-- Aplicar esta migración ANTES de desplegar el código es seguro: Prisma selecciona columnas
-- explícitas, así que el código en vigor ignora las tres nuevas y sigue cortando por
-- `tokens_usados` como hasta ahora.

ALTER TABLE "tenant" ADD COLUMN "periodo_inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "tenant" ADD COLUMN "periodo_dia_ancla" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tenant" ADD COLUMN "tokens_usados_periodo" INTEGER NOT NULL DEFAULT 0;

-- Ancla coherente con el inicio de periodo recién fijado (día de mes de `periodo_inicio`).
UPDATE "tenant" SET "periodo_dia_ancla" = EXTRACT(DAY FROM "periodo_inicio")::int;
