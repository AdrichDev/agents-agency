# Validation — aa-telegram-chatid-autocaptura

## User story

Como dueño del negocio, quiero vincular mi Telegram para recibir las notificaciones del
agente pulsando un botón y dándole a Start en el bot, sin tener que averiguar ni copiar mi
chat_id numérico a mano, para no equivocarme y no perder avisos.

## Acceptance criteria

- **AC1**: `POST /api/agents/:id/telegram/pairing-token` (gated por sesión) devuelve un
  enlace `https://t.me/<botUsername>?start=<token>` y guarda el token con expiry en
  `notificationConfig.telegramPairing`. Si el agente no tiene Telegram conectado → 400.
- **AC2**: Al pulsar Start en el bot (`/start <token>`), el webhook guarda `chat.id` en
  `notificationConfig.telegramChatId`, **invalida el token** (un solo uso) y confirma al
  usuario. No pasa el `/start` al LLM.
- **AC3**: `GET /api/agents/:id/telegram/pairing-status` refleja `{linked, chatId?}` y
  **no** devuelve el token de pairing.
- **AC4 (seguridad)**: token aleatorio criptográfico, TTL ~10 min, single-use, comparación
  de tiempo constante; nunca en logs; no expuesto por `/status`. Token inválido/expirado o
  reusado → no bindea.
- **AC5 (regresión cero)**: los mensajes normales de Telegram siguen yendo a
  `chatWithAgent`; `dispatchNotification` sigue leyendo `telegramChatId` sin cambios; el
  input manual de chat_id se conserva como alternativa.
- **AC6 (front)**: botón "Vincular mi Telegram" (deshabilitado si no hay bot conectado) →
  abre el enlace → detecta la vinculación por polling → muestra "✅ Vinculado".

## Given-When-Then

**Escenario 1 (AC1+AC2 — feliz):**
Given un agente con bot de Telegram conectado
When el dueño pulsa "Vincular mi Telegram" y luego Start en el bot
Then su chat_id queda guardado en `telegramChatId`, el token se invalida y el front
muestra "✅ Vinculado".

**Escenario 2 (AC4 — reuso):**
Given un token ya usado (pairing borrado)
When llega otro `/start <mismo token>`
Then NO se bindea nada.

**Escenario 3 (AC5 — regresión):**
Given un mensaje normal de un cliente al bot (sin `/start`)
When lo procesa el webhook
Then va a `chatWithAgent` como hoy (no se altera el flujo de conversación).

**Escenario 4 (AC1 — sin bot):**
Given un agente sin Telegram conectado
When se pide el pairing-token
Then responde 400 "Conecta primero el bot de Telegram".

## Test por tarea
- T1.1 → set/get/clear del pairing sin pisar otras claves.
- T2.1 → link+token / 400 sin conexión. T2.2 → status sin fugar token.
- T3.1 → válido bindea+borra+no-LLM; inválido/expirado/reuso no bindea; normal→chatWithAgent.
- T4.1 → `front tsc` verde; estados vinculado/no-conectado/manual.

Regla del repo: DONE solo con test verde; sin spec, revertido.
