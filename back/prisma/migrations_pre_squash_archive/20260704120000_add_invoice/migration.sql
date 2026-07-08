-- CreateTable
CREATE TABLE "factura" (
    "id" TEXT NOT NULL,
    "numero_factura" TEXT NOT NULL,
    "presupuesto_id" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "cobrado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "factura_numero_factura_key" ON "factura"("numero_factura");

-- CreateIndex
CREATE UNIQUE INDEX "factura_presupuesto_id_key" ON "factura"("presupuesto_id");

-- CreateIndex
CREATE INDEX "factura_estado_idx" ON "factura"("estado");

-- AddForeignKey
ALTER TABLE "factura" ADD CONSTRAINT "factura_presupuesto_id_fkey" FOREIGN KEY ("presupuesto_id") REFERENCES "presupuesto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
