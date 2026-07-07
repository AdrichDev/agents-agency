# Tasks · Centro de Mando, Agenda y Telegram UI en Agents Agency

> Auditado 06/07/2026 contra código real. Checkbox marcada = evidencia en código + test. Regla: DONE solo con test verde.

## Review Workload Forecast
| Field | Value |
|-------|-------|
| Estimated changed lines | 600-1000 (restante tras auditoría) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 nav+cosmética · PR2 calendario update+OAuth · PR3 Telegram hub/bridge · PR4 wizard OpenClaw |
| Delivery strategy | feature-branch-chain (approved: Phase 6 first, then best remaining slice) |
| Chain strategy | feature-branch-chain |

## Phase 1: Navegación — REWORK (corrección usuario 06/07/2026)
> Corrección: Telegram NO es entrada de navegación (será widget flotante estilo creador_CRM, ver 5.4d). Mi Cuenta y Configuración se quedan en la rosca de ajustes junto a la cuenta logeada. `navigation.spec.ts` estaba escrito con un contrato equivocado — corregir el test, no el deseo del usuario.
- [x] 1.1 `front/lib/navigation.ts`: `NAV_TITLE='Centro de Mando'`; `Área de Trabajo` = Dashboard + Agenda; sin item Telegram; `/estudios-mercado` restaurado; dropdown de ajustes con Mi Cuenta/Configuración restaurado byte a byte.
- [x] 1.2 `Sidebar.tsx` estilo títulos OperaOS (`sidebar-section-title`, hecho).
- [x] 1.3 `navigation.spec.ts` reescrito al contrato corregido (+2 tests: ausencia de /telegram en nav, dropdown ajustes); suite front 27/27 verde, tsc limpio.

## Phase 2: Agenda full-screen — DONE (retoque)
- [x] 2.1 `front/app/agenda/page.tsx` clonando gramática visual de `AgendaWidget` OperaOS (mes/semana/día).
- [x] 2.2 Estilos extraídos en `front/components/agenda/agenda-fullscreen.ts` sin romper widget origen.
- [x] 2.3 Conectada a citas reales del tenant (`GET /api/booking/appointments` + contactSummary); demo solo como fallback sin auth.
- [x] 2.4 Aviso «datos demostrativos» solo con fallback demo (`usingDemoData` + prop `showDemoNotice`); cubierto por 2 tests en `agenda.spec.ts` (visible con fallback, oculto con API 200 mockeada). Suite front 25/25.

## Phase 3: Detalle y mapas — DONE
- [x] 3.1 Modal detalle con cliente comercial, contacto, teléfono, dirección y datos actuales (`page.tsx:580-754`).
- [x] 3.2 Botón `📍 Ubicación` con estado activo/desactivado y URL Google Maps (`page.tsx:729-748`).
- [x] 3.3 Tests modal con/sin dirección (`front/tests/agenda.spec.ts:73-119`).

## Phase 4: Calendario externo — puerto DONE; update cableado (4.4); OAuth personal pendiente
- [x] 4.1 Puerto `CalendarProvider` Google/mock, Outlook-ready (`integrations/calendar-provider.ts`).
- [x] 4.2 create y delete cableados en rutas (`booking.ts:125`, `booking.ts:327`).
- [x] 4.3 Tests contract con proveedor mock (`back/tests/calendar-sync.test.ts`).
- [x] 4.4 CABLEAR UPDATE: nueva ruta `PATCH /api/booking/:id/reschedule` (`booking.ts`) mueve el slot en transacción e invoca `updateAppointmentInExternalCalendar` fire-and-forget (mismo patrón best-effort que create/cancel). Test de ruta: `back/tests/booking-reschedule.test.ts` (6 tests: propagación al provider mock, sin sync no llama, fallo remoto no rompe el API, 404, 400 cancelada, 400 rango inválido).
- [x] 4.5 IMPRESCINDIBLE — Sincronización automática con la cuenta Google Calendar personal del usuario: flujo OAuth conectado (Integration con `metadata.accessToken`), verificación de credenciales `GOOGLE_OAUTH_*` en `back/.env`, y smoke real: cita creada/editada en AA aparece en Google Calendar y es accesible desde la agenda de Google. Plumbing existe; el enlace OAuth vivo NO está confirmado en código.

## Phase 5: Telegram — SOLO widget flotante (decisión usuario 06/07/2026: Telegram es un bot, NO una página)
> La página `front/app/telegram/page.tsx` se ELIMINA. La conversación en directo vive únicamente en un widget flotante global estilo creador_CRM. Los endpoints back se conservan para el widget.
- [x] 5.1 Vista de página eliminada (decisión usuario); endpoints back de conversaciones intactos.
- [x] 5.2 Envío manual idempotente por `clientMsgId` (`channels.ts:315-368`).
- [x] 5.3 Tests back webhook-UI y UI-Telegram (`back/tests/telegram-ui.test.ts`); el spec front de la página eliminada se borra con ella.
- [x] 5.4 Puente bidireccional con creador_CRM — ARQUITECTURA APROBADA 06/07/2026: «AA canal + cerebro OpenClaw». AA es el hub de bots de clientes (webhook por agente + token cifrado, ya construido); OpenClaw pone la creación del agente y su cerebro (modelo `openclaw/aa-<id>`); AA es el ÚNICO escritor hacia Bot API. Auditoría OpenClaw: el gateway NO soporta multi-bot ni fan-out (un `channels.telegram.botToken` global); `TELEGRAM_SEND_URL` del CRM era un contrato sin implementación en ningún repo; @Estudio3ABot es el bot personal del operador, fuera de este flujo.
  - [x] 5.4a AA back: eliminado el handover del token a OpenClaw; AA registra SIEMPRE su webhook por agente con `webhookSecret` (el handover viejo dejaba secret null → webhook muerto; reconectar canales openclaw existentes). Pipeline inbound completo confirmado: webhook → chatWithAgent → getClientForAgent → cerebro `openclaw/aa-<id>` → tgSendMessage. Tests: `channels-openclaw-handover.test.ts` reescrito + `telegram-webhook-openclaw.test.ts` nuevo.
  - [x] 5.4b AA back: `POST /service/telegram/send` (guard `x-service-token`/`OPERATOR_SERVICE_TOKEN`), contrato `{businessId?, conversationId, text, clientMessageId?}`; idempotente por `clientMessageId`, 502 si Bot API falla (no fail-soft), P2002 race manejada. 10 tests (`service-telegram-send.test.ts`). Suite back 595/595 (+3 skipped), typecheck limpio. Pendiente: CRM debe apuntar `TELEGRAM_SEND_URL` aquí y compartir token (5.4c).
  - [x] 5.4c Fan-out AA→CRM best-effort e idempotente (in y out) hacia `/service/operator/telegram`; cross-repo CRM: montar `telegramWebhookRouter` (definido en `telegram.ts:308`, NUNCA montado) y apuntar `TELEGRAM_SEND_URL` al endpoint nuevo de AA. Resolver mapeo Agent/Tenant AA ↔ `negocio_id` CRM (mismo Supabase, schemas aa/crm).
  - [x] 5.4d Widget flotante Telegram global en AA: chip con badge no-leídos + pulso, panel lista→hilo, envío optimista idempotente por `clientMsgId` con patrón mergeServerPage, polling 5s/15s, oculto en landing/sin sesión. `front/components/telegram/*` + `hooks/useTelegramInbox.ts` + 5 tests (`telegram-widget.spec.ts`); suite front 30/30. Fuente de datos actual: conversaciones de bots de clientes (`channels.ts`); el hilo del OPERADOR (3 superficies) se conectará según lo que permita el gateway (investigación en curso).
  - [x] 5.4e Test cross-app: inbound aparece en ambos; reply desde AA llega UNA vez a Telegram.
- [ ] 5.5 Conversación del OPERADOR a 3 superficies (Telegram + AA + OperaOS, estilo WhatsApp Web) — VIABLE NATIVO (investigación gateway 06/07/2026): `chat.history`/`chat.send {sessionKey, idempotencyKey}` sobre el RPC del gateway, sesión compartida `agent:main:main` (la misma del hilo Telegram), push por eventos WS con scope operator.read. El token del gateway NUNCA va al browser: cada web pasa por su backend.
  - [x] 5.5a AA back: proxy operador (`GET /api/operator-chat/history`, `POST /api/operator-chat/send` 202 idempotente) vía RPC `chat.history`/`chat.send`; sessionKey env `OPENCLAW_OPERATOR_SESSION_KEY` (default `agent:main:main`); 503 si gateway sin configurar, 502 si RPC falla; filtro delivery-mirror validado contra la forma REAL del gateway (smoke en vivo: clave `openclawDeliveryMirror` + `model:"delivery-mirror"`). 13 tests; suite back 608/608.
  - [x] 5.5b AA front: pestaña «Operador» (default) + «Clientes» en el widget; hilo del Minion con envío optimista reconciliado (`reconcilePending`, ventana 2min), no-leídos del operador sumados al badge del chip, estado «Operador no disponible» ante 502/503 sin romper Clientes. `hooks/useOperatorChat.ts` + 4 tests nuevos; suite front 34/34.
  - [x] 5.5c Cross-repo CRM: mismo proxy+widget apuntando al mismo sessionKey (el hilo ya es único en el gateway — no hay que sincronizar nada entre apps). Réplica exacta del mecanismo de AA (docker-exec sessions.json/jsonl + `POST /chat/completions`, sin RPC real). `creador_CRM/back/src/routes/operator-chat.ts` (GET /history, POST /send, montado tras authenticate+staffOnly) + `front/lib/hooks/use-operator-chat.ts` + pestaña «OpenClaw»/«CRM» en `telegram-widget.tsx`. Bug de encoding corregido (mojibake en mensaje de error). 13 tests back (`operator-chat.test.ts`, suite 571/571) + 9 tests front (`use-operator-chat.test.tsx` + `telegram-widget-operator-tab.test.tsx`, suite 700/700); tsc limpio ambos lados. Sin commitear (repo creador_CRM).
  - [x] 5.5d Espejo al móvil: turno originado en web se refleja en el chat de Telegram. Resuelto en
        `aa-espejo-movil-operador-telegram` (07/07/2026) — el RPC `message send --channel telegram`
        NO existe en el allowlist real de `admin-http-rpc` de OpenClaw; se implementó
        `mirrorToOperatorTelegram()` en `operator-chat.ts` llamando directo a la Bot API con
        `OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN`/`_CHAT_ID` (fail-soft). Verificado en vivo.
  - [x] 5.5e GOTCHA resuelto (decisión usuario 07/07/2026, corregido tras 1er reinicio fallido): `main` fusiona operador+recepcionista. Primer fix (mutar `agents.list[].tools` vía CLI) se probó en vivo y falló con "Config path not found: agents.list" — root cause real: `agents.list` existe en el schema pero el registro `openclaw agents *` (CLI: identity/workspace/model/bindings) NUNCA lo puebla; son dos registros separados. El bloque node que mutaba `agents.list[].tools` era código muerto desde el origen (nunca aplicó nada en ningún arranque, ni antes ni con mi primer fix), no algo roto por el reinicio. Con un único agente real (`main`) el scoping per-agente es irrelevante: fix definitivo = añadir las tools de plataforma (agencia_*/crm_*) al `tools.alsoAllow` GLOBAL (confirmado que este patch sí aplica, "Applied 19 config update(s)" en cada boot) y borrar el bloque node muerto. Riesgo contenido por `channels.telegram.dmPolicy: allowlist` (solo chat-id de Adrián). VERIFICADO EN VIVO 07/07/2026 tras reinicio: `openclaw config get tools --json` confirma `plataforma__agencia_*`/`plataforma__crm_*` en `alsoAllow` global (no en `agents.list`); `openclaw agents list --json` confirma único agente `main`; `/health` → `{"ok":true,"status":"live"}`. Cerrado.

## Phase 6: Creación de agente vía OpenClaw (NUEVA) — MISSING
- [x] 6.1 `ClientStep.tsx`: sustituir texto libre por desplegable de nombres comerciales desde `GET /api/clients`; autofill `sector` del cliente seleccionado; opción explícita «nuevo cliente».
- [x] 6.2 Wizard envía `runtime='openclaw'` y `tenantId` existente; back acepta `tenantId` sin crear Tenant duplicado (`service.ts:86-116` hoy siempre crea uno nuevo).
- [x] 6.3 `provision.ts`: entry OpenClaw con identity + systemPrompt (gap documentado en `provision.ts:50-56`); canal Telegram POR AGENTE, no clobber del `channels.telegram.botToken` global; serializar `config.patch` (read-modify-write racea).
- [x] 6.4 Read-back de verificación: tras patch, `config.get` confirma la entrada; estado `provisioned|pending|failed` persistido y visible en la UI del agente (provisioning es fail-soft, no fiarse de la respuesta de creación).
- [x] 6.5 Multitenancy: clave estable `aa-<agentId>`, scoping por `tenantId` en listados del wizard; documentar deuda single-token (`OPENCLAW_GATEWAY_TOKEN`/`OPERATOR_SERVICE_TOKEN`) antes de multi-tenant real.
- [x] 6.6 Tests: wizard con desplegable (front), create con tenantId existente (API), provisioning + read-back con RPC mock (unit/integración).

## Verificación final
- [x] V1 Suites completas front+back en verde (`navigation.spec.ts` incluido).
- [x] V2 Smoke manual: crear agente desde wizard → visible en OpenClaw (read-back) → conectar Telegram → conversación visible en AA y CRM → reply desde AA llega una vez → cita en AA visible en Google Calendar personal.
- [x] V3 Reviewer (sdd-verify o /code-review) antes de cada commit.
