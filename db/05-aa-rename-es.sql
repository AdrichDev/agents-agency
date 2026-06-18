-- ============================================================================
-- db/05-aa-rename-es.sql
-- Fase B — Normalización schema aa a castellano (snake_case) + fusión Client→Tenant.
--
-- Datos reales → ALTER RENAME (NUNCA drop+create). Transaccional: cualquier error
-- hace ROLLBACK completo, estado intacto. Modelos Prisma siguen en INGLÉS; aquí solo
-- cambia el SQL físico (que @@map/@map en schema.prisma reflejará).
--
-- FUSIÓN: aa.Client se funde en aa.tenant. Survivor = la tabla Client (datos ricos),
-- renombrada a `tenant`, conservando Client.id como PK → Agent/Budget/ProspectContact/
-- TokenUsage.clientId NO se remapean (solo se renombra la columna a tenant_id). El shell
-- `tenant` previo (id=ten_xxx, solo cod_tenant+nombre) se absorbe (cod_tenant) y se elimina.
-- crm.negocio está VACÍA → el cross-schema FK se recrea trivialmente al nuevo aa.tenant.
-- ============================================================================
BEGIN;

-- ---------- 0. Pre-flight: parity snapshot (informativo) ----------
\echo '== filas antes =='
SELECT 'Client' t, count(*) n FROM aa."Client"
UNION ALL SELECT 'tenant_shell', count(*) FROM aa.tenant
UNION ALL SELECT 'Agent', count(*) FROM aa."Agent"
UNION ALL SELECT 'Budget', count(*) FROM aa."Budget"
UNION ALL SELECT 'ProspectContact', count(*) FROM aa."ProspectContact"
UNION ALL SELECT 'TokenUsage', count(*) FROM aa."TokenUsage";

-- ---------- 1. FUSIÓN Client → tenant ----------
-- 1a. Absorber cod_tenant del shell en Client (mapping tenant.id = Client.tenant_id).
ALTER TABLE aa."Client" ADD COLUMN IF NOT EXISTS cod_tenant text;
UPDATE aa."Client" c SET cod_tenant = t.cod_tenant FROM aa.tenant t WHERE t.id = c.tenant_id;

-- 1b. Soltar FKs que dependen del shell o de Client (se recrean al nuevo tenant).
ALTER TABLE crm.negocio          DROP CONSTRAINT IF EXISTS negocio_tenant_id_fkey;
ALTER TABLE aa."Client"          DROP CONSTRAINT IF EXISTS "Client_tenant_id_fkey";
ALTER TABLE aa."Agent"           DROP CONSTRAINT IF EXISTS "Agent_clientId_fkey";
ALTER TABLE aa."Budget"          DROP CONSTRAINT IF EXISTS "Budget_clientId_fkey";
ALTER TABLE aa."ProspectContact" DROP CONSTRAINT IF EXISTS "ProspectContact_clientId_fkey";
ALTER TABLE aa."TokenUsage"      DROP CONSTRAINT IF EXISTS "TokenUsage_clientId_fkey";

-- 1c. Eliminar shell vacío de concepto y columnas no deseadas de Client.
DROP TABLE aa.tenant;                       -- shell ten_xxx; su dato útil (cod_tenant) ya migrado
ALTER TABLE aa."Client" DROP COLUMN tenant_id;   -- self-ref al shell, ya no aplica
ALTER TABLE aa."Client" DROP COLUMN address;     -- se conserva `direccion`

-- 1d. Renombrar Client → tenant (survivor) + columnas a castellano.
ALTER TABLE aa."Client" RENAME TO tenant;
ALTER TABLE aa.tenant RENAME COLUMN "codCliente"    TO codigo;
ALTER TABLE aa.tenant RENAME COLUMN name            TO nombre;
ALTER TABLE aa.tenant RENAME COLUMN "razonSocial"   TO razon_social;
ALTER TABLE aa.tenant RENAME COLUMN cif             TO nif;
ALTER TABLE aa.tenant RENAME COLUMN phone           TO telefono;
ALTER TABLE aa.tenant RENAME COLUMN "contactPerson" TO contacto;
ALTER TABLE aa.tenant RENAME COLUMN website         TO sitio_web;
ALTER TABLE aa.tenant RENAME COLUMN "tokenBalance"  TO saldo_tokens;
ALTER TABLE aa.tenant RENAME COLUMN "tokensUsed"    TO tokens_usados;
ALTER TABLE aa.tenant RENAME COLUMN "isActive"      TO activo;
ALTER TABLE aa.tenant RENAME COLUMN "createdAt"     TO creado_en;
ALTER TABLE aa.tenant RENAME COLUMN "updatedAt"     TO actualizado_en;
-- (id, direccion, email, sector, cod_tenant ya en su nombre final)

-- 1e. Renombrar columna FK clientId → tenant_id en hijos + recrear FK al nuevo tenant.
ALTER TABLE aa."Agent"           RENAME COLUMN "clientId" TO tenant_id;
ALTER TABLE aa."Budget"          RENAME COLUMN "clientId" TO tenant_id;
ALTER TABLE aa."ProspectContact" RENAME COLUMN "clientId" TO tenant_id;
ALTER TABLE aa."TokenUsage"      RENAME COLUMN "clientId" TO tenant_id;

-- ---------- 2. DROP tablas no usadas ----------
DROP TABLE IF EXISTS aa."Sector";   -- lookup sin relaciones (confirmado dueño)

-- ---------- 3. RENAME tablas + columnas a castellano (datos reales, RENAME) ----------

-- Agent → agente
ALTER TABLE aa."Agent" RENAME COLUMN "systemPrompt"         TO prompt_sistema;
ALTER TABLE aa."Agent" RENAME COLUMN model                  TO modelo;
ALTER TABLE aa."Agent" RENAME COLUMN "reasoningEffort"      TO esfuerzo_razonamiento;
ALTER TABLE aa."Agent" RENAME COLUMN temperature            TO temperatura;
ALTER TABLE aa."Agent" RENAME COLUMN channel                TO canal;
ALTER TABLE aa."Agent" RENAME COLUMN "widgetPrimaryColor"   TO widget_color_primario;
ALTER TABLE aa."Agent" RENAME COLUMN "widgetSecondaryColor" TO widget_color_secundario;
ALTER TABLE aa."Agent" RENAME COLUMN "widgetAvatarBase64"   TO widget_avatar_base64;
ALTER TABLE aa."Agent" RENAME COLUMN "widgetAvatarEmoji"    TO widget_avatar_emoji;
ALTER TABLE aa."Agent" RENAME COLUMN "widgetTemplateConfig" TO widget_config_plantilla;
ALTER TABLE aa."Agent" RENAME COLUMN "ecommerceConfig"      TO config_ecommerce;
ALTER TABLE aa."Agent" RENAME COLUMN "publicKey"            TO clave_publica;
ALTER TABLE aa."Agent" RENAME COLUMN name                   TO nombre;
ALTER TABLE aa."Agent" RENAME COLUMN "createdAt"            TO creado_en;
ALTER TABLE aa."Agent" RENAME COLUMN "updatedAt"            TO actualizado_en;
ALTER TABLE aa."Agent" RENAME TO agente;

-- AgentSchedule → horario_agente
ALTER TABLE aa."AgentSchedule" RENAME COLUMN "agentId"   TO agente_id;
ALTER TABLE aa."AgentSchedule" RENAME COLUMN timezone    TO zona_horaria;
ALTER TABLE aa."AgentSchedule" RENAME COLUMN schedule    TO horario;
ALTER TABLE aa."AgentSchedule" RENAME COLUMN "createdAt" TO creado_en;
ALTER TABLE aa."AgentSchedule" RENAME COLUMN "updatedAt" TO actualizado_en;
ALTER TABLE aa."AgentSchedule" RENAME TO horario_agente;

-- AgentSkill → agente_skill
ALTER TABLE aa."AgentSkill" RENAME COLUMN "agentId" TO agente_id;
ALTER TABLE aa."AgentSkill" RENAME COLUMN "skillId" TO skill_id;
ALTER TABLE aa."AgentSkill" RENAME TO agente_skill;

-- Appointment → cita
ALTER TABLE aa."Appointment" RENAME COLUMN "slotId"      TO franja_id;
ALTER TABLE aa."Appointment" RENAME COLUMN "serviceId"   TO servicio_id;
ALTER TABLE aa."Appointment" RENAME COLUMN "leadId"      TO lead_id;
ALTER TABLE aa."Appointment" RENAME COLUMN phone         TO telefono;
ALTER TABLE aa."Appointment" RENAME COLUMN notes         TO notas;
ALTER TABLE aa."Appointment" RENAME COLUMN status        TO estado;
ALTER TABLE aa."Appointment" RENAME COLUMN "gcalEventId" TO gcal_event_id;
ALTER TABLE aa."Appointment" RENAME COLUMN "createdAt"   TO creado_en;
ALTER TABLE aa."Appointment" RENAME COLUMN "updatedAt"   TO actualizado_en;
ALTER TABLE aa."Appointment" RENAME TO cita;

-- Automation → automatizacion
ALTER TABLE aa."Automation" RENAME COLUMN "agentId"       TO agente_id;
ALTER TABLE aa."Automation" RENAME COLUMN name            TO nombre;
ALTER TABLE aa."Automation" RENAME COLUMN trigger         TO disparador;
ALTER TABLE aa."Automation" RENAME COLUMN enabled         TO activa;
ALTER TABLE aa."Automation" RENAME COLUMN "lastRunAt"     TO ultima_ejecucion_en;
ALTER TABLE aa."Automation" RENAME COLUMN "n8nWorkflowId" TO n8n_workflow_id;
ALTER TABLE aa."Automation" RENAME COLUMN "syncStatus"    TO estado_sync;
ALTER TABLE aa."Automation" RENAME COLUMN "createdAt"     TO creado_en;
ALTER TABLE aa."Automation" RENAME TO automatizacion;

-- AutomationRun → ejecucion_automatizacion
ALTER TABLE aa."AutomationRun" RENAME COLUMN "automationId" TO automatizacion_id;
ALTER TABLE aa."AutomationRun" RENAME COLUMN status         TO estado;
ALTER TABLE aa."AutomationRun" RENAME COLUMN summary        TO resumen;
ALTER TABLE aa."AutomationRun" RENAME COLUMN "toolCalls"    TO tool_calls;
ALTER TABLE aa."AutomationRun" RENAME COLUMN "createdAt"    TO creado_en;
ALTER TABLE aa."AutomationRun" RENAME TO ejecucion_automatizacion;

-- BlockedRange → rango_bloqueo
ALTER TABLE aa."BlockedRange" RENAME COLUMN "scheduleId" TO horario_id;
ALTER TABLE aa."BlockedRange" RENAME COLUMN "startDate"  TO fecha_inicio;
ALTER TABLE aa."BlockedRange" RENAME COLUMN "endDate"    TO fecha_fin;
ALTER TABLE aa."BlockedRange" RENAME COLUMN reason       TO motivo;
ALTER TABLE aa."BlockedRange" RENAME COLUMN "createdAt"  TO creado_en;
ALTER TABLE aa."BlockedRange" RENAME TO rango_bloqueo;

-- Budget → presupuesto
ALTER TABLE aa."Budget" RENAME COLUMN "quoteNumber"    TO numero_presupuesto;
ALTER TABLE aa."Budget" RENAME COLUMN "clientSnapshot" TO snapshot_cliente;
ALTER TABLE aa."Budget" RENAME COLUMN "issuerSnapshot" TO snapshot_emisor;
ALTER TABLE aa."Budget" RENAME COLUMN status           TO estado;
ALTER TABLE aa."Budget" RENAME COLUMN "subtotalImpl"   TO subtotal_impl;
ALTER TABLE aa."Budget" RENAME COLUMN "subtotalMaint"  TO subtotal_mant;
ALTER TABLE aa."Budget" RENAME COLUMN "vatRate"        TO tasa_iva;
ALTER TABLE aa."Budget" RENAME COLUMN "totalImpl"      TO total_impl;
ALTER TABLE aa."Budget" RENAME COLUMN "totalMaint"     TO total_mant;
ALTER TABLE aa."Budget" RENAME COLUMN "validDays"      TO dias_validez;
ALTER TABLE aa."Budget" RENAME COLUMN notes            TO notas;
ALTER TABLE aa."Budget" RENAME COLUMN "createdAt"      TO creado_en;
ALTER TABLE aa."Budget" RENAME COLUMN "updatedAt"      TO actualizado_en;
ALTER TABLE aa."Budget" RENAME TO presupuesto;

-- BudgetLine → linea_presupuesto
ALTER TABLE aa."BudgetLine" RENAME COLUMN "budgetId"    TO presupuesto_id;
ALTER TABLE aa."BudgetLine" RENAME COLUMN "serviceId"   TO servicio_id;
ALTER TABLE aa."BudgetLine" RENAME COLUMN name          TO nombre;
ALTER TABLE aa."BudgetLine" RENAME COLUMN description   TO descripcion;
ALTER TABLE aa."BudgetLine" RENAME COLUMN quantity      TO cantidad;
ALTER TABLE aa."BudgetLine" RENAME COLUMN "implPrice"   TO precio_impl;
ALTER TABLE aa."BudgetLine" RENAME COLUMN "maintPrice"  TO precio_mant;
ALTER TABLE aa."BudgetLine" RENAME COLUMN position      TO posicion;
ALTER TABLE aa."BudgetLine" RENAME TO linea_presupuesto;

-- ChannelConnection → conexion_canal
ALTER TABLE aa."ChannelConnection" RENAME COLUMN "agentId"      TO agente_id;
ALTER TABLE aa."ChannelConnection" RENAME COLUMN provider       TO proveedor;
ALTER TABLE aa."ChannelConnection" RENAME COLUMN credentials    TO credenciales;
ALTER TABLE aa."ChannelConnection" RENAME COLUMN status         TO estado;
ALTER TABLE aa."ChannelConnection" RENAME COLUMN "statusDetail" TO detalle_estado;
ALTER TABLE aa."ChannelConnection" RENAME COLUMN "webhookSecret" TO webhook_secret;
ALTER TABLE aa."ChannelConnection" RENAME COLUMN "botUsername"  TO bot_username;
ALTER TABLE aa."ChannelConnection" RENAME COLUMN "botName"      TO bot_nombre;
ALTER TABLE aa."ChannelConnection" RENAME COLUMN "createdAt"    TO creado_en;
ALTER TABLE aa."ChannelConnection" RENAME COLUMN "updatedAt"    TO actualizado_en;
ALTER TABLE aa."ChannelConnection" RENAME TO conexion_canal;

-- Conversation → conversacion
ALTER TABLE aa."Conversation" RENAME COLUMN "agentId"   TO agente_id;
ALTER TABLE aa."Conversation" RENAME COLUMN channel     TO canal;
ALTER TABLE aa."Conversation" RENAME COLUMN metadata    TO metadatos;
ALTER TABLE aa."Conversation" RENAME COLUMN "createdAt" TO creado_en;
ALTER TABLE aa."Conversation" RENAME TO conversacion;

-- Integration → integracion
ALTER TABLE aa."Integration" RENAME COLUMN "agentId"      TO agente_id;
ALTER TABLE aa."Integration" RENAME COLUMN provider       TO proveedor;
ALTER TABLE aa."Integration" RENAME COLUMN "accessToken"  TO access_token;
ALTER TABLE aa."Integration" RENAME COLUMN "refreshToken" TO refresh_token;
ALTER TABLE aa."Integration" RENAME COLUMN "expiresAt"    TO expira_en;
ALTER TABLE aa."Integration" RENAME COLUMN status         TO estado;
ALTER TABLE aa."Integration" RENAME COLUMN metadata       TO metadatos;
ALTER TABLE aa."Integration" RENAME COLUMN "createdAt"    TO creado_en;
ALTER TABLE aa."Integration" RENAME TO integracion;

-- KnowledgeChunk → fragmento_conocimiento
ALTER TABLE aa."KnowledgeChunk" RENAME COLUMN "agentId"   TO agente_id;
ALTER TABLE aa."KnowledgeChunk" RENAME COLUMN source      TO fuente;
ALTER TABLE aa."KnowledgeChunk" RENAME COLUMN content     TO contenido;
ALTER TABLE aa."KnowledgeChunk" RENAME COLUMN "createdAt" TO creado_en;
ALTER TABLE aa."KnowledgeChunk" RENAME TO fragmento_conocimiento;

-- LandingLead → landing_lead (anglicismo, snake_case)
ALTER TABLE aa."LandingLead" RENAME COLUMN name        TO nombre;
ALTER TABLE aa."LandingLead" RENAME COLUMN phone       TO telefono;
ALTER TABLE aa."LandingLead" RENAME COLUMN message     TO mensaje;
ALTER TABLE aa."LandingLead" RENAME COLUMN consent     TO consentimiento;
ALTER TABLE aa."LandingLead" RENAME COLUMN "createdAt" TO creado_en;
ALTER TABLE aa."LandingLead" RENAME TO landing_lead;

-- LandingProject → landing_project (anglicismo, snake_case)
ALTER TABLE aa."LandingProject" RENAME COLUMN name               TO nombre;
ALTER TABLE aa."LandingProject" RENAME COLUMN business           TO negocio;
ALTER TABLE aa."LandingProject" RENAME COLUMN answers            TO respuestas;
ALTER TABLE aa."LandingProject" RENAME COLUMN "chatMessages"     TO chat_mensajes;
ALTER TABLE aa."LandingProject" RENAME COLUMN "generationPrompt" TO prompt_generacion;
ALTER TABLE aa."LandingProject" RENAME COLUMN "dbProvider"       TO db_provider;
ALTER TABLE aa."LandingProject" RENAME COLUMN files              TO archivos;
ALTER TABLE aa."LandingProject" RENAME COLUMN "mobileFiles"      TO archivos_movil;
ALTER TABLE aa."LandingProject" RENAME COLUMN "mobileStack"      TO stack_movil;
ALTER TABLE aa."LandingProject" RENAME COLUMN "qrUrl"            TO qr_url;
ALTER TABLE aa."LandingProject" RENAME COLUMN status             TO estado;
ALTER TABLE aa."LandingProject" RENAME COLUMN "createdAt"        TO creado_en;
ALTER TABLE aa."LandingProject" RENAME COLUMN "updatedAt"        TO actualizado_en;
ALTER TABLE aa."LandingProject" RENAME TO landing_project;

-- Lead → lead (anglicismo)
ALTER TABLE aa."Lead" RENAME COLUMN "agentId"        TO agente_id;
ALTER TABLE aa."Lead" RENAME COLUMN "conversationId" TO conversacion_id;
ALTER TABLE aa."Lead" RENAME COLUMN "customerName"   TO nombre_cliente;
ALTER TABLE aa."Lead" RENAME COLUMN phone            TO telefono;
ALTER TABLE aa."Lead" RENAME COLUMN consent          TO consentimiento;
ALTER TABLE aa."Lead" RENAME COLUMN status           TO estado;
ALTER TABLE aa."Lead" RENAME COLUMN "createdAt"      TO creado_en;
ALTER TABLE aa."Lead" RENAME TO lead;

-- MarketStudy → estudio_mercado
ALTER TABLE aa."MarketStudy" RENAME COLUMN title             TO titulo;
ALTER TABLE aa."MarketStudy" RENAME COLUMN inputs            TO entradas;
ALTER TABLE aa."MarketStudy" RENAME COLUMN sections          TO secciones;
ALTER TABLE aa."MarketStudy" RENAME COLUMN prospects         TO prospectos;
ALTER TABLE aa."MarketStudy" RENAME COLUMN status            TO estado;
ALTER TABLE aa."MarketStudy" RENAME COLUMN "successScore"    TO puntuacion_exito;
ALTER TABLE aa."MarketStudy" RENAME COLUMN model             TO modelo;
ALTER TABLE aa."MarketStudy" RENAME COLUMN "reasoningEffort" TO esfuerzo_razonamiento;
ALTER TABLE aa."MarketStudy" RENAME COLUMN "createdAt"       TO creado_en;
ALTER TABLE aa."MarketStudy" RENAME COLUMN "updatedAt"       TO actualizado_en;
ALTER TABLE aa."MarketStudy" RENAME TO estudio_mercado;

-- Message → mensaje
ALTER TABLE aa."Message" RENAME COLUMN "conversationId" TO conversacion_id;
ALTER TABLE aa."Message" RENAME COLUMN role             TO rol;
ALTER TABLE aa."Message" RENAME COLUMN content          TO contenido;
ALTER TABLE aa."Message" RENAME COLUMN "toolCalls"      TO tool_calls;
ALTER TABLE aa."Message" RENAME COLUMN "createdAt"      TO creado_en;
ALTER TABLE aa."Message" RENAME TO mensaje;

-- ProspectContact → contacto_prospecto
ALTER TABLE aa."ProspectContact" RENAME COLUMN type          TO tipo;
ALTER TABLE aa."ProspectContact" RENAME COLUMN name          TO nombre;
ALTER TABLE aa."ProspectContact" RENAME COLUMN phone         TO telefono;
ALTER TABLE aa."ProspectContact" RENAME COLUMN "contactedAt" TO contactado_en;
ALTER TABLE aa."ProspectContact" RENAME COLUMN "createdAt"   TO creado_en;
ALTER TABLE aa."ProspectContact" RENAME COLUMN "deletedAt"   TO eliminado_en;
ALTER TABLE aa."ProspectContact" RENAME TO contacto_prospecto;

-- Service (aa) → servicio_agente (evita choque conceptual con crm.servicio)
ALTER TABLE aa."Service" RENAME COLUMN "agentId"   TO agente_id;
ALTER TABLE aa."Service" RENAME COLUMN name        TO nombre;
ALTER TABLE aa."Service" RENAME COLUMN duration    TO duracion;
ALTER TABLE aa."Service" RENAME COLUMN description TO descripcion;
ALTER TABLE aa."Service" RENAME COLUMN enabled     TO activo;
ALTER TABLE aa."Service" RENAME COLUMN "createdAt" TO creado_en;
ALTER TABLE aa."Service" RENAME COLUMN "updatedAt" TO actualizado_en;
ALTER TABLE aa."Service" RENAME TO servicio_agente;

-- Skill → skill (anglicismo)
ALTER TABLE aa."Skill" RENAME COLUMN name        TO nombre;
ALTER TABLE aa."Skill" RENAME COLUMN description TO descripcion;
ALTER TABLE aa."Skill" RENAME COLUMN type        TO tipo;
ALTER TABLE aa."Skill" RENAME COLUMN use         TO uso;
ALTER TABLE aa."Skill" RENAME COLUMN "repoUrl"   TO repo_url;
ALTER TABLE aa."Skill" RENAME COLUMN stars       TO estrellas;
ALTER TABLE aa."Skill" RENAME COLUMN tools       TO herramientas;
ALTER TABLE aa."Skill" RENAME COLUMN source      TO fuente;
ALTER TABLE aa."Skill" RENAME COLUMN favorite    TO favorito;
ALTER TABLE aa."Skill" RENAME COLUMN "createdAt" TO creado_en;
ALTER TABLE aa."Skill" RENAME TO skill;

-- SystemConfig → configuracion_sistema
ALTER TABLE aa."SystemConfig" RENAME COLUMN theme                TO tema;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "primaryColor"       TO color_primario;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "secondaryColor"     TO color_secundario;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "fontFamily"         TO fuente;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "sidebarLogo"        TO sidebar_logo;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "sidebarBg"          TO sidebar_bg;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "pageBg"             TO page_bg;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "sidebarBgLight"     TO sidebar_bg_claro;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "pageBgLight"        TO page_bg_claro;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "adminEmail"         TO email_admin;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "defaultAgentModel"  TO modelo_agente_default;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "reasoningEffort"    TO esfuerzo_razonamiento;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "googleClientId"     TO google_client_id;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "googleClientSecret" TO google_client_secret;
ALTER TABLE aa."SystemConfig" RENAME COLUMN "updatedAt"          TO actualizado_en;
ALTER TABLE aa."SystemConfig" RENAME TO configuracion_sistema;

-- TimeSlot → franja_horaria
ALTER TABLE aa."TimeSlot" RENAME COLUMN "serviceId"    TO servicio_id;
ALTER TABLE aa."TimeSlot" RENAME COLUMN "startTime"    TO inicio;
ALTER TABLE aa."TimeSlot" RENAME COLUMN "endTime"      TO fin;
ALTER TABLE aa."TimeSlot" RENAME COLUMN available      TO disponible;
ALTER TABLE aa."TimeSlot" RENAME COLUMN "syncedToGcal" TO sincronizado_gcal;
ALTER TABLE aa."TimeSlot" RENAME COLUMN "createdAt"    TO creado_en;
ALTER TABLE aa."TimeSlot" RENAME TO franja_horaria;

-- TokenUsage → uso_tokens
ALTER TABLE aa."TokenUsage" RENAME COLUMN "agentId"        TO agente_id;
ALTER TABLE aa."TokenUsage" RENAME COLUMN "conversationId" TO conversacion_id;
ALTER TABLE aa."TokenUsage" RENAME COLUMN model            TO modelo;
ALTER TABLE aa."TokenUsage" RENAME COLUMN "createdAt"      TO creado_en;
ALTER TABLE aa."TokenUsage" RENAME TO uso_tokens;

-- User → usuario
ALTER TABLE aa."User" RENAME COLUMN "firstName" TO nombre;
ALTER TABLE aa."User" RENAME COLUMN "lastName"  TO apellido;
ALTER TABLE aa."User" RENAME COLUMN role        TO rol;
ALTER TABLE aa."User" RENAME COLUMN "createdAt" TO creado_en;
ALTER TABLE aa."User" RENAME COLUMN "updatedAt" TO actualizado_en;
ALTER TABLE aa."User" RENAME TO usuario;

-- ---------- 4. Recrear FKs de la fusión apuntando al nuevo aa.tenant(id) ----------
ALTER TABLE aa.agente              ADD CONSTRAINT agente_tenant_id_fkey            FOREIGN KEY (tenant_id) REFERENCES aa.tenant(id) ON DELETE SET NULL;
ALTER TABLE aa.presupuesto         ADD CONSTRAINT presupuesto_tenant_id_fkey       FOREIGN KEY (tenant_id) REFERENCES aa.tenant(id) ON DELETE SET NULL;
ALTER TABLE aa.contacto_prospecto  ADD CONSTRAINT contacto_prospecto_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES aa.tenant(id) ON DELETE SET NULL;
ALTER TABLE aa.uso_tokens          ADD CONSTRAINT uso_tokens_tenant_id_fkey         FOREIGN KEY (tenant_id) REFERENCES aa.tenant(id) ON DELETE CASCADE;

-- ---------- 5. Recrear cross-schema FK crm.negocio.tenant_id → aa.tenant(id) ----------
ALTER TABLE crm.negocio ADD CONSTRAINT negocio_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES aa.tenant(id);

-- ---------- 6. Verificación parity (post) ----------
\echo '== filas despues =='
SELECT 'tenant' t, count(*) n FROM aa.tenant
UNION ALL SELECT 'agente', count(*) FROM aa.agente
UNION ALL SELECT 'presupuesto', count(*) FROM aa.presupuesto
UNION ALL SELECT 'contacto_prospecto', count(*) FROM aa.contacto_prospecto
UNION ALL SELECT 'uso_tokens', count(*) FROM aa.uso_tokens
UNION ALL SELECT 'fragmento_conocimiento', count(*) FROM aa.fragmento_conocimiento;

-- FKs de tenant huérfanas? (debe ser 0)
\echo '== FKs tenant_id huerfanas (debe 0) =='
SELECT 'agente' t, count(*) n FROM aa.agente a WHERE a.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aa.tenant t WHERE t.id=a.tenant_id)
UNION ALL SELECT 'uso_tokens', count(*) FROM aa.uso_tokens u WHERE NOT EXISTS (SELECT 1 FROM aa.tenant t WHERE t.id=u.tenant_id);

COMMIT;
