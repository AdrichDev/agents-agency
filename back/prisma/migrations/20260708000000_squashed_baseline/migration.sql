-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "aa";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "plpgsql";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('lead', 'prospecto');

-- CreateEnum
CREATE TYPE "ContactedStatus" AS ENUM ('si', 'no', 'nc');

-- CreateEnum
CREATE TYPE "SkillType" AS ENUM ('SKILL', 'AGENT', 'EXTENSION', 'PLUGIN', 'MCP');

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT,
    "rol" TEXT NOT NULL DEFAULT 'admin',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_lead" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "mensaje" TEXT,
    "consentimiento" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landing_lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant" (
    "id" TEXT NOT NULL,
    "cod_tenant" TEXT,
    "codigo" TEXT,
    "nombre" TEXT NOT NULL,
    "razon_social" TEXT,
    "nif" TEXT,
    "direccion" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "contacto" TEXT,
    "sitio_web" TEXT,
    "sector" TEXT,
    "saldo_tokens" INTEGER NOT NULL DEFAULT 0,
    "tokens_usados" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uso_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agente_id" TEXT,
    "conversacion_id" TEXT,
    "tokens" INTEGER NOT NULL,
    "modelo" TEXT,
    "operacion" TEXT,
    "contexto" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uso_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacto_prospecto" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "ContactType" NOT NULL DEFAULT 'prospecto',
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "email" TEXT,
    "sector" TEXT,
    "direccion" TEXT,
    "peticion" TEXT,
    "contactado" "ContactedStatus" NOT NULL DEFAULT 'no',
    "contactado_en" TIMESTAMP(3),
    "tenant_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "contacto_prospecto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agente" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "prompt_sistema" TEXT NOT NULL,
    "modelo" TEXT NOT NULL DEFAULT 'gpt-4.1-nano',
    "motor" TEXT NOT NULL DEFAULT 'openai',
    "esfuerzo_razonamiento" TEXT NOT NULL DEFAULT 'low',
    "temperatura" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "canal" TEXT NOT NULL DEFAULT 'widget',
    "widget_color_primario" TEXT NOT NULL DEFAULT '#4f46e5',
    "widget_color_secundario" TEXT NOT NULL DEFAULT '#9333ea',
    "widget_avatar_base64" TEXT,
    "widget_avatar_url" TEXT,
    "widget_avatar_emoji" TEXT NOT NULL DEFAULT '🤖',
    "widget_config_plantilla" JSONB NOT NULL DEFAULT '{}',
    "config_ecommerce" JSONB NOT NULL DEFAULT '{}',
    "clave_publica" TEXT NOT NULL,
    "tenant_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fragmento_conocimiento" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "fuente" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "embedding" vector(1536),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fragmento_conocimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "tipo" "SkillType" NOT NULL DEFAULT 'SKILL',
    "uso" TEXT NOT NULL DEFAULT 'GENERAL',
    "repo_url" TEXT,
    "estrellas" INTEGER NOT NULL DEFAULT 0,
    "herramientas" JSONB NOT NULL DEFAULT '[]',
    "fuente" TEXT NOT NULL DEFAULT 'github',
    "favorito" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agente_skill" (
    "agente_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,

    CONSTRAINT "agente_skill_pkey" PRIMARY KEY ("agente_id","skill_id")
);

-- CreateTable
CREATE TABLE "integracion" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "proveedor" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expira_en" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'connected',
    "metadatos" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integracion_plataforma" (
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

-- CreateTable
CREATE TABLE "cita_agenda_plataforma" (
    "id" TEXT NOT NULL,
    "inicio_en" TIMESTAMP(3) NOT NULL,
    "fin_en" TIMESTAMP(3) NOT NULL,
    "cliente" TEXT NOT NULL,
    "servicio" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "notas" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'Confirmada',
    "gcal_event_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cita_agenda_plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automatizacion" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "disparador" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "ultima_ejecucion_en" TIMESTAMP(3),
    "n8n_workflow_id" TEXT,
    "estado_sync" TEXT NOT NULL DEFAULT 'pending',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automatizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ejecucion_automatizacion" (
    "id" TEXT NOT NULL,
    "automatizacion_id" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "resumen" TEXT,
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ejecucion_automatizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversacion" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "canal" TEXT NOT NULL DEFAULT 'widget',
    "metadatos" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensaje" (
    "id" TEXT NOT NULL,
    "conversacion_id" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "conversacion_id" TEXT,
    "nombre_cliente" TEXT NOT NULL,
    "email" TEXT,
    "telefono" TEXT,
    "consentimiento" BOOLEAN NOT NULL DEFAULT false,
    "estado" TEXT NOT NULL DEFAULT 'new',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_audit" (
    "id" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "origen" TEXT NOT NULL,
    "resultado" TEXT NOT NULL,
    "detalle" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_sistema" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "tema" TEXT NOT NULL DEFAULT 'dark',
    "color_primario" TEXT NOT NULL DEFAULT '#6366f1',
    "color_secundario" TEXT NOT NULL DEFAULT '#d946ef',
    "fuente" TEXT NOT NULL DEFAULT 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    "favicon" TEXT,
    "sidebar_logo" TEXT,
    "sidebar_bg" TEXT DEFAULT '#05050A',
    "page_bg" TEXT DEFAULT '#030308',
    "sidebar_bg_claro" TEXT DEFAULT '#ffffff',
    "page_bg_claro" TEXT DEFAULT '#f8fafc',
    "email_admin" TEXT,
    "modelo_agente_default" TEXT NOT NULL DEFAULT 'gpt-4.1-nano',
    "esfuerzo_razonamiento" TEXT NOT NULL DEFAULT 'low',
    "google_client_id" TEXT,
    "google_client_secret" TEXT,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_sistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presupuesto" (
    "id" TEXT NOT NULL,
    "numero_presupuesto" TEXT NOT NULL,
    "tenant_id" TEXT,
    "snapshot_cliente" JSONB NOT NULL DEFAULT '{}',
    "snapshot_emisor" JSONB NOT NULL DEFAULT '{}',
    "estado" TEXT NOT NULL DEFAULT 'draft',
    "subtotal_impl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal_mant" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tasa_iva" DOUBLE PRECISION NOT NULL DEFAULT 0.21,
    "total_impl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_mant" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dias_validez" INTEGER NOT NULL DEFAULT 30,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presupuesto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linea_presupuesto" (
    "id" TEXT NOT NULL,
    "presupuesto_id" TEXT NOT NULL,
    "servicio_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "precio_impl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "precio_mant" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posicion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "linea_presupuesto_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "landing_project" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "negocio" TEXT,
    "respuestas" JSONB NOT NULL DEFAULT '{}',
    "chat_mensajes" JSONB NOT NULL DEFAULT '[]',
    "prompt_generacion" TEXT,
    "db_provider" TEXT NOT NULL DEFAULT 'none',
    "archivos" JSONB NOT NULL DEFAULT '{}',
    "archivos_movil" JSONB NOT NULL DEFAULT '{}',
    "stack_movil" TEXT,
    "qr_url" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'draft',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estudio_mercado" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "entradas" JSONB NOT NULL DEFAULT '{}',
    "secciones" JSONB NOT NULL DEFAULT '[]',
    "prospectos" JSONB NOT NULL DEFAULT '[]',
    "estado" TEXT NOT NULL DEFAULT 'draft',
    "puntuacion_exito" INTEGER,
    "modelo" TEXT NOT NULL DEFAULT 'gpt-4.1-nano',
    "esfuerzo_razonamiento" TEXT NOT NULL DEFAULT 'low',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estudio_mercado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conexion_canal" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "proveedor" TEXT NOT NULL,
    "credenciales" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pending',
    "detalle_estado" TEXT,
    "webhook_secret" TEXT,
    "bot_username" TEXT,
    "bot_nombre" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conexion_canal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicio_agente" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "duracion" INTEGER NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servicio_agente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franja_horaria" (
    "id" TEXT NOT NULL,
    "servicio_id" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "sincronizado_gcal" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franja_horaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horario_agente" (
    "id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "zona_horaria" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "horario" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "horario_agente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rango_bloqueo" (
    "id" TEXT NOT NULL,
    "horario_id" TEXT NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rango_bloqueo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cita" (
    "id" TEXT NOT NULL,
    "franja_id" TEXT NOT NULL,
    "servicio_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "notas" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'scheduled',
    "gcal_event_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE INDEX "landing_lead_creado_en_idx" ON "landing_lead"("creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_codigo_key" ON "tenant"("codigo");

-- CreateIndex
CREATE INDEX "uso_tokens_tenant_id_creado_en_idx" ON "uso_tokens"("tenant_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "contacto_prospecto_codigo_key" ON "contacto_prospecto"("codigo");

-- CreateIndex
CREATE INDEX "contacto_prospecto_tipo_contactado_idx" ON "contacto_prospecto"("tipo", "contactado");

-- CreateIndex
CREATE INDEX "contacto_prospecto_creado_en_idx" ON "contacto_prospecto"("creado_en");

-- CreateIndex
CREATE INDEX "contacto_prospecto_eliminado_en_idx" ON "contacto_prospecto"("eliminado_en");

-- CreateIndex
CREATE UNIQUE INDEX "agente_clave_publica_key" ON "agente"("clave_publica");

-- CreateIndex
CREATE INDEX "fragmento_conocimiento_agente_id_idx" ON "fragmento_conocimiento"("agente_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_nombre_key" ON "skill"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "integracion_agente_id_proveedor_key" ON "integracion"("agente_id", "proveedor");

-- CreateIndex
CREATE UNIQUE INDEX "integracion_plataforma_proveedor_key" ON "integracion_plataforma"("proveedor");

-- CreateIndex
CREATE INDEX "cita_agenda_plataforma_inicio_en_idx" ON "cita_agenda_plataforma"("inicio_en");

-- CreateIndex
CREATE INDEX "ejecucion_automatizacion_automatizacion_id_creado_en_idx" ON "ejecucion_automatizacion"("automatizacion_id", "creado_en");

-- CreateIndex
CREATE INDEX "mensaje_conversacion_id_creado_en_idx" ON "mensaje"("conversacion_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "lead_conversacion_id_key" ON "lead"("conversacion_id");

-- CreateIndex
CREATE INDEX "lead_agente_id_creado_en_idx" ON "lead"("agente_id", "creado_en");

-- CreateIndex
CREATE INDEX "operator_audit_creado_en_idx" ON "operator_audit"("creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "presupuesto_numero_presupuesto_key" ON "presupuesto"("numero_presupuesto");

-- CreateIndex
CREATE INDEX "presupuesto_tenant_id_creado_en_idx" ON "presupuesto"("tenant_id", "creado_en");

-- CreateIndex
CREATE INDEX "linea_presupuesto_presupuesto_id_idx" ON "linea_presupuesto"("presupuesto_id");

-- CreateIndex
CREATE UNIQUE INDEX "factura_numero_factura_key" ON "factura"("numero_factura");

-- CreateIndex
CREATE UNIQUE INDEX "factura_presupuesto_id_key" ON "factura"("presupuesto_id");

-- CreateIndex
CREATE INDEX "factura_estado_idx" ON "factura"("estado");

-- CreateIndex
CREATE INDEX "landing_project_actualizado_en_idx" ON "landing_project"("actualizado_en");

-- CreateIndex
CREATE INDEX "estudio_mercado_creado_en_idx" ON "estudio_mercado"("creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "conexion_canal_agente_id_proveedor_key" ON "conexion_canal"("agente_id", "proveedor");

-- CreateIndex
CREATE INDEX "servicio_agente_agente_id_idx" ON "servicio_agente"("agente_id");

-- CreateIndex
CREATE UNIQUE INDEX "servicio_agente_agente_id_nombre_key" ON "servicio_agente"("agente_id", "nombre");

-- CreateIndex
CREATE INDEX "franja_horaria_servicio_id_disponible_idx" ON "franja_horaria"("servicio_id", "disponible");

-- CreateIndex
CREATE INDEX "franja_horaria_inicio_idx" ON "franja_horaria"("inicio");

-- CreateIndex
CREATE UNIQUE INDEX "franja_horaria_servicio_id_inicio_key" ON "franja_horaria"("servicio_id", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "horario_agente_agente_id_key" ON "horario_agente"("agente_id");

-- CreateIndex
CREATE INDEX "rango_bloqueo_horario_id_fecha_inicio_idx" ON "rango_bloqueo"("horario_id", "fecha_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "cita_franja_id_key" ON "cita"("franja_id");

-- CreateIndex
CREATE INDEX "cita_franja_id_idx" ON "cita"("franja_id");

-- CreateIndex
CREATE INDEX "cita_lead_id_idx" ON "cita"("lead_id");

-- CreateIndex
CREATE INDEX "cita_creado_en_idx" ON "cita"("creado_en");

-- AddForeignKey
ALTER TABLE "uso_tokens" ADD CONSTRAINT "uso_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contacto_prospecto" ADD CONSTRAINT "contacto_prospecto_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "agente" ADD CONSTRAINT "agente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fragmento_conocimiento" ADD CONSTRAINT "fragmento_conocimiento_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agente_skill" ADD CONSTRAINT "agente_skill_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agente_skill" ADD CONSTRAINT "agente_skill_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integracion" ADD CONSTRAINT "integracion_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automatizacion" ADD CONSTRAINT "automatizacion_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ejecucion_automatizacion" ADD CONSTRAINT "ejecucion_automatizacion_automatizacion_id_fkey" FOREIGN KEY ("automatizacion_id") REFERENCES "automatizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversacion" ADD CONSTRAINT "conversacion_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto" ADD CONSTRAINT "presupuesto_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "linea_presupuesto" ADD CONSTRAINT "linea_presupuesto_presupuesto_id_fkey" FOREIGN KEY ("presupuesto_id") REFERENCES "presupuesto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura" ADD CONSTRAINT "factura_presupuesto_id_fkey" FOREIGN KEY ("presupuesto_id") REFERENCES "presupuesto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexion_canal" ADD CONSTRAINT "conexion_canal_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicio_agente" ADD CONSTRAINT "servicio_agente_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franja_horaria" ADD CONSTRAINT "franja_horaria_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicio_agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horario_agente" ADD CONSTRAINT "horario_agente_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rango_bloqueo" ADD CONSTRAINT "rango_bloqueo_horario_id_fkey" FOREIGN KEY ("horario_id") REFERENCES "horario_agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cita" ADD CONSTRAINT "cita_franja_id_fkey" FOREIGN KEY ("franja_id") REFERENCES "franja_horaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cita" ADD CONSTRAINT "cita_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicio_agente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cita" ADD CONSTRAINT "cita_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

