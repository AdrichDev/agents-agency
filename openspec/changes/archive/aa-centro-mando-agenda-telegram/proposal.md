# Propuesta — Centro de Mando, Agenda y Telegram UI en Agents Agency

**Nivel Gru: 4 — Crítica.** Cruza navegación, agenda, integraciones calendario, detalle de cita, canal Telegram en vivo y creación de agentes vía OpenClaw.
**Estado: EN CURSO (auditado 06/07/2026 contra código real).**

## Contexto
Agents Agency ya tiene navegación agrupada, contactos, canales Telegram/WhatsApp y sincronización de citas con Google Calendar. El usuario pide alinear la experiencia con OperaOS: título `Centro de Mando`, sección `Área de Trabajo`, agenda a pantalla completa clonada del widget principal de OperaOS y UI de Telegram dentro de la aplicación.

Auditoría 06/07/2026: Fases 2, 3, 4 (lib+tests) y 5 (UI local) ya están sustancialmente implementadas en código aunque tasks.md estaba sin marcar. Fase 1 está incompleta (navigation.ts desalineado de sus propios tests). Falta el puente en tiempo real con creador_CRM (5.4) y toda la Fase 6.

## Intención
1. Cambiar el título del sidebar a `Centro de Mando` y aplicar tipografía/estilo OperaOS a todos los títulos de sección.
2. Renombrar `Nombre grupal` a `Área de Trabajo` con `Dashboard` y `Agenda`. Telegram NO va en la navegación (widget flotante global, patrón creador_CRM); `Mi Cuenta` y `Configuración` permanecen en la rosca de ajustes.
3. Crear vista `Agenda` full-screen idéntica al widget principal de OperaOS.
4. En detalle de cita, enriquecer datos de cliente y añadir botón de ubicación con chincheta que abra Google Maps.
5. Conectar agenda con Google Calendar y dejar preparado Outlook u otro proveedor.
6. Implantar un widget flotante global de Telegram (patrón creador_CRM; Telegram es un bot, NO una página) para leer/escribir en directo desde Agents Agency, mostrando la MISMA conversación que creador_CRM (bidireccional, tiempo casi real, con notificaciones).
7. **(Phase 6, añadida 06/07/2026)** Rehacer el wizard de creación de agente: desplegable de nombres comerciales desde clientes existentes (`GET /api/clients`), sector autocompletado del cliente, tipo de canal, personalidad, skills y necesidades. Los agentes se crean REALMENTE en OpenClaw; Agents Agency es solo la capa de presentación. Diseño multitenant: cada tenant futuro de creador_CRM podrá tener su propio bot.

## Decisiones
- La agenda visual se define primero en OperaOS y se replica/adapta en Agents Agency para evitar dos diseños divergentes.
- El botón `📍 Ubicación` puede estar activo o desactivado según exista dirección válida.
- Calendar debe ser tenant-aware: cada cliente/tenant usa su proveedor conectado.
- Telegram: OpenClaw + mcp-plataforma es el HUB único de mensajes. Inbound: fan-out del hub a ambos consumidores (CRM y AA) con idempotencia por `providerMessageId`. Outbound: un solo camino de salida por el hub (`TELEGRAM_SEND_URL`) para evitar dobles envíos al cliente final; AA deja de llamar a Bot API directo cuando el agente es `runtime=openclaw`.
- Creación de agente: `runtime=openclaw` obligatorio en el wizard. AA persiste el espejo local y provisiona en OpenClaw con verificación read-back (`config.get`) — el estado "creado en OpenClaw" no se asume, se comprueba.
- Multitenancy: hoy hay un solo `OPENCLAW_GATEWAY_TOKEN` y un `config.agents.list` global. La Fase 6 introduce entradas por agente con clave estable (`aa-<id>`) y deja documentada la limitación de instancia única como deuda antes de multi-tenant real (riesgo ya registrado: `OPERATOR_SERVICE_TOKEN` único).

## Alcance
- Sidebar y navegación de AA.
- Página `/agenda` full-screen.
- Modal/detalle de cita con cliente comercial, persona de contacto, teléfono, dirección, anotaciones y ubicación.
- Sincronización calendario Google/Outlook-ready (incluye cablear update/reschedule, hoy dead code).
- UI de Telegram vinculada a conversaciones reales, compartida con creador_CRM vía hub.
- Wizard de creación de agentes con OpenClaw como fuente de verdad.
- Cross-repo mínimo imprescindible: montar `telegramWebhookRouter` en creador_CRM (hoy definido pero nunca montado — ingesta inbound muerta) y verificar el fan-out en OpenClaw/mcp-plataforma.

## Fuera de alcance
- Rediseñar todo Agents Agency fuera del sidebar/agenda.
- Automatizaciones nuevas de calendario no pedidas.
- Sustituir Telegram Bot API; se reutiliza el canal existente.
- Multi-instancia OpenClaw por tenant (se documenta como deuda, no se implementa aquí).

## Riesgos
- Duplicar lógica visual entre OperaOS y AA si no se crea primero la referencia.
- Desincronización calendario si no hay fuente única de CRUD.
- Mensajes Telegram duplicados si CRM y AA escriben outbound por caminos independientes (dedup por `clientMessageId` es por-app, NO cross-app) → mitigado con hub único de salida.
- `config.patch` de OpenClaw hace read-modify-write de un array compartido → creaciones concurrentes pueden pisarse; serializar provisioning.
- Provisioning fail-soft: sin read-back, la UI mentiría sobre el estado del agente en OpenClaw.

## Dependencias
- Depende de `crm-operaos-agenda-contactos-fichaje-telegram` para clonar la agenda visual desde OperaOS.
- Reutiliza `agents-agency/back/src/lib/booking/sync.ts` y canales Telegram existentes.
- creador_CRM: modelo `crm.mensaje_telegram`, hook `useTelegramInbox`, componente `TelegramConversacion` (portables).
- OpenClaw/mcp-plataforma: `TELEGRAM_SEND_URL`, `OPERATOR_SERVICE_TOKEN`, RPC admin `config.get`/`config.patch`.
