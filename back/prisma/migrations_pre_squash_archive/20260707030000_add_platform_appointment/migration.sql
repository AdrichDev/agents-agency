-- CreateTable
CREATE TABLE "aa"."cita_agenda_plataforma" (
    "id" TEXT NOT NULL,
    "inicio_en" TIMESTAMP(3) NOT NULL,
    "fin_en" TIMESTAMP(3) NOT NULL,
    "cliente" TEXT NOT NULL,
    "servicio" TEXT,
    "notas" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'Confirmada',
    "gcal_event_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cita_agenda_plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cita_agenda_plataforma_inicio_en_idx" ON "aa"."cita_agenda_plataforma"("inicio_en");
