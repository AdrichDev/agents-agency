# Proposal — aa-telegram-chatid-autocaptura

Hijo H4 del plan maestro `aa-agentes-rediseno-operativo` (P1).

## Intent

Hoy el dueño tiene que averiguar su chat_id numérico de Telegram (vía `@userinfobot`) y
pegarlo a mano en un input (`NotificationConfigPanel.tsx:63`). Es fricción y fuente de
error. Sustituirlo por el patrón estándar: **deep-link `t.me/<bot>?start=<token>`** — el
dueño pulsa "Vincular mi Telegram", abre el bot, pulsa Start, y el sistema captura su
chat_id automáticamente y lo guarda como destino de notificaciones.

## Descubrimiento (auditoría, `file:line`) — casi todo reutilizable

- El webhook YA distingue el agente del update sin ambigüedad: `agentId` en la ruta
  `POST /api/channels/telegram/:agentId` (`telegram-webhook.ts:20-21`).
- `/start <payload>` NO se maneja hoy (el texto va entero al LLM) — punto de inserción
  limpio antes de `chatWithAgent` (`telegram-webhook.ts:56/70`). `chat.id` disponible en
  el parser (`telegram.ts:112`).
- `ChannelConnection.botUsername` YA persistido (`schema.prisma:569`), rellenado al
  conectar (`channels.ts:110`), ya expuesto por `/status` y mostrado en el front
  (`ChannelConnectPanel.tsx:248`) → se construye el `t.me/<botUsername>?start=<token>`.
- Destino final: `AgentDataBackend.notificationConfig.telegramChatId` — el MISMO campo que
  hoy se teclea, consumido por `dispatchNotification` (`notify-dispatcher.ts:123`). El
  merge superficial de `agents.ts:252` permite escribir solo esa clave.
- NO existe flujo de pairing/token temporal → a construir.

## Scope (SIN migración)

- **F1 Almacén del token de pairing (JSON, sin migración):** guardar el token temporal en
  `AgentDataBackend.notificationConfig.telegramPairing = { token, expiresAt }` (merge
  soportado). TTL corto (~10 min), un solo uso. **Decisión: JSON en vez de tabla nueva**
  para NO requerir migración a prod (token efímero, no necesita relación de primer nivel).
- **F2 Rutas (bajo `agentsRouter`, gate de sesión del tenant):**
  - `POST /api/agents/:id/telegram/pairing-token` → genera token aleatorio, lo guarda con
    expiry, devuelve `{ link: "https://t.me/<botUsername>?start=<token>", expiresAt }`.
    400 si el agente no tiene Telegram conectado (sin `botUsername`).
  - `GET /api/agents/:id/telegram/pairing-status` → `{ linked: boolean, chatId? }` para que
    el front sepa cuándo se completó.
- **F3 Webhook maneja `/start <token>`:** en `telegram-webhook.ts`, antes de `chatWithAgent`,
  si `text` empieza por `/start ` → extraer token, validar contra el pairing del agente
  (match + no expirado + no usado, comparación constante), guardar `parsed.chatId` en
  `notificationConfig.telegramChatId`, invalidar el token, y responder al usuario "✅ Listo,
  aquí recibirás las notificaciones del negocio". No pasar al LLM.
- **F4 Front pairing UI (`NotificationConfigPanel`):** botón "Vincular mi Telegram" → llama
  al endpoint → abre el enlace `t.me` → hace polling de `pairing-status` → muestra "✅
  Vinculado" con el chat_id capturado (solo lectura). Mantener el input manual como
  alternativa avanzada ("¿Prefieres pegarlo a mano?"). Si el bot no está conectado, avisar
  "Conecta primero el bot de Telegram".

## Security (flujo sensible — decide quién recibe las notificaciones del dueño)

- Token: aleatorio criptográfico, TTL ~10 min, **un solo uso**, comparación de tiempo
  constante. Nunca en logs, nunca expuesto por `/status`.
- El endpoint de generación va detrás del gate de sesión (solo el dueño autenticado lo
  crea). El binding por webhook exige el token válido (es la prueba de autorización,
  análogo a `webhookSecret`).

## Fuera de scope
- `/start` sin token → comportamiento actual (saludo/LLM), no se toca su semántica salvo
  el intercept del token.
- Multi-owner / varios chat_id → un único destino, como hoy.

## Dependencies
- `back/src/lib/channels/telegram-webhook.ts`, `telegram.ts` (parser + sendMessage),
  `back/src/routes/agents.ts` (rutas + merge notificationConfig), `schema.prisma`
  (ChannelConnection.botUsername, solo lectura), `notify-dispatcher.ts` (consumo, sin
  cambio), `front/components/agents/NotificationConfigPanel.tsx`.
