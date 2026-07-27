-- H4 (aa-planes-y-cuotas, T4) — Modelo `plan` y cupo gobernado por plan.
--
-- ADITIVA salvo dos relajaciones de restricción sobre `tenant.saldo_tokens`, que NO destruyen
-- datos: los valores existentes se conservan intactos. Al pasar la columna a NULLABLE, todos los
-- tenants actuales quedan con override explícito, así que el comportamiento del gate no cambia
-- para nadie ya dado de alta. Sólo los tenants CREADOS a partir de aquí llegan con NULL y quedan
-- gobernados por su plan (y sin plan, con cupo cero: fail-closed).
--
-- La tabla `plan` NO tiene ninguna columna monetaria a propósito. Ver el comentario del modelo en
-- schema.prisma y openspec/changes/aa-planes-y-cuotas/design.md §C.4. El importe vive en Stripe.
--
-- `ON DELETE SET NULL` en la FK y no CASCADE: borrar un plan no puede borrar clientes. Deja al
-- tenant sin plan, que es un estado ya contemplado (cupo cero, fail-closed) y reversible
-- reasignando el plan.

CREATE TABLE "plan" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cupo_tokens_por_agente" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_codigo_key" ON "plan"("codigo");

ALTER TABLE "tenant" ADD COLUMN "plan_id" TEXT;

CREATE INDEX "tenant_plan_id_idx" ON "tenant"("plan_id");

ALTER TABLE "tenant" ADD CONSTRAINT "tenant_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- `saldo_tokens` pasa de "cupo obligatorio con default 0" a "override opcional".
-- El DEFAULT se retira para que un tenant creado sin decir nada quede gobernado por su plan en
-- lugar de nacer con un cupo de 0 heredado en silencio, que es indistinguible de un bloqueo
-- deliberado.
ALTER TABLE "tenant" ALTER COLUMN "saldo_tokens" DROP NOT NULL;
ALTER TABLE "tenant" ALTER COLUMN "saldo_tokens" DROP DEFAULT;
