-- H2 aa-credenciales-byok-multiproveedor (T1.1 / T1.2 / T1.3 / T1.4) / Nivel 4
-- Migracion ADITIVA: introduce el modo de credenciales LLM y el almacen de claves
-- propias del cliente (BYOK). Antes de esto la clave del LLM la elegia el
-- `process.env` del proceso (`lib/openai.ts:16-22`), asi que no habia ningun punto
-- del codigo en el que dependiera de quien esta hablando.
--
-- SIN BACKFILL, Y ES DELIBERADO.
--   Todos los tenants quedan en 'platform' por el DEFAULT de columna, que es
--   exactamente lo que hacen hoy: consumir la cuenta LLM del propietario. La tabla
--   de credenciales nace vacia. Ningun cliente cambia de comportamiento al aplicar
--   esto. Pasar un cliente a 'byok' es una accion manual, con su clave en la mano,
--   despues del despliegue.
--
-- Orden de despliegue (design.md SEC. I): esta migracion va DESPUES de
-- 20260727000000_agent_lifecycle_status (H3, pendiente de su propio gate humano) y
-- en el MISMO despliegue que el resolutor de cliente por tenant y el metering
-- ramificado. La migracion sola es inocua; el codigo sin la migracion no compila
-- contra la base.

-- platform | byok
-- (String + comentario, no enum nativo: mismo criterio que `motor`, `canal`,
--  `esfuerzo_razonamiento` y `agente.estado`. Se valida con Zod en el borde.)
--
-- platform → la plataforma pone la clave y asume el coste del LLM; el cupo
--            (`saldo_tokens` / `tokens_usados`) es el guardarrail de ESE coste.
-- byok      → el cliente trae su clave y paga su consumo al proveedor. El cupo deja
--            de aplicar porque no hay gasto del propietario que racionar. `activo`
--            SI sigue aplicando: es el impago de la suscripcion, y traer tu clave
--            no es dejar de ser cliente.
ALTER TABLE "tenant" ADD COLUMN "modo_credencial" TEXT NOT NULL DEFAULT 'platform';

-- Quien pago ESTOS tokens. Sin esta columna el propietario no puede separar en su
-- propia tabla de consumo lo que le costo dinero de lo que pago el cliente con su
-- clave: dos hechos distintos en un solo sitio, que es como sale una factura falsa
-- por exceso (mismo error que H4/T1 deshizo en `activo`).
ALTER TABLE "uso_tokens" ADD COLUMN "modo_credencial" TEXT NOT NULL DEFAULT 'platform';

-- Almacen de claves LLM del cliente. Calcado de `integracion` (tokens OAuth de
-- Google/Slack/Notion/Jira): mismo cifrado enc:v1: (AES-256-GCM con
-- CHANNEL_ENCRYPTION_KEY), mismo unique por (dueno, proveedor), mismo campo estado.
--
-- `api_key` es de SOLO ESCRITURA: no sale nunca hacia una respuesta HTTP ni hacia un
-- log. `pista_clave` guarda los ultimos 4 caracteres para que un humano reconozca la
-- clave sin poder usarla; se guarda en el INSERT porque el claro solo existe en ese
-- instante.
--
-- `estado`: connected (verificada, la UNICA con la que se sirve) | invalid (el
-- proveedor la rechazo → pedir otra clave al cliente) | undecryptable (no se puede
-- descifrar lo guardado → revisar CHANNEL_ENCRYPTION_KEY en el despliegue). Los dos
-- ultimos estan separados a proposito: fundirlos presentaria un error de
-- configuracion del propietario como culpa del cliente.
CREATE TABLE "credencial_llm_tenant" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proveedor" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "pista_clave" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'connected',
    "verificado_en" TIMESTAMP(3),
    "ultimo_error" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credencial_llm_tenant_pkey" PRIMARY KEY ("id")
);

-- Una clave por proveedor y tenant. Varias del mismo proveedor es una funcion de
-- rotacion que nadie ha pedido y que duplica los estados posibles.
CREATE UNIQUE INDEX "credencial_llm_tenant_tenant_id_proveedor_key" ON "credencial_llm_tenant"("tenant_id", "proveedor");

ALTER TABLE "credencial_llm_tenant" ADD CONSTRAINT "credencial_llm_tenant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
