# Tasks — telegram-whatsapp-bots

Orden: back schema → back seguridad → back lógica → back rutas → front UI → tests.

## 1. Esquema de datos (back)

- [x] 1.1 Añadir modelo `ChannelConnection` en `back/prisma/schema.prisma`
      (`id cuid`, `agentId`, `provider` (telegram|whatsapp), `credentials Json`,
      `status` (pending|active|error), `webhookSecret String?`,
      `@@unique([agentId, provider])`, relación con `Agent`).
- [x] 1.2 Añadir relación inversa `channelConnections ChannelConnection[]` en `Agent`.
- [x] 1.3 Crear `back/prisma/migrate-channel-connection.sql` (CREATE TABLE + unique index).
- [x] 1.4 Aplicar con `prisma db push` y regenerar cliente Prisma.

## 2. Cifrado de credenciales (back)

- [x] 2.1 Crear `back/src/lib/crypto.ts`: `encrypt(plain)` / `decrypt(payload)`
      con AES-256-GCM, clave desde `CHANNEL_ENCRYPTION_KEY` (32 bytes).
- [x] 2.2 Documentar `CHANNEL_ENCRYPTION_KEY` en `back/.env.example`.
- [x] 2.3 Test unitario: round-trip encrypt→decrypt y fallo con clave inválida.

## 3. Cliente Telegram (back)

- [x] 3.1 Crear `back/src/lib/channels/telegram.ts`: `validateToken(token)` (getMe),
      `registerWebhook(token, url, secret)` (setWebhook), `sendMessage(token, chatId, text)`.
- [x] 3.2 Función `handleTelegramUpdate(agentId, update)`: extrae chatId+texto,
      llama `chatWithAgent`, responde por `sendMessage`. Dedup por `update.message.message_id`.
      (Implementado directamente en routes/channels.ts por AD3)

## 4. Cliente WhatsApp (back)

- [x] 4.1 Crear `back/src/lib/channels/whatsapp.ts`: `verifyWebhook(query, verifyToken)`
      (hub.challenge), `sendMessage(phoneNumberId, accessToken, to, text)` (Graph API).
- [x] 4.2 Función `handleWhatsappEvent(agentId, payload)`: parsea mensaje entrante,
      llama `chatWithAgent`, responde por Graph API. Dedup por message id.
      (Implementado directamente en routes/channels.ts por AD3)

## 5. Rutas Express (back)

- [x] 5.1 `POST /api/channels/:provider/connect` — valida credenciales, cifra,
      hace upsert en `ChannelConnection`, registra webhook (Telegram).
- [x] 5.2 `GET /api/channels/:agentId/status` — estado de conexiones (sin exponer credenciales).
- [x] 5.3 `DELETE /api/channels/:provider/:agentId` — desconectar (deleteWebhook + borrar fila).
- [x] 5.4 `POST /api/channels/telegram/:agentId` — receptor de updates (valida webhookSecret).
- [x] 5.5 `GET /api/channels/whatsapp/:agentId` — verificación de webhook Meta.
- [x] 5.6 `POST /api/channels/whatsapp/:agentId` — receptor de eventos.

## 6. Frontend (front)

- [x] 6.1 Componente `front/components/ChannelConnectPanel.tsx`: formulario Telegram
      (token) y WhatsApp (phoneNumberId, accessToken, verifyToken), estado y desconectar.
- [x] 6.2 Integrar el panel en la pestaña Integraciones de `app/agents/[id]/page.tsx`.
- [x] 6.3 Helpers de `lib/api` para conectar/estado/desconectar.
      (Usa el helper `api()` existente directamente en el componente; no se añadió wrapper separado
      para mantener el componente autocontenido, compatible con el patrón del repo)

## 7. Tests

- [x] 7.1 Vitest back: `validateToken`, parseo de update Telegram, dedup, cifrado.
- [x] 7.2 Vitest back: `verifyWebhook` WhatsApp y parseo de payload.
- [ ] 7.3 Playwright front: render del panel y flujo de conexión (mock).
      (Pendiente — fuera del alcance de este apply; el build de front pasa limpio)
- [x] 7.4 `cd back && npm test` (51/51) y `cd front && npm run build` en verde.
