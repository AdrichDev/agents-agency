# Diseño — Centro de Mando, Agenda y Telegram UI en Agents Agency

## Enfoque técnico
Agents Agency consume la agenda visual ya estabilizada en OperaOS. Capas: (1) navegación (`NAV_GROUPS` + `Sidebar`); (2) página `/agenda` full-screen; (3) cita + calendario externo + Telegram UI usando los puertos existentes de booking/canales; (4) puente de conversación compartida con creador_CRM vía hub OpenClaw; (5) wizard de creación de agentes con OpenClaw como fuente de verdad.

## Decisiones de arquitectura

| Decisión | Elección | Alternativa descartada | Motivo |
|---------|----------|------------------------|--------|
| Fuente visual de agenda | Clonar/adaptar `AgendaWidget` de OperaOS | Diseñar una agenda nueva en AA | Evita dos experiencias distintas y cumple «exactamente igual». |
| Calendario externo | Puerto común `CalendarProvider` con Google inicial | Acoplar cada pantalla a Google API | Permite Outlook u otro proveedor después sin reescribir UI. Ya implementado en `back/src/lib/integrations/calendar-provider.ts`. |
| Ubicación | Link Google Maps desde dirección normalizada | Mapa embebido propio | El usuario pidió Google Maps y reduce coste de integración. |
| Telegram UI | Persistencia + polling corto sobre conversaciones reales | Solo iframe/enlace a Telegram | Permite escribir desde la aplicación y auditar mensajes. |
| Conversación compartida CRM↔AA | «AA canal + cerebro OpenClaw» (aprobado 06/07/2026): AA hub de bots de clientes (webhook+token por agente), cerebro del agente en OpenClaw (`openclaw/aa-<id>`), AA único escritor a Bot API, fan-out AA→CRM idempotente; `TELEGRAM_SEND_URL` del CRM apunta a endpoint de servicio nuevo en AA | Hub en OpenClaw/mcp-plataforma (gateway third-party: un botToken global, sin fan-out, sin webhook por agente — inviable); multiplexor nuevo (infra duplicada) | Auditoría OpenClaw 06/07/2026: @Estudio3ABot es personal del operador; mcp-plataforma releva tool calls, no mensajes; el contrato TELEGRAM_SEND_URL no estaba implementado en ningún repo. AA ya tiene todo el canal construido y multitenant (token cifrado por ChannelConnection). |
| Tiempo real + notificaciones | Polling 4-5s + badge no-leídos + toast en delta de mensajes | WebSocket/SSE ahora | CRM ya opera así (5s/15s); paridad primero, SSE como mejora futura documentada. |
| Creación de agente | Wizard fuerza `runtime=openclaw`; provisioning extendido (identity + systemPrompt + canal) con read-back `config.get` | Mantener default `runtime=openai` | Requisito: los agentes SE CREAN en OpenClaw; AA solo muestra. Sin read-back la UI mentiría (provisioning es fail-soft). |
| Cliente en wizard | Desplegable desde `GET /api/clients` (nombre comercial) + autofill `sector`; opción «nuevo cliente» explícita | Texto libre actual (crea Tenant nuevo siempre) | Hoy cada agente crea un Tenant duplicado; el desplegable reutiliza tenants reales y alinea sector. |
| Multitenancy OpenClaw | Entradas por agente con clave `aa-<agentId>` en `config.agents.list`; provisioning serializado; limitación single-instance documentada | Multi-instancia OpenClaw por tenant | Fuera de alcance; el token único (`OPENCLAW_GATEWAY_TOKEN`, `OPERATOR_SERVICE_TOKEN`) es deuda registrada pre-multi-tenant real. |

## Flujo de datos

```text
Sidebar → /agenda → API citas tenant → detalle cita
                         │              ├─ Google Maps URL
                         │              └─ CalendarProvider sync (create/update/delete)

Telegram (cliente) → Bot API → AA webhook por agente (/api/channels/telegram/:agentId)
    AA persiste in (idempotente providerMessageId)
    AA invoca cerebro del agente en OpenClaw (OPENCLAW_BASE_URL /v1, modelo openclaw/aa-<id>)
    AA responde vía Bot API (único escritor) y persiste out
    AA fan-out best-effort → CRM POST /service/operator/telegram (montar router; idempotente)
Respuesta manual CRM → TELEGRAM_SEND_URL = endpoint servicio AA {businessId, conversationId, text}
    → AA envía Bot API + persiste + fan-out de vuelta a CRM
Respuesta manual AA (widget) → mismo camino interno de AA
OpenClaw (@Estudio3ABot) queda como bot personal del operador — fuera de este flujo

Wizard AA → POST /api/agents (runtime=openclaw)
         → Prisma (espejo local Agent + Tenant seleccionado)
         → provision OpenClaw: config.patch agents.list[aa-<id>] {identity, systemPrompt, params}
         → read-back config.get → status «provisioned|pending|failed» visible en UI
```

## Cambios de archivos

| Archivo | Acción | Descripción |
|--------|--------|-------------|
| `front/lib/navigation.ts` | Modificar | `NAV_TITLE='Centro de Mando'`; grupo `Área de Trabajo` = Dashboard + Agenda SOLO. Telegram sin entrada de nav (widget flotante); Mi Cuenta/Configuración en dropdown de ajustes. Corregir `tests/navigation.spec.ts` a este contrato. |
| `front/components/Sidebar.tsx` | Modificar | Quitar heading hardcodeado; título desde `NAV_TITLE`. Estilo títulos ya OperaOS (hecho). |
| `front/app/agenda/page.tsx` | Retocar | Hecho. Quitar aviso «datos demostrativos» cuando hay datos reales. |
| `front/components/agenda/*` | Hecho | Componentes de vista, tarjetas y detalle ya creados. |
| `back/src/lib/booking/sync.ts` | Cablear | `updateAppointmentInExternalCalendar` existe pero NINGUNA ruta lo llama; cablear en reschedule/update de `routes/booking.ts`. |
| `back/src/lib/integrations/calendar-provider.ts` | Hecho | Puerto Google/mock con CRUD completo + tests contract. |
| `back/src/routes/channels.ts` | Modificar | Outbound vía hub cuando `runtime=openclaw` (hoy `tgSendMessage` directo); mantener idempotencia `clientMsgId`. |
| `front/app/telegram/page.tsx` | ELIMINAR | Decisión usuario: Telegram es un bot, no una página. Se borra la vista completa y su spec. |
| `front/components/telegram-widget` (nuevo) | Crear | ÚNICA UI Telegram en AA: widget flotante global portando patrón creador_CRM (`telegram-widget.tsx` + montaje global), badge no-leídos + toasts, consume los endpoints back existentes de `channels.ts`. |
| `front/components/agent-wizard/ClientStep.tsx` | Rehacer | Desplegable de clientes (`GET /api/clients`) con nombre comercial; opción crear nuevo; autofill sector. |
| `front/app/agents/new/page.tsx` + `hooks/useAgentWizard.ts` | Modificar | Enviar `runtime='openclaw'` y `tenantId` del cliente seleccionado. |
| `back/src/routes/agents.ts` + `lib/agent/service.ts` | Modificar | Aceptar `tenantId` existente (no crear Tenant duplicado); estado de provisioning en respuesta. |
| `back/src/lib/openclaw/provision.ts` | Extender | Entry con identity+systemPrompt; canal Telegram por agente (no clobber global); serializar patch; read-back verificación. |
| creador_CRM `back/src/server.ts` | Cross-repo | Montar `telegramWebhookRouter` en `/service/operator/telegram` (hoy definido y NUNCA montado — ingesta muerta). |

## Contratos

```ts
type CalendarProvider = {
  createEvent(input: CalendarEventInput): Promise<{ externalId: string }>;
  updateEvent(externalId: string, input: CalendarEventInput): Promise<void>;
  deleteEvent(externalId: string): Promise<void>;
};

type AppointmentContactSummary = {
  commercialName: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
};

// Phase 6 — provisioning OpenClaw
type OpenClawAgentEntry = {
  id: string;            // aa-<agentId>, clave estable
  workspace: string;     // aa-<agentId>
  identity: { name: string };
  systemPrompt?: string; // hoy NO se sincroniza (gap documentado en provision.ts)
  params: { temperature?: number };
};

type ProvisionStatus = "provisioned" | "pending" | "failed";
```

## Estrategia de pruebas

| Capa | Qué probar | Enfoque |
|------|------------|---------|
| Unit | Google Maps URL, mapper cliente/cita, idempotencia Telegram, buildAgentEntry con systemPrompt | Vitest/node tests. |
| Integración | CRUD cita ↔ CalendarProvider mock (incluido UPDATE cableado); wizard→agents con tenantId existente; provisioning con read-back mock | API tests sin red real. |
| UI | Sidebar (navigation.spec.ts en verde), `/agenda`, detalle cita, Telegram UI (badge/toast), wizard con desplegable | Render tests + snapshots. |
| E2E | Crear cita, ver detalle, abrir ubicación, responder Telegram, crear agente completo | Playwright si está disponible. |
| Cross-app | Mensaje inbound aparece en CRM y AA; reply desde AA llega una sola vez a Telegram | Contract tests contra hub mock. |

## Migración / rollout
Sidebar/agenda: sin migración. Telegram UI: persistencia ya existe (Conversation/Message en AA, mensaje_telegram en CRM); cambios aditivos si hacen falta índices. Wizard: `runtime` y `tenantId` ya existen en schema — sin migración prevista.

## Preguntas abiertas
- [x] UI Telegram como nav propio → resuelto en código: página top-level `/telegram` (falta entrada en sidebar, Fase 1).
- [ ] Confirmar en OpenClaw/mcp-plataforma si el fan-out inbound a dos consumidores ya existe o hay que añadirlo (verificar antes de Fase 5.4).
