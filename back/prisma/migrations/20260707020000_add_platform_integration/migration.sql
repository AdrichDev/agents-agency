-- CreateTable
CREATE TABLE "aa"."integracion_plataforma" (
    "id" TEXT NOT NULL,
    "proveedor" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expira_en" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'connected',
    "metadatos" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integracion_plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integracion_plataforma_proveedor_key" ON "aa"."integracion_plataforma"("proveedor");
