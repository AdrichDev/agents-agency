# Proposal — telegram-whatsapp-bots

Canal objetivo: **telegram / whatsapp**

## Intención

Hoy un agente puede tener `channel = "telegram"` o `"whatsapp"`, pero esos
valores son solo etiquetas: no existe ningún despliegue real. El cliente no
puede convertir su agente en un bot que reciba y responda mensajes.

Esta fase permite **desplegar agentes como bots reales**:

- **Telegram**: el cliente pega el token de @BotFather en la pestaña
  Integraciones del agente. El backend valida el token (`getMe`), registra el
  webhook (`setWebhook`) apuntando a `POST /api/channels/telegram/:agentId`, y
  enruta cada mensaje entrante por el mismo motor de chat ya existente
  (`chatWithAgent`, el que usa `POST /api/chat`). La respuesta sale por
  `sendMessage`.
- **WhatsApp**: el cliente rellena un formulario con credenciales de **Meta
  Cloud API** (phone number ID, access token, verify token). El backend expone
  un `GET` de verificación de webhook (hub challenge) y un `POST` receptor;
  responde por la Graph API `/{phoneNumberId}/messages`.

Éxito = un cliente conecta su bot de Telegram/WhatsApp sin tocar código y, al
escribirle desde la app de mensajería, el agente responde con su prompt,
skills y conocimiento ya configurados.

## Alcance (in-scope)

- Modelo Prisma **`ChannelConnection`** (`agentId`, `provider`,
  `credentials Json` cifrado, `status`, `webhookSecret`, `@@unique([agentId, provider])`).
  Nota: ya existe `Integration` con `@@unique([agentId, provider])` (schema línea 111)
  para OAuth; se crea un modelo **separado** para canales de mensajería y no se
  reutiliza `Integration` para no mezclar responsabilidades.
- **Cifrado de credenciales en reposo**: AES-256-GCM con clave en
  `CHANNEL_ENCRYPTION_KEY` (env). Utilidad `crypto.ts` reutilizable por otras fases.
- Backend Telegram: validar token (`getMe`), `setWebhook`, endpoint receptor,
  envío vía `sendMessage`.
- Backend WhatsApp: verificación `GET` del webhook, `POST` receptor, envío vía
  Graph API.
- Reutilización del pipeline de chat existente (`chatWithAgent`): los mensajes
  entrantes crean/continúan `Conversation` con el `channel` correspondiente.
- UI en pestaña Integraciones: conectar/desconectar bot, mostrar `status`,
  instrucciones de configuración del webhook.

## Fuera de alcance (out-of-scope)

- Alta automática de número de WhatsApp.
- Verificación de negocio en Meta (Business Verification).
- Mensajes con multimedia/plantillas de WhatsApp (solo texto en esta fase).
- Otros canales (Instagram, Messenger): pertenecen a fases posteriores.

## Enfoque

1. **Datos**: nuevo modelo `ChannelConnection`; SQL manual en
   `back/prisma/migrate-channel-connection.sql` (convención del repo).
2. **Seguridad**: capa de cifrado AES-256-GCM antes de persistir credenciales;
   descifrado solo en memoria al usar.
3. **Telegram**: módulo `back/src/lib/channels/telegram.ts` (validar, registrar
   webhook, enviar) + rutas en `index.ts`.
4. **WhatsApp**: módulo `back/src/lib/channels/whatsapp.ts` + rutas de
   verificación y recepción.
5. **Pipeline**: adaptador que normaliza el mensaje entrante de cada proveedor
   y delega en `chatWithAgent`, devolviendo la respuesta al canal de origen.
6. **Frontend**: panel de canal en la pestaña Integraciones del agente.

## Riesgos / preguntas abiertas

- **Webhook público**: Telegram/WhatsApp exigen URL HTTPS accesible. En local
  hace falta túnel (ngrok/cloudflared). Documentar requisito; no resolver
  hosting aquí.
- **Idempotencia**: los proveedores reintentan webhooks; hay que deduplicar por
  message id para no responder dos veces.
- **Verify token WhatsApp**: debe coincidir exactamente con el configurado en
  Meta; un fallo deja el webhook sin verificar.
- **Clave de cifrado**: rotación de `CHANNEL_ENCRYPTION_KEY` invalida
  credenciales existentes; documentar plan de rotación/rollback.
- **Rollback de schema**: la migración solo añade tabla nueva (no destructiva);
  rollback = `DROP TABLE ChannelConnection`.
- **Decisión a confirmar**: ¿bot por agente (1:1) o varios agentes por bot? Se
  asume 1 bot ↔ 1 agente por proveedor (de ahí el `@@unique`).
