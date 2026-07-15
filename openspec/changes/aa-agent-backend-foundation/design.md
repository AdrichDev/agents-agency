# Design — aa-agent-backend-foundation

> Análisis + diseño (sin implementación). Todo lo afirmado está verificado con
> `archivo:línea` sobre el código real. Lo que no existe se marca **AUSENTE**.
> Rutas relativas a `agents-agency/` salvo indicación.

## Contexto

AA genera chatbots/agentes para clientes (widget web, API, Telegram, WhatsApp).
Problema de fondo ("casa por el tejado"): **ningún agente declara hoy dónde vive
la data de su negocio** (reservas, leads, pedidos). El agente conversa, busca en
RAG y usa integraciones OAuth genéricas, pero no tiene un backend de datos
propio contra el que operar. Este design cubre: (A) auditoría del panel del
agente, (B) cimientos de backend de datos, (C) reestructura del panel,
(D) notificación al cliente final, (E) decisiones abiertas.

---

## A. Estado actual por sección del panel

Tabs reales del detalle: `front/app/agents/[id]/page.tsx:18` —
`chat | skills | integraciones | automatizaciones | deploy | logs | conocimiento | leads | ajustes`.

| Sección | ¿Existe? | Qué hace hoy | Veredicto | Por qué |
|---|---|---|---|---|
| **Chat (prueba)** | `page.tsx:104` → `front/components/ChatTester.tsx` | Chat de prueba contra el agente | **MANTENER** | Es la validación básica del agente |
| **Backend de datos** | **AUSENTE** — ninguna tab, ningún campo del wizard, ningún modelo Prisma lo declara | — | **CREAR** | Ver sección B. Lo más cercano que existe: `ecommerceConfig.orderStatusUrl` (solo lectura de pedidos) |
| **Skills** | Tab: `front/components/agents/SkillsTab.tsx:7-48`; wizard paso 4: `front/components/agent-wizard/SkillsStep.tsx`; contrato: `back/src/lib/agent/skill-capabilities.ts:32-38` | Lista skills con estado ejecutable/requiere-conexión/informativa | **QUITAR** (de wizard y panel) | Las skills "ejecutables" solo re-expresan lo que Integraciones ya da: `buildAgentTools` (`back/src/lib/agent/engine.ts:69-108`) une integraciones ∪ skills con dedup donde **las integraciones ganan** — si el provider está conectado, las tools llegan igual sin skill. Las "informativas" son solo texto en el prompt (`engine.ts:146-159`), cubrible editando la personalidad. El usuario no las ve necesarias |
| **Integraciones** | `page.tsx:110-129`: `ChannelConnectPanel` (telegram/whatsapp), `IntegrationsPanel` (OAuth google/slack/jira), `EcommerceConfigPanel` (horario, canal Slack de handoff, orderStatusUrl+apiKey) | Conectar canal y servicios externos | **MANTENER** (reencuadrar) | Es donde vive la única configuración de "API externa" actual. `EcommerceConfigPanel` debería migrar a la nueva sección Backend de datos |
| **Automatizaciones** | `front/components/AutomationsPanel.tsx:9-79`; back: `back/src/lib/automations/engine.ts:45-136`, `back/src/routes/automations.ts:29-70`, `back/src/lib/n8n/workflow-builder.ts:34-114` | Crear automatización con prompt en lenguaje natural + trigger (email/slack/schedule). n8n solo genera el **trigger** (Schedule/Webhook → HTTP POST a `/api/automations/:id/execute`); la "lógica" es el prompt NL ejecutado por `runAgent` | **MODIFICAR** | **No existe importación de workflows n8n — AUSENTE** (rutas: solo POST/PATCH/DELETE/execute/resync, `automations.ts:29-202`). La "generación NL" actual no genera workflow real: n8n es un mero despertador. Propuesta abajo |
| **Deploy** | `front/components/DeployPanel.tsx:40-257`; script real: `back/public/widget.js` (144 líneas, servido estático `back/src/index.ts:107`) | Snippet `<script src=".../widget.js" data-agent-key="...">` (`DeployPanel.tsx:59`), curl de API (`:60-62`), config visual del widget, tarjetas informativas telegram/whatsapp | **MODIFICAR** | El script del widget es correcto para un chatbot (carga config pública `/api/widget/config` y chatea vía `/api/chat` con `publicKey` — `widget.js:103,132-135`). Fallos: (1) tarjetas telegram/whatsapp dicen "conexión guiada próximamente" (`DeployPanel.tsx:31,36,250-251`) cuando **ya existe** (`ChannelConnectPanel` + `back/src/routes/channels.ts`); (2) no hay guía de implementación paso a paso (req. 10); (3) config visual duplicada con el wizard |
| **Logs** | `front/components/LogsPanel.tsx:23-59` | SOLO ejecuciones de automatizaciones (`AutomationRun`), nada más | **QUITAR** como tab | El usuario duda de su valor y con razón: si el agente no tiene automatizaciones, la tab está vacía para siempre. Mover el historial de runs dentro de Automatizaciones. Lo que NO existe y sería más útil: vista de **conversaciones** del agente (los datos existen — `Conversation`/`Message` en `prisma/schema.prisma:313`; UI en panel: AUSENTE) |
| **Base de conocimiento** | `front/components/agents/KnowledgeTab.tsx:20-155`; back: `back/src/routes/knowledge.ts`; ingesta web: `back/src/lib/scraper/web.ts:55-80` | Ingesta por URL (crawl 1 nivel, máx 9 páginas — `web.ts:61,66`), subida de archivos, listado/borrado de fuentes | **MANTENER + MODIFICAR** | La web del wizard SÍ se ingesta al crear (`back/src/lib/agent/service.ts:166`) **pero fire-and-forget con `.catch(() => {})`** — si falla, nadie se entera y la tab no muestra ni la URL ni el estado. Fix: mostrar la fuente "web inicial" con estado (pendiente/indexada/fallida) y botón re-ingestar |
| **Archivos adjuntos (almacenamiento)** | Upload: `back/src/routes/knowledge.ts:41-44` — `multer.memoryStorage()`, 20 MB, máx 10 | El archivo se parsea **en memoria** (`parseFile`, `knowledge.ts:84`) y solo se guardan los **chunks de texto** en Postgres (`KnowledgeChunk`, `prisma/schema.prisma:168-179`, `embedding vector(1536)` pgvector) | **DECISIÓN** (ver E) | **El archivo original NO se guarda en ningún sitio — verificado.** No hay bucket de KB: el único bucket Supabase Storage es `public-assets` (`back/src/lib/storage.ts:39`) y se usa solo para avatares de widget y assets de landing. Consecuencia: no se puede re-descargar ni re-procesar un adjunto |
| **Leads** | `front/components/LeadsPanel.tsx:23-108`; back: `back/src/lib/agent/service.ts:441-457`; captura: `back/src/lib/lead-flow.ts:54-177` + tool `record_lead_intent` (`back/src/lib/agent/tools.ts:148-160`) | Tabla de leads (nombre/email/tel/intención/handoff) | **QUITAR como tab / fold en Actividad** | El usuario no lo ve importante. Ojo: la captura seguiría funcionando (vive en el engine, no en la UI). Nota aparte: `lead-flow.ts:57-91` **fuerza a pedir el nombre antes de responder nada** — máquina de estados regex intrusiva, cuestionable UX del bot (decisión E.4) |
| **Ajustes (modelo)** | `front/components/AgentModelPanel.tsx:8-59` — PATCH model + reasoningEffort | Selector de modelo LLM y esfuerzo de razonamiento | **MODIFICAR** — hoy es parcialmente **decorativo** | Dos problemas verificados: (1) `reasoning_effort` **nunca se aplica al chat del agente**: el choke-point lo elimina cuando hay `tools` (`back/src/lib/openai.ts:87` — `else { delete patched.reasoning_effort }`) y el loop del agente SIEMPRE lleva tools (`engine.ts:284-285` lo documenta); además el engine ni siquiera pasa el effort per-agente. (2) Para agentes `runtime="openclaw"` el `model` de BD **se ignora**: se sustituye por el target `openclaw/aa-<agentId>` (`engine.ts:262-267`, `openai.ts` factory per-agent). El selector solo tiene efecto real en agentes runtime=openai con modelos gpt-4*/gpt-5* y solo para el modelo, no el effort |
| **OpenClaw provisioning (chip)** | `page.tsx:67-83` + `back/src/lib/openclaw/provision.ts:44-58`, re-check `service.ts:226-262` | Estado del aprovisionamiento del cerebro OpenClaw con re-sync | **MANTENER** | Recién endurecido (aa-openclaw-provision-hardening), funciona |

---

## B. Arquitectura de backend del agente (los cimientos)

### B.1 Qué existe hoy (verificado)

1. **Patrón executor server-side** — `back/src/lib/agent/executor.ts:154-163`:
   TODAS las tools del agente se ejecutan en el back de AA, nunca en el
   navegador ni en el LLM. **Esto vale también para runtime=openclaw**: el
   tool-loop vive en AA (`engine.ts:256-330`); OpenClaw solo sustituye al
   cliente LLM (`engine.ts:266`), las tool-calls vuelven a AA y las ejecuta
   `executeTool`. → El punto de integración con cualquier BD/API ya existe:
   basta añadir handlers.
2. **Precedente "vía API" (el único)** — `get_order_status`:
   config per-agente `ecommerceConfig.orderStatusUrl` + `orderStatusApiKey`
   cifrada AES (`service.ts:407-438`, `executor.ts:118-134`,
   `back/src/lib/agent/order-status.ts`). El agente pega a una API externa del
   negocio vía HTTP+Bearer. Es exactamente el patrón a generalizar — pero hoy
   solo cubre UNA operación de solo-lectura.
3. **Motor de reservas interno, NO cableado al agente** — modelos `Service`,
   `AgentSchedule`, `Appointment` (`prisma/schema.prisma:521,556,584`),
   generador de slots puro (`back/src/lib/booking/slots.ts:generateSlots`),
   API REST `/api/booking` (`back/src/routes/booking.ts`) con sync a Google
   Calendar (`back/src/lib/booking/sync.ts`). **Su único consumidor es la
   agenda interna del front** (`front/app/agenda/page.tsx:167`).
   `executor.ts` NO tiene ningún handler de reservas y `tools.ts` ninguna
   tool de booking — **el agente no puede reservar** (la guía de "reserva de
   citas" del prompt, `engine.ts:180-189`, usa Google Calendar crudo, sin
   disponibilidad ni servicios).
4. **Cifrado de credenciales** — `encryptToken`/`decryptToken`
   (`back/src/lib/integrations/oauth.ts`), ya usado por orderStatusApiKey y
   ChannelConnection (`schema.prisma:500-517`).
5. **Selección de backend en wizard** — **AUSENTE**. El wizard
   (`front/app/agents/new/page.tsx:23`, pasos "Cliente y sector / Canal /
   Personalidad / Skills y revisión") no pregunta en ningún paso dónde viven
   los datos del negocio. `CreateAgentInput` (`service.ts:61-73`) no tiene
   ningún campo de backend de datos.
6. **Modelo/tabla de backend de datos** — **AUSENTE** en `prisma/schema.prisma`
   (el modelo `Agent`, líneas 133-166, no tiene nada al respecto; lo único es
   el JSON `ecommerceConfig`).

### B.2 Principio de diseño

**El agente nunca pega "directo" desde el LLM.** El LLM emite tool-calls; el
back de AA las materializa. Por tanto "BD directa vs vía API" no cambia el
runtime del agente — cambia el **adapter** que el executor usa por debajo.
Nosotros (la agencia) hosteamos siempre ese backend (Render/VPS): la BD del
negocio es una BD que nosotros aprovisionamos, o una API que nosotros creamos
delante de ella.

### B.3 Contrato de backend (nuevo)

Nuevo modelo `AgentDataBackend` (1:1 con Agent) — NO otro JSON en
`ecommerceConfig` (ese campo ya es un cajón de sastre que además guarda
`openclawProvisioning`, `service.ts:184-188`):

```prisma
model AgentDataBackend {
  id            String  @id @default(cuid())
  agentId       String  @unique
  mode          String  // "managed_db" | "external_api" | "none_yet"
  // managed_db: connection string cifrada de la BD que aprovisionamos
  dbUrlEncrypted String?
  dbSchema       Json    @default("{}") // mapeo tabla/columnas por capability
  // external_api: base URL + auth de la API (nuestra o del cliente)
  apiBaseUrl     String?
  apiKeyEncrypted String?
  capabilities   Json    @default("[]") // subset habilitado (ver abajo)
}
```

Contrato de capacidades (interface TS, implementada por 2 adapters):

```ts
interface AgentBackendAdapter {
  consultarDisponibilidad(servicio, rangoFechas): Slot[];
  crearReserva(servicio, slot, contacto): Reserva;      // + cancelarReserva
  guardarLead(contacto, intencion): Lead;
  consultarPedido(orderId): EstadoPedido;               // absorbe get_order_status
  notificar(evento, payload): void;                     // ver sección D
}
```

- **Adapter `managed_db`**: cliente `pg` contra la connection string cifrada;
  las queries salen de plantillas por capability parametrizadas con
  `dbSchema` (mapeo de tablas/columnas). Nada de SQL libre generado por LLM.
  Reutiliza `generateSlots` (`booking/slots.ts`) para disponibilidad.
- **Adapter `external_api`**: HTTP + Bearer contra `apiBaseUrl` siguiendo un
  **contrato REST que definimos nosotros** (`GET /availability`,
  `POST /bookings`, `POST /leads`, `GET /orders/:id`). Si el cliente no tiene
  API, la creamos: una plantilla desplegable (repo semilla Express+Prisma que
  implementa ese contrato sobre su BD) — pieza a construir, hoy AUSENTE.
  `get_order_status` actual se convierte en el caso particular
  `consultarPedido` de este adapter (migración retrocompatible).

### B.4 Runtime: cómo accede el agente

1. `buildAgentTools` (`engine.ts:69`) añade tools `consultar_disponibilidad`,
   `crear_reserva`, `guardar_lead`, `consultar_pedido` **solo si** el agente
   tiene `AgentDataBackend` con esa capability habilitada (mismo patrón
   condicional que hoy usa ecommerce, `engine.ts:95-102`).
2. `executor.ts` añade los handlers → resuelven el adapter por `mode` →
   ejecutan. Idéntico para runtime openai y openclaw (B.2).
3. `buildSystemPrompt` añade guía de reserva REAL (sustituye la guía calendar
   de `engine.ts:180-189` cuando hay backend con booking).

### B.5 Selección OBLIGATORIA en creación

Nuevo paso del wizard (sustituye al paso Skills, ver A): **"Datos del
negocio"** — obligatorio, sin default silencioso:
- ¿Qué opera el agente? (reservas / leads / pedidos / solo información)
- Si opera algo: `managed_db` (aprovisionamos BD y pegamos directo) o
  `external_api` (URL + key; si no existe API, se marca "crear API" y queda
  en estado `pending_setup` visible en el panel).
- "Solo información" es elección explícita (`mode="none_yet"`), no omisión.
Validación en `blockedReason()` (`front/app/agents/new/page.tsx:143-150`) y
en el schema zod de `POST /api/agents` (`back/src/routes/agents.ts:37`).

### B.6 Qué hay que construir (resumen)

| Pieza | Estado |
|---|---|
| Executor server-side + tools condicionales | EXISTE (`executor.ts`, `engine.ts:69-108`) |
| Config per-agente con key cifrada (patrón) | EXISTE (`service.ts:407-438`) |
| Motor slots/reservas | EXISTE pero no cableado (`booking/*`, `routes/booking.ts`) |
| Modelo `AgentDataBackend` + migración | CREAR |
| Adapter `managed_db` (pg + plantillas SQL + mapeo) | CREAR |
| Adapter `external_api` (contrato REST) | CREAR (generalizando `order-status.ts`) |
| Plantilla de API desplegable para clientes sin API | CREAR |
| Tools + handlers (`crear_reserva`, `consultar_disponibilidad`, `guardar_lead`, `consultar_pedido`) | CREAR |
| Paso obligatorio del wizard + tab del panel | CREAR |

---

## C. Reestructura propuesta del panel

De 9 tabs (3 de dudoso valor) a 6 con jerarquía clara:

| # | Tab nueva | Contenido | Origen |
|---|---|---|---|
| 1 | **Chat** | Prueba del agente | Actual sin cambios |
| 2 | **Datos del negocio** (NUEVA) | Modo backend (BD/API/ninguno), capabilities, estado (`pending_setup`/activo), credenciales, horario de negocio y estado de pedidos (migrados desde `EcommerceConfigPanel`) | CREAR + mover |
| 3 | **Canales e integraciones** | ChannelConnectPanel + IntegrationsPanel + notificaciones al cliente (sección D) | Fusión de "integraciones" |
| 4 | **Conocimiento** | Igual + fuente "web inicial" con estado + re-ingesta | MODIFICAR |
| 5 | **Automatizaciones** | Lista + import de workflow (E.5) + **historial de ejecuciones embebido** (absorbe LogsPanel) | MODIFICAR |
| 6 | **Implementación** (renombra Deploy) | Checklist paso a paso POR CANAL: widget (snippet + verificación "¿instalado?" vía ping), api (curl + docs), telegram/whatsapp (estado real de conexión, no "próximamente"); apariencia del widget consolidada aquí | MODIFICAR |
| 7 | **Ajustes** | Modelo/effort con avisos honestos (sin efecto en openclaw; effort no aplica con tools) + nombre/prompt/temperatura | MODIFICAR |

Se eliminan: **Skills** (A), **Logs** (absorbido por 5), **Leads** (fold: si se
decide conservar visibilidad, contador/lista dentro de una futura "Actividad"
o en el dashboard, no tab propia).

---

## D. Notificación al cliente final (dueño del negocio)

### Estado actual (verificado)

- **Handoff → Slack**: si `ecommerceConfig.handoffSlackChannel` y Slack
  conectado, el executor manda resumen al canal (`executor.ts:95-107`).
  Único aviso per-agente que existe.
- **Lead nuevo → email**: `processNewLead` (`back/src/lib/notifications.ts:95-116`)
  crea `ProspectContact` y dispara webhook n8n `N8N_WEBHOOK_LEAD_URL`
  (env GLOBAL) con destinatario `resolveAdminEmail()` =
  `SystemConfig.adminEmail` o primer User admin (`notifications.ts:26-39`).
  **Esto notifica a LA AGENCIA, no al cliente del agente** — no hay nada
  per-tenant.
- **Telegram/WhatsApp salientes**: `back/src/lib/channels/telegram.ts` /
  `whatsapp.ts` saben enviar mensajes, pero solo se usan para RESPONDER al
  usuario final del chat (`telegram-webhook.ts:73,104`). Notificación
  proactiva al dueño: **AUSENTE**.
- Config de notificaciones por agente: **AUSENTE** (modelo `Agent`,
  `schema.prisma:133-166`, no tiene nada).

### Propuesta

Config per-agente `notificationConfig` (dentro de `AgentDataBackend` o campo
propio): lista de suscripciones `{ evento, canal, destino }` con
- eventos: `nuevo_lead`, `handoff`, `nueva_reserva`, `reserva_cancelada`
- canales: `telegram` (chat_id del dueño — reutiliza `sendMessage` de
  `channels/telegram.ts`), `whatsapp` (número — `channels/whatsapp.ts`),
  `email` (SMTP nuevo o vía webhook n8n como hoy pero parametrizado por
  agente, no global).
Punto de emisión único: el adapter (`notificar()` de B.3) + los hooks ya
existentes (`processNewLead`, handoff del executor) redirigidos a este
dispatcher. Best-effort como hoy (nunca romper el chat — patrón
`notifications.ts:13-14`).

---

## E. Decisiones abiertas (para el usuario, antes de implementar)

1. **Backend por defecto**: para clientes nuevos ¿aprovisionamos BD gestionada
   (`managed_db`, pegamos directo) o levantamos siempre la plantilla de API
   (`external_api`)? La BD directa es menos piezas; la API aísla y permite que
   el cliente la use para otras cosas. ¿O per-cliente según tamaño?
2. **Esquema de datos gestionado**: ¿esquema estándar único por vertical
   (reservas/leads/pedidos fijos, cero mapeo) o mapeo tabla/columna por
   cliente (`dbSchema`)? Estándar = mucho más simple; mapeo = sirve para BDs
   preexistentes.
3. **Skills**: ¿eliminación total (paso wizard + tab + modelos `Skill`/
   `AgentSkill` + marketplace `/skills`) o solo ocultar del wizard/panel
   conservando motor y datos? Ojo: hay páginas y scraping de marketplace ya
   construidos; eliminación total es una limpieza grande.
4. **Leads**: ¿quitamos la tab y dónde queda la visibilidad (dashboard,
   Actividad, nada)? Y aparte: ¿mantenemos el lead-flow que exige nombre antes
   de responder (`lead-flow.ts:57-91`) o se relaja?
5. **Automatizaciones**: propuesta = **importar workflow n8n** (pegar JSON o
   elegir workflow existente de la instancia por API — `n8n/client.ts` ya
   habla con ella) y mantener el NL actual solo como azúcar. ¿Confirmas
   import como camino principal? ¿La instancia n8n es nuestra (multi-tenant)
   o habría una por cliente?
6. **Adjuntos**: ¿guardamos el archivo original en Supabase Storage (bucket
   privado nuevo, p.ej. `kb-files/<agentId>/…`) además de los chunks, o
   seguimos solo-chunks? Guardarlo permite re-procesar/reindexar y auditar;
   coste: storage + GC al borrar fuente.
7. **Ajustes de modelo en agentes OpenClaw**: hoy el selector no tiene efecto
   (B/A tabla, `engine.ts:266`). ¿(a) ocultar el selector para runtime
   openclaw con aviso, o (b) propagar el modelo elegido a la config del
   agente en OpenClaw vía provision?
8. **reasoning_effort**: nunca se envía con tools (`openai.ts:87`). ¿Quitamos
   el selector de effort del panel de agente (dejándolo solo en /configuracion
   y estudios de mercado, donde SÍ aplica) o lo dejamos con aviso?
9. **Notificaciones**: ¿qué canal priorizamos para el dueño del negocio
   (Telegram parece el más barato de implementar — lib ya existe) y qué
   eventos son imprescindibles en v1?
10. **Implementación/entrega**: ¿el snippet del widget lo instala siempre la
    agencia (checklist interno) o se genera guía para que lo haga el cliente?
    ¿Añadimos verificación automática de instalación (ping desde widget.js)?

## F. Capa de extensibilidad — workflow-as-tool (v2, NO v1)

Objetivo del usuario: "metiendo workflows el agente hace más cosas". Requiere
distinguir dos modelos — solo el segundo da capacidad conversacional:

- **Workflow-como-automatización** (lo que existe): trigger n8n (schedule/webhook)
  → `POST /api/automations/:id/execute` → `runAgent(prompt)`. Corre en background,
  el LLM NO lo invoca. Sirve para tareas programadas, no para capacidades de chat.
- **Workflow-como-tool** (a construir): cada workflow importado se registra como
  una tool invocable por el LLM en la conversación. Es la generalización natural
  del contrato de backend (B.3): una **tercera fuente de tools** además de
  integraciones y capacidades fijas.

### Modelo propuesto (v2)
Nuevo `AgentWorkflowTool` (N:1 con Agent): `{ name, description, inputSchema (JSON
Schema), n8nWebhookUrl, authKeyEncrypted, tenantScopeTag }`.
1. `buildAgentTools` añade estas tools si el agente tiene workflow-tools activas
   (mismo patrón condicional que B.4).
2. `executor.ts` gana un handler genérico `invoke_workflow_tool` → HTTP POST al
   webhook n8n con el input validado contra `inputSchema` → devuelve el resultado
   al LLM. Idéntico para runtime openai y openclaw (B.2).
3. La descripción + inputSchema los define quien importa el workflow (o se derivan
   de los nodos de entrada del n8n). Sin descripción no hay tool: el LLM necesita
   saber cuándo/cómo llamarla.

### Caveats
- **Scoping de tenant obligatorio**: el webhook debe llevar un tag/credencial
  por tenant; deuda conocida (`OPERATOR_SERVICE_TOKEN` único opera cualquier
  negocio) que hay que resolver antes de exponer esto.
- Best-effort/timeout: una tool-workflow lenta o caída no debe colgar el chat.
- Es build independiente de v1; v1 entrega capacidades fijas, F es la palanca de
  crecimiento sin tocar código.

## Riesgos

- Migrar `get_order_status`/`ecommerceConfig` al nuevo contrato debe ser
  retrocompatible: hay agentes en prod con `orderStatusUrl` configurado.
- Quitar el paso Skills del wizard rompe `useWizardSkills`/`SkillsStep`/
  `ReviewStep` (muestran skillIds) — limpieza coordinada front+schema zod
  (`routes/agents.ts:37` acepta `skillIds`).
- `managed_db` introduce credenciales de BD per-agente: mismo cifrado que
  tokens OAuth, pero conviene usuario Postgres de mínimo privilegio por
  agente (no service-role).
- El paso obligatorio de backend alarga el wizard: prever "solo información"
  como salida rápida para no frenar demos.
