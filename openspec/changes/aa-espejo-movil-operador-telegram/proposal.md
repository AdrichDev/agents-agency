# Proposal: espejo móvil del chat operador (aa-espejo-movil-operador-telegram)

**Nivel Gru: 1 — Pequeño.** Extraído de la task 5.5d de
`aa-centro-mando-agenda-telegram` (bloqueada por outage externo de Gemini durante su
verificación en vivo, 07/07/2026); se documenta aquí como spec propia para no perder el
contexto ni el criterio de aceptación.

## Contexto

`aa-centro-mando-agenda-telegram` implementó (5.5a/b) un proxy AA back↔front que expone la
conversación del operador OpenClaw (`agent:main:main`, la misma sesión que Telegram) vía
`chat.history`/`chat.send` (`agents-agency/back/src/routes/operator-chat.ts`,
`lib/openclaw/admin-rpc.ts`). `chatSend` llama a `POST {base}/v1/chat/completions` con
`x-openclaw-session-key: agent:main:main`, la MISMA sessionKey que usa el hilo de Telegram.

Pendiente sin confirmar (5.5d): si un turno originado desde la web del operador (AA) se refleja
también en el chat de Telegram del móvil, o si `chat.completions` solo actualiza la sesión sin
disparar entrega activa al canal Telegram (en cuyo caso el móvil se queda sin ver nada hasta
que el usuario abre Telegram y el gateway hace catch-up, si es que lo hace).

Intento de verificación en vivo (07/07/2026): request de prueba a `/v1/chat/completions` con la
sessionKey del operador devolvió 503 sostenido — outage real de Google Gemini
(`gemini-3-flash-preview`, "high demand"), no relacionado con este código. No se pudo confirmar
el comportamiento con el proveedor caído; cambiar de modelo a Ollama vía API no es posible
(`model` en el endpoint solo acepta `openclaw`/`openclaw/<agentId>`, la selección real de
modelo es config de servidor, no de request) — un cambio de config del gateway para forzar
Ollama fue explícitamente descartado por ser fuera de alcance de esta verificación.

## Intención

Confirmar (y si hace falta, implementar) que un mensaje enviado desde la web del operador (AA)
llega también al chat de Telegram del móvil, sin depender de que el móvil abra la app primero.

## Alcance

- Reproducir con el proveedor de modelo disponible (Gemini recuperado, o fallback Ollama vía
  config si el usuario lo aprueba explícitamente).
- Si `chat.completions` NO dispara entrega activa a Telegram: evaluar usar el comando
  `message send --channel telegram` (mencionado en el propio texto de la task 5.5d original)
  tras cada `chatSend` exitoso en `operator-chat.ts`, para forzar el espejo.
- Actualizar `agents-agency/openspec/changes/aa-centro-mando-agenda-telegram/tasks.md`
  marcando el checkbox de 5.5d cuando quede verificado (sin reescribir el texto de la task).

## Fuera de alcance

- Cambios al modelo de IA configurado por defecto en el gateway.
- 5.4 (puente CRM bidireccional) y 4.5 (OAuth Google Calendar) — changes/tasks separados.

## Open questions

- ¿El gateway OpenClaw ya hace catch-up automático de mensajes al abrir Telegram, o el mensaje
  se pierde si el móvil no estaba mirando en el momento?
