# Design — aa-telegram-chatid-autocaptura

SIN migración. El token vive en JSON `notificationConfig`. `botUsername` solo-lectura.

## §A. Flujo completo (deep-link pairing)

```
1. Dueño (front, sesión) pulsa "Vincular mi Telegram"
       → POST /api/agents/:id/telegram/pairing-token
       → back genera token, guarda notificationConfig.telegramPairing={token,expiresAt}
       → devuelve link t.me/<botUsername>?start=<token>
2. Front abre el link → Telegram → dueño pulsa START
       → Telegram manda "/start <token>" al webhook POST /api/channels/telegram/:agentId
3. Webhook: text.startsWith("/start ") → valida token del agente
       → guarda notificationConfig.telegramChatId = chat.id ; invalida token
       → responde al dueño "✅ Listo…"
4. Front hace polling GET /api/agents/:id/telegram/pairing-status → linked:true, chatId
       → muestra "✅ Vinculado (chat 12345…)"
```

## §B. F1 — Almacén del token (JSON, sin migración)

`AgentDataBackend.notificationConfig` gana clave transitoria:
```ts
notificationConfig.telegramPairing = {
  token: string,        // random 32+ bytes base64url
  expiresAt: string,    // ISO, now + ~10 min
}
```
- Se escribe con el merge superficial existente (`agents.ts:249-257`) — no pisa
  `telegramChatId`/`events`.
- Al bindear con éxito (F3), se **borra** `telegramPairing` (single-use).
- Generación del token: `crypto.randomBytes(32).toString("base64url")`. Nunca se loguea.

## §C. F2 — Rutas (agentsRouter, gate sesión)

Patrón `asyncHandler`+`validate` como `agents.ts:223`.

**POST `/api/agents/:id/telegram/pairing-token`**
1. Cargar el agente + su `ChannelConnection {agentId, provider:"telegram"}`; leer
   `botUsername`. Si no hay conexión/`botUsername` → 400 "Conecta primero el bot de
   Telegram". (Si `botUsername` faltara pero hay token, opcional `validateToken` para
   recuperarlo — reusar `telegram.ts:39`.)
2. Generar token + expiry; merge en `notificationConfig.telegramPairing`.
3. Responder `{ link: "https://t.me/${botUsername}?start=${token}", expiresAt }`.
   (El token viaja SOLO en el link al dueño autenticado; no se expone en otro sitio.)

**GET `/api/agents/:id/telegram/pairing-status`**
- Responder `{ linked: Boolean(telegramChatId), chatId?: telegramChatId }`. No devolver el
  token de pairing.

## §D. F3 — Webhook maneja `/start <token>`

En `telegram-webhook.ts`, tras parsear (`parsed = { chatId, text }`) y ANTES de
`chatWithAgent` (`:70`):

```ts
if (parsed.text?.startsWith("/start ")) {
  const token = parsed.text.slice("/start ".length).trim();
  const pairing = agentDataBackend.notificationConfig?.telegramPairing;
  const valid = pairing
    && typeof token === "string" && token.length > 0
    && timingSafeEqualStr(token, pairing.token)
    && new Date(pairing.expiresAt).getTime() > Date.now();
  if (valid) {
    // merge: set telegramChatId = String(parsed.chatId), delete telegramPairing
    await saveOwnerChatId(agentId, String(parsed.chatId));
    await tgSendMessage(token_bot, parsed.chatId,
      "✅ Listo. Aquí recibirás las notificaciones del negocio.");
    return res.sendStatus(200);
  }
  // token inválido/expirado → mensaje neutro, no filtrar por qué
  await tgSendMessage(..., parsed.chatId, "Este enlace de vinculación no es válido o expiró.");
  return res.sendStatus(200);
}
// …flujo normal → chatWithAgent
```
- `timingSafeEqualStr`: comparación de tiempo constante (longitudes iguales → `crypto.timingSafeEqual`; distinta longitud → false sin filtrar).
- Un `/start` **sin** token o con token inválido: NO bindea; el `/start` pelado mantiene el
  comportamiento actual (saludo). No cambiar la semántica del `/start` sin payload.
- El binding NO exige sesión: el token es la prueba de autorización (análogo a
  `webhookSecret`).

## §E. F4 — Front pairing UI (`NotificationConfigPanel`)

- Botón primario **"Vincular mi Telegram"**:
  - Si el agente no tiene Telegram conectado → deshabilitado + nota "Conecta primero el bot
    de Telegram en la pestaña Canales".
  - Al pulsar → `POST pairing-token` → `window.open(link)` (o mostrar el link/QR) →
    arrancar polling `GET pairing-status` cada ~2s hasta `linked:true` o timeout (~2 min).
  - `linked:true` → mostrar "✅ Vinculado — recibirás las notificaciones en este Telegram
    (chat `…${chatId.slice(-4)}`)". Estado persistente.
- **Fallback avanzado**: un desplegable "¿Prefieres pegarlo a mano?" que conserva el input
  `telegramChatId` actual (no romper el camino manual).
- Copy español llano; sin jerga.

## §F. Tests (vitest back + front tsc)

- **F2**: `POST pairing-token` con Telegram conectado → link con `botUsername` + expiry +
  token guardado en `notificationConfig.telegramPairing`; sin conexión → 400. `GET
  pairing-status` refleja `linked`/`chatId` y NO devuelve el token.
- **F3**: webhook `/start <token válido>` → guarda `telegramChatId=chat.id`, borra
  `telegramPairing`, responde OK, NO llama `chatWithAgent`. Token inválido/expirado → NO
  bindea. Token **reusado** (ya borrado) → NO bindea (single-use). Mensaje normal (sin
  `/start`) → sí llama `chatWithAgent` (regresión).
- **F3 security**: comparación constante; token no aparece en logs.
- **F4**: `front tsc` verde; render del estado vinculado/no-conectado.

Regla del repo: DONE solo con test verde.
