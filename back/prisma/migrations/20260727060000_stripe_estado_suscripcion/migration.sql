-- H6 (aa-stripe-suscripciones, T1.3) — Estado de suscripción separado del kill switch, y las dos
-- tablas de soporte de Stripe.
--
-- ADITIVA y sin backfill. Ni una fila existente cambia de comportamiento, y eso es el requisito, no
-- una casualidad: hay 15 tenants en producción sirviendo tráfico y ninguno tiene suscripción.
--
-- POR QUÉ `estado_suscripcion` ES UNA COLUMNA NUEVA Y NO SE REUSA `activo` (design §D3)
--
-- `activo` (isActive) ya arrastra dos hechos: "impago" y "suspensión manual del propietario". Hoy no
-- molesta porque NADA automático la escribe. En cuanto un webhook la escriba, rompe en los dos
-- sentidos:
--
--   * El propietario suspende un cliente a mano (`activo = false`). Llega `invoice.paid`. El webhook
--     pone `true`. La suspensión se deshace sola y sin dejar rastro de quién la deshizo.
--   * El propietario reactiva a mano a un moroso. O el siguiente `payment_failed` lo vuelve a cortar
--     —contradiciendo una decisión humana explícita—, o no llega ninguno y queda servido sin pagar.
--
-- Es el mismo error que H4/T1 deshizo al separar "cupo agotado" de "cuenta desactivada". Con las dos
-- columnas el reparto es estricto: `activo` sólo lo escribe una persona, `estado_suscripcion` sólo lo
-- escribe Stripe, y el gate corta con un OR de las dos.
--
-- NULLABLE Y SIN DEFAULT, deliberado. `NULL` = "sin suscripción", y NO corta el servicio. Es el único
-- fail-open de todo el eje y está acotado a esta columna: los 15 tenants de producción no tienen
-- suscripción, así que un default tipo `'unpaid'` —o cualquier lectura de NULL como impago— los
-- dejaría mudos a todos a la vez el día del despliegue. El fail-closed de H1 no se afloja: `activo` y
-- el cupo siguen cortando exactamente igual que antes de esta migración.
--
-- Los UNIQUE de los ids de Stripe conviven con los 15 NULL sin conflicto: en PostgreSQL un índice
-- único admite múltiples NULL. Y son necesarios porque un webhook llega identificado SÓLO por el
-- customer o la subscription — dos tenants con el mismo customer harían que un cobro moviera el
-- estado del cliente equivocado, que es el peor fallo posible en una tabla de cobro.

ALTER TABLE "tenant" ADD COLUMN "estado_suscripcion" TEXT;
ALTER TABLE "tenant" ADD COLUMN "stripe_cliente_id" TEXT;
ALTER TABLE "tenant" ADD COLUMN "stripe_suscripcion_id" TEXT;

CREATE UNIQUE INDEX "tenant_stripe_cliente_id_key" ON "tenant"("stripe_cliente_id");
CREATE UNIQUE INDEX "tenant_stripe_suscripcion_id_key" ON "tenant"("stripe_suscripcion_id");

-- Registro de eventos de webhook ya vistos (design §D5).
--
-- `id` es el `event.id` de Stripe y NO tiene default: la clave la pone el emisor. Su PRIMARY KEY es
-- la única primitiva de exclusión que hay para la idempotencia, y de ahí el orden obligatorio del
-- manejador — INSERT antes de procesar. Al revés, dos entregas concurrentes pasarían las dos el
-- "¿ya existe?" antes de que ninguna hubiese insertado.
--
-- `procesado_en` nullable distingue "visto pero sin terminar" de "ya hecho": un fallo transitorio
-- deja NULL y su reentrega se vuelve a procesar. Sin esa distinción, el primer error dejaría el
-- evento registrado y perdido para siempre.
CREATE TABLE "stripe_evento" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "recibido_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesado_en" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "stripe_evento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stripe_evento_tipo_recibido_en_idx" ON "stripe_evento"("tipo", "recibido_en");

-- Mapa servicio del catálogo → Product/Price de Stripe (design §D2).
--
-- Clave compuesta `(servicio_id, modo)` y no `servicio_id` solo: los ids de Stripe son DISTINTOS en
-- test y en live. Con `modo` en la clave los dos entornos conviven en la misma base sin que un
-- despliegue de pruebas pise los ids de producción.
--
-- `importe_centimos` es un espejo del catálogo para que el tripwire de deriva no tenga que llamar a
-- la API por cada servicio. La fuente del importe sigue siendo `front/lib/service-catalog.json`.
CREATE TABLE "stripe_precio_mapa" (
    "servicio_id" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "precio_id" TEXT NOT NULL,
    "importe_centimos" INTEGER NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'eur',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_precio_mapa_pkey" PRIMARY KEY ("servicio_id", "modo")
);

CREATE UNIQUE INDEX "stripe_precio_mapa_precio_id_key" ON "stripe_precio_mapa"("precio_id");
