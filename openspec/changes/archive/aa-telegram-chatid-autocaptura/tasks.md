# Tasks — aa-telegram-chatid-autocaptura

Tests **vitest** (back) + front `tsc`. SIN migración (token en JSON notificationConfig).
DONE solo con verde.

## F1 — Almacén del token (JSON)

- [x] **T1.1 — Helpers de pairing.** `notificationConfig.telegramPairing = {token,expiresAt}`
  escrito por merge superficial (patrón `agents.ts:249-257`). Token
  `crypto.randomBytes(32).toString("base64url")`, TTL ~10 min. Helper para set/get/clear
  del pairing y para set del `telegramChatId`. Nunca loguear el token.
  - Test: set guarda token+expiry sin pisar telegramChatId/events; clear lo borra.

## F2 — Rutas (agentsRouter, gate sesión)

- [x] **T2.1 — POST /api/agents/:id/telegram/pairing-token.** Lee ChannelConnection
  telegram (botUsername); 400 si no conectado. Genera token+expiry, merge en config,
  devuelve `{link:"https://t.me/<botUsername>?start=<token>", expiresAt}`.
  - Test: conectado → link con botUsername + token guardado; sin conexión → 400.
- [x] **T2.2 — GET /api/agents/:id/telegram/pairing-status.** `{linked, chatId?}`; NO
  devuelve el token de pairing.
  - Test: refleja linked/chatId; no fuga el token.

## F3 — Webhook /start <token>

- [x] **T3.1 — Intercept en telegram-webhook.ts** antes de `chatWithAgent`: si
  `text.startsWith("/start ")` → validar token (match tiempo-constante + no expirado +
  existe), guardar `telegramChatId=String(chat.id)`, **borrar** telegramPairing, responder
  "✅ Listo…". Token inválido/expirado → mensaje neutro, no bindea. `/start` pelado o
  mensaje normal → flujo actual.
  - Test: token válido → bindea + borra + no llama chatWithAgent; inválido/expirado → no
    bindea; **reuso** (borrado) → no bindea; mensaje normal → sí chatWithAgent (regresión).
  - Test security: comparación tiempo-constante; token no en logs.

## F4 — Front pairing UI

- [x] **T4.1 — NotificationConfigPanel.** Botón "Vincular mi Telegram" (deshabilitado +
  nota si no hay bot conectado) → POST pairing-token → abre link → polling pairing-status
  (~2s, timeout ~2min) → "✅ Vinculado (chat …NNNN)". Fallback desplegable "¿Prefieres
  pegarlo a mano?" conserva el input manual actual.
  - Test: `front tsc` verde; render vinculado / no-conectado / manual.

## Verificaciones finales

- [x] **T5.1 — Typecheck + suite** (`back` vitest + tsc, `front` tsc) verde. — verificado: Engram #970 (suite back 994 passed, 3 skipped; `tsc --noEmit` limpio en back y front)
- [x] **T5.2 — sec-review:** token aleatorio/TTL/single-use/tiempo-constante; no en logs;
  no expuesto por status; endpoint de generación gated por sesión; binding por token. — verificado: Engram #970, informe de revisión de seguridad PASS con 0 hallazgos críticos (TTL, uso único, comparación en tiempo constante, no registrado en logs, protegido por sesión, no expuesto por el endpoint de estado), todo con fichero y línea
- [ ] **T5.3 — Verificación visual (HITL):** vincular un Telegram real y recibir una
  notificación de prueba en ese chat. — ⏳ GATE HUMANO: vincular un Telegram real y recibir la notificación de prueba
- [x] **T5.4 — Engram:** persistir (pairing por deep-link, token en JSON sin migración). — verificado: Engram #969 y #971 persisten el emparejamiento por deep-link con token en JSON, sin migración

## Notas
- SIN migración: token efímero en `notificationConfig.telegramPairing`.
- `dispatchNotification` no cambia (sigue leyendo `telegramChatId`).
- Regresión cero en el flujo normal de mensajes Telegram.

## Cierre — 28/07/2026

Cierre con una única acción humana pendiente (T5.3, vincular un Telegram real). La revisión de seguridad del token de emparejamiento pasó sin hallazgos críticos.
