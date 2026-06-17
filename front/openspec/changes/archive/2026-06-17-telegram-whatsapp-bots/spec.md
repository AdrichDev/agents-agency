# Spec — telegram-whatsapp-bots

Canal objetivo: **telegram / whatsapp**
Fecha: 2026-06-12
Estado: spec-ready

---

## Convenciones de este documento

- Las palabras **MUST**, **SHALL**, **SHOULD**, **MAY** siguen RFC 2119.
- Los nombres de modelos Prisma se escriben en `CamelCase`.
- Los escenarios usan formato GIVEN / WHEN / THEN.

---

## Modelo de datos

### R0 — Modelo `ChannelConnection`

El sistema MUST contar con un modelo `ChannelConnection` separado del modelo `Integration` (que gestiona OAuth).

Campos requeridos:

| Campo | Tipo | Restricción |
|---|---|---|
| `id` | String | `@id @default(cuid())` |
| `agentId` | String | FK → `Agent.id`, `onDelete: Cascade` |
| `provider` | String | valores permitidos: `telegram` \| `whatsapp` |
| `credentials` | Json | cifrado AES-256-GCM antes de persistir |
| `status` | String | `pending` \| `active` \| `error` |
| `webhookSecret` | String? | token secreto para validar llamadas entrantes |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |

Restricción de unicidad: `@@unique([agentId, provider])` — un agente MUST tener a lo sumo un bot activo por proveedor.

El modelo `Agent` MUST exponer la relación inversa `channelConnections ChannelConnection[]`.

El cascade `onDelete: Cascade` MUST garantizar que al eliminar un `Agent` se eliminen automáticamente sus `ChannelConnection`.

**Escenario R0-1 — Unicidad por agente+proveedor**

```
GIVEN un Agent con id=A1 que ya tiene un ChannelConnection de provider=telegram
WHEN se intenta crear otro ChannelConnection con agentId=A1 y provider=telegram
THEN la base de datos rechaza la operación con error de restricción unique
 AND el endpoint devuelve HTTP 409
```

**Escenario R0-2 — Cascade al eliminar agente**

```
GIVEN un Agent con id=A1 que tiene ChannelConnection activos (telegram y whatsapp)
WHEN se elimina el Agent A1
THEN los ChannelConnection asociados son eliminados en cascada
 AND los webhooks correspondientes son revocados antes del borrado (Telegram: deleteWebhook; WhatsApp: no requiere llamada externa)
```

---

## R1 — Conexión Telegram

El sistema MUST permitir asociar un token de bot de Telegram (generado por @BotFather) a un agente y registrar un webhook activo.

**Variables de entorno requeridas:**
- `CHANNEL_ENCRYPTION_KEY` — clave AES-256 (32 bytes), requerida en arranque.
- `PUBLIC_URL` — URL HTTPS pública del backend (p. ej. `https://api.ejemplo.com`). Sin esta variable el sistema SHOULD mostrar advertencia en la UI y MUST devolver error explicativo al intentar conectar.

**Escenario R1-1 — Conexión exitosa**

```
GIVEN un agente con channel=telegram
  AND un token BotFather válido
  AND la variable PUBLIC_URL configurada con URL HTTPS
WHEN el cliente llama POST /api/channels/telegram/connect con { agentId, token }
THEN el backend llama GET https://api.telegram.org/bot{token}/getMe
 AND getMe devuelve 200 con datos del bot
 AND el backend genera un webhookSecret aleatorio (≥ 32 bytes hex)
 AND el backend llama setWebhook apuntando a {PUBLIC_URL}/api/channels/telegram/{agentId}
       con secret_token={webhookSecret}
 AND se hace upsert de ChannelConnection con status=active, credentials cifradas, webhookSecret almacenado
 AND el endpoint devuelve HTTP 200 con { status: "active", botName, botUsername }
   (las credenciales NO deben estar presentes en la respuesta; solo botName y botUsername del getMe)
```

**Escenario R1-2 — Token inválido**

```
GIVEN un token que no corresponde a ningún bot en Telegram
WHEN el cliente llama POST /api/channels/telegram/connect con ese token
THEN el backend llama getMe y recibe respuesta de error de Telegram
 AND se hace upsert de ChannelConnection con status=error
 AND el endpoint devuelve HTTP 422 con { error: "Token de Telegram inválido" }
```

**Escenario R1-3 — PUBLIC_URL no configurada**

```
GIVEN que la variable PUBLIC_URL no está definida en el entorno del backend
WHEN el cliente llama POST /api/channels/telegram/connect
THEN el backend NO intenta llamar a la API de Telegram
 AND devuelve HTTP 503 con { error: "PUBLIC_URL no configurada; el backend no es accesible públicamente" }
```

**Escenario R1-4 — Webhook ya registrado (reconexión)**

```
GIVEN un ChannelConnection existente con status=error para el mismo agentId+provider
WHEN el cliente llama POST /api/channels/telegram/connect con un token válido
THEN el sistema sobreescribe el registro existente (upsert) sin crear duplicado
 AND registra el webhook nuevo con el mismo endpoint
 AND actualiza status=active
```

**Escenario R1-5 — Desconexión**

```
GIVEN un ChannelConnection con status=active para provider=telegram
WHEN el cliente llama DELETE /api/channels/telegram/{agentId}
THEN el backend llama deleteWebhook en la API de Telegram
 AND elimina el registro ChannelConnection de la base de datos
 AND devuelve HTTP 200 con { status: "disconnected" }
```

---

## R2 — Recepción y respuesta de mensajes Telegram

El sistema MUST recibir updates de Telegram, enrutarlos al pipeline de chat existente (`chatWithAgent`) y responder por `sendMessage`.

**Escenario R2-1 — Mensaje de texto recibido**

```
GIVEN un ChannelConnection activo para agentId=A1 y provider=telegram
  AND Telegram envía POST /api/channels/telegram/A1 con header X-Telegram-Bot-Api-Secret-Token correcto
  AND el body contiene un update con message.text no vacío
WHEN el endpoint procesa el update
THEN el sistema resuelve el agente por agentId=A1
 AND llama chatWithAgent(agentId, messageText, conversationId)
     donde conversationId se deriva de chatId (crea Conversation si no existe,
     con channel="telegram" y metadata={ telegramChatId })
 AND envía la respuesta al chat de origen vía sendMessage(token, chatId, replyText)
 AND devuelve HTTP 200 con body { ok: true }
```

**Escenario R2-2 — Idempotencia por update_id**

```
GIVEN que Telegram reenvía el mismo update (mismo update_id) dos veces
WHEN el endpoint recibe el segundo envío
THEN el sistema detecta que update_id ya fue procesado
 AND devuelve HTTP 200 con { ok: true } sin volver a llamar chatWithAgent
 AND NO envía un segundo mensaje al usuario
```

Nota de implementación (no normativa): el registro de update_ids procesados SHOULD mantenerse en memoria con TTL de 24 h o en una tabla `ProcessedUpdate` ligera; la elección es decisión de diseño.

**Escenario R2-3 — Tipo de mensaje no soportado (foto, sticker, etc.)**

```
GIVEN un update de Telegram que NO contiene message.text (p. ej. foto o sticker)
WHEN el endpoint lo recibe con secret_token válido
THEN el sistema NO llama chatWithAgent
 AND envía al usuario un mensaje de cortesía: "Lo siento, solo puedo responder a mensajes de texto."
 AND devuelve HTTP 200 con { ok: true }
```

**Escenario R2-4 — Validación del secret token**

```
GIVEN una petición entrante a POST /api/channels/telegram/{agentId}
  AND el header X-Telegram-Bot-Api-Secret-Token no coincide con webhookSecret almacenado
WHEN el endpoint procesa la petición
THEN devuelve HTTP 403 sin ejecutar ninguna lógica de negocio
```

**Escenario R2-5 — Agente eliminado con webhook activo**

```
GIVEN que un ChannelConnection activo existe para agentId=A1
  AND el Agent A1 ha sido eliminado (con cascade que borró el ChannelConnection)
WHEN Telegram envía un update al endpoint /api/channels/telegram/A1
THEN el sistema no encuentra ChannelConnection para A1
 AND devuelve HTTP 404
 AND NO intenta procesar el mensaje
```

---

## R3 — Conexión WhatsApp (Meta Cloud API)

El sistema MUST permitir asociar credenciales de Meta Cloud API a un agente y verificar el webhook.

**Credenciales requeridas del cliente:**
- `phoneNumberId` — identificador del número de teléfono en Meta.
- `accessToken` — token permanente o de larga duración de Meta.
- `verifyToken` — cadena arbitraria que el cliente define y configura en Meta Developer Console.

**Escenario R3-1 — Registro de credenciales**

```
GIVEN un agente con channel=whatsapp
  AND credenciales válidas (phoneNumberId, accessToken, verifyToken)
WHEN el cliente llama POST /api/channels/whatsapp/connect con esas credenciales y el agentId
THEN el sistema cifra el conjunto { phoneNumberId, accessToken, verifyToken } con AES-256-GCM
 AND hace upsert de ChannelConnection con status=pending
   (pending hasta que Meta verifique el webhook vía GET hub.challenge)
 AND devuelve HTTP 200 con { status: "pending", webhookUrl: "{PUBLIC_URL}/api/channels/whatsapp/{agentId}" }
   (las credenciales NO aparecen en la respuesta)
```

**Escenario R3-2 — Verificación del webhook por Meta**

```
GIVEN un ChannelConnection con status=pending para provider=whatsapp
  AND Meta envía GET /api/channels/whatsapp/{agentId}?hub.mode=subscribe&hub.verify_token={verifyToken}&hub.challenge={challenge}
WHEN el endpoint recibe la petición
THEN el sistema descifra las credenciales del ChannelConnection
 AND compara hub.verify_token con el verifyToken almacenado
 AND si coinciden: actualiza status=active y devuelve HTTP 200 con body = hub.challenge (texto plano)
 AND si no coinciden: devuelve HTTP 403
```

**Escenario R3-3 — Verify token incorrecto**

```
GIVEN un GET de verificación de Meta con hub.verify_token que no coincide con el almacenado
WHEN el endpoint lo procesa
THEN devuelve HTTP 403
 AND el status del ChannelConnection permanece en pending (o se actualiza a error)
```

**Escenario R3-4 — Desconexión WhatsApp**

```
GIVEN un ChannelConnection activo para provider=whatsapp
WHEN el cliente llama DELETE /api/channels/whatsapp/{agentId}
THEN el sistema elimina el registro ChannelConnection
 AND devuelve HTTP 200 con { status: "disconnected" }
  (no se realiza ninguna llamada externa a la API de Meta, ya que Meta no provee endpoint de de-registro de webhook)
```

---

## R4 — Recepción y respuesta de mensajes WhatsApp

El sistema MUST recibir eventos de Meta, filtrar mensajes de texto y responder por la Graph API.

**Escenario R4-1 — Mensaje de texto recibido**

```
GIVEN un ChannelConnection activo para agentId=A1 y provider=whatsapp
  AND Meta envía POST /api/channels/whatsapp/A1 con payload que contiene un mensaje de tipo text
WHEN el endpoint procesa el evento
THEN el sistema extrae el número origen (from) y el texto del mensaje
 AND resuelve o crea una Conversation con channel="whatsapp" y metadata={ waFrom: from }
 AND llama chatWithAgent(agentId, messageText, conversationId)
 AND envía la respuesta vía POST https://graph.facebook.com/${META_GRAPH_VERSION:-v21.0}/{phoneNumberId}/messages
     con Authorization: Bearer {accessToken}
 AND devuelve HTTP 200 con { ok: true }
```

**Escenario R4-2 — Idempotencia por message id**

```
GIVEN que Meta reenvía el mismo evento (mismo messages[0].id) dos veces
WHEN el endpoint recibe el segundo envío
THEN el sistema detecta que el message id ya fue procesado
 AND devuelve HTTP 200 con { ok: true } sin llamar chatWithAgent ni responder al usuario
```

**Escenario R4-3 — Tipo de mensaje no soportado (imagen, audio, etc.)**

```
GIVEN un evento de Meta que contiene un mensaje de tipo distinto a text (p. ej. image, audio)
WHEN el endpoint lo recibe
THEN el sistema NO llama chatWithAgent
 AND responde al número de origen con: "Lo siento, en este momento solo puedo responder a mensajes de texto."
 AND devuelve HTTP 200 con { ok: true }
```

**Escenario R4-4 — Evento de notificación de estado (delivery/read receipt)**

```
GIVEN un evento de Meta de tipo statuses (confirmación de entrega o lectura)
WHEN el endpoint lo recibe
THEN el sistema lo ignora silenciosamente
 AND devuelve HTTP 200 con { ok: true }
```

---

## R5 — Cifrado de credenciales

El sistema MUST cifrar todas las credenciales de `ChannelConnection` en reposo usando AES-256-GCM.

**Escenario R5-1 — Cifrado al persistir**

```
GIVEN credenciales en texto plano (token de Telegram o credenciales de WhatsApp)
WHEN el sistema hace upsert de ChannelConnection
THEN el campo credentials en base de datos contiene el ciphertext (nunca el texto plano)
 AND el ciphertext incluye iv y authTag como parte del payload JSON almacenado
```

**Escenario R5-2 — Descifrado en memoria**

```
GIVEN un ChannelConnection con credentials cifradas
WHEN el sistema necesita usar las credenciales (enviar mensaje, registrar webhook)
THEN descifra en memoria usando CHANNEL_ENCRYPTION_KEY
 AND las credenciales en texto plano NO se escriben a disco ni se registran en logs
```

**Escenario R5-3 — API nunca expone credenciales completas**

```
GIVEN cualquier endpoint que devuelve datos de ChannelConnection
WHEN el cliente realiza GET /api/channels/{agentId}
THEN la respuesta NO incluye el token completo ni accessToken
 AND para Telegram: puede incluir los últimos 4 caracteres del token con prefijo de máscara (p. ej. "****abcd")
     o simplemente omitirlo
 AND para WhatsApp: puede incluir los últimos 4 caracteres del accessToken con máscara
 AND el campo credentials cifrado NEVER aparece en ninguna respuesta de API
```

**Escenario R5-4 — Clave de cifrado no configurada**

```
GIVEN que CHANNEL_ENCRYPTION_KEY no está definida en el entorno
WHEN el servidor arranca
THEN el servidor SHOULD registrar un error de configuración en el log de arranque
 AND cualquier intento de conectar un canal devuelve HTTP 500 con { error: "Configuración de cifrado incompleta" }
```

---

## R6 — UI — Panel de integraciones de canal

La pestaña Integraciones de `app/agents/[id]/page.tsx` MUST mostrar un panel por canal (`telegram` | `whatsapp`) si el agente tiene el `channel` correspondiente.

**Escenario R6-1 — Estado desconectado**

```
GIVEN un agente con channel=telegram sin ChannelConnection activo
WHEN el usuario navega a la pestaña Integraciones del agente
THEN la UI muestra una card "Telegram" con estado "Desconectado"
 AND muestra un formulario con campo "Token de BotFather"
 AND muestra instrucciones paso a paso: cómo crear el bot con @BotFather y copiar el token
 AND muestra el botón "Conectar"
```

**Escenario R6-2 — Conexión en progreso**

```
GIVEN el usuario ha pulsado "Conectar" y la petición POST está en curso
WHEN el frontend espera la respuesta
THEN el botón muestra estado de carga (spinner) y está deshabilitado
 AND el formulario está deshabilitado durante la operación
```

**Escenario R6-3 — Estado conectado**

```
GIVEN un ChannelConnection con status=active para el agente
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra el estado "Conectado" con indicador visual verde
 AND muestra el nombre del bot (para Telegram) o el phoneNumberId enmascarado (para WhatsApp)
 AND NO muestra los tokens ni credenciales completas
 AND muestra el botón "Desconectar"
```

**Escenario R6-4 — Estado pendiente (WhatsApp)**

```
GIVEN un ChannelConnection con status=pending para provider=whatsapp
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra el estado "Pendiente de verificación"
 AND muestra la URL de webhook que el usuario debe registrar en Meta Developer Console
 AND muestra instrucciones de verificación paso a paso
```

**Escenario R6-5 — Estado de error**

```
GIVEN un ChannelConnection con status=error
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra el estado "Error de conexión" con indicador visual rojo
 AND permite reintentar rellenando de nuevo el formulario
```

**Escenario R6-6 — Desconexión desde la UI**

```
GIVEN un ChannelConnection con status=active
WHEN el usuario pulsa "Desconectar" y confirma la acción
THEN el frontend llama DELETE /api/channels/{provider}/{agentId}
 AND la UI actualiza el estado a "Desconectado" sin necesidad de recargar la página
```

**Escenario R6-7 — Aviso de backend sin URL pública**

```
GIVEN que GET /api/channels/{agentId}/status devuelve { publicUrlConfigured: false }
WHEN la UI renderiza el panel de canal
THEN muestra un aviso de advertencia: "El backend no tiene PUBLIC_URL configurada. El bot no podrá recibir mensajes hasta que se configure un dominio HTTPS público."
 AND el botón "Conectar" está deshabilitado
```

---

## R7 — Seguridad de webhooks

**Escenario R7-1 — Validación de secret token Telegram**

```
GIVEN una petición POST a /api/channels/telegram/{agentId}
WHEN el header X-Telegram-Bot-Api-Secret-Token está ausente o no coincide con webhookSecret del ChannelConnection
THEN el endpoint devuelve HTTP 403
 AND NO ejecuta ninguna lógica de negocio
 AND NO registra el intento en las conversaciones
```

**Escenario R7-2 — Validación de verify token WhatsApp (GET)**

```
GIVEN una petición GET a /api/channels/whatsapp/{agentId}
WHEN hub.verify_token no coincide con el verifyToken almacenado en ChannelConnection
THEN el endpoint devuelve HTTP 403
```

**Escenario R7-3 — Rechazo de eventos WhatsApp no autenticados (POST)**

El sistema SHOULD validar la firma `X-Hub-Signature-256` de los eventos POST de Meta si se dispone del `App Secret` de Meta en la configuración. Si no se dispone del App Secret, la validación es opcional pero recomendada.

```
GIVEN una petición POST a /api/channels/whatsapp/{agentId}
  AND META_APP_SECRET está configurado en el entorno
WHEN el header X-Hub-Signature-256 no coincide con el hash HMAC-SHA256 del body
THEN el endpoint devuelve HTTP 403
```

**Escenario R7-4 — ChannelConnection no encontrado**

```
GIVEN una petición de webhook a cualquier endpoint de canal
WHEN no existe un ChannelConnection activo para el agentId en la URL
THEN el endpoint devuelve HTTP 404
 AND NO expone información sobre si el agente existe o no (respuesta genérica)
```

---

## Casos borde adicionales

### CB-1 — Rotación de clave de cifrado

- Documentar en `.env.example` que cambiar `CHANNEL_ENCRYPTION_KEY` invalida todas las credenciales existentes.
- El sistema MUST documentar en `back/.env.example` que la rotación requiere re-conectar todos los canales.
- No se implementa rotación automática en esta fase.

### CB-2 — Backend sin URL pública (local dev)

- Documentar en `back/.env.example` que `PUBLIC_URL` MUST ser HTTPS y accesible desde internet para que Telegram/WhatsApp puedan llamar al webhook.
- Recomendación documentada: usar ngrok o cloudflared en entornos locales.
- En producción: `PUBLIC_URL` es la URL del servidor desplegado.

### CB-3 — Orden de botones en UI — canal no coincidente

```
GIVEN un agente con channel=widget (ni telegram ni whatsapp)
WHEN el usuario navega a la pestaña Integraciones
THEN la UI NO muestra el panel de canal de mensajería
  (la pestaña puede mostrar otras integraciones OAuth si las hubiera)
```

### CB-4 — Error de red al llamar API de Telegram/WhatsApp

```
GIVEN que el backend no puede alcanzar la API de Telegram o la Graph API de Meta
WHEN ocurre un error de red durante connect o sendMessage
THEN el sistema registra el error en logs
 AND actualiza el status del ChannelConnection a error si el fallo ocurre durante connect
 AND devuelve HTTP 502 al cliente con mensaje genérico
 AND NO expone detalles internos de red en la respuesta
```

---

## Resumen de endpoints requeridos

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/api/channels/telegram/connect` | Conectar bot Telegram |
| POST | `/api/channels/whatsapp/connect` | Registrar credenciales WhatsApp |
| GET | `/api/channels/:agentId` | Estado de conexiones (sin credenciales) |
| DELETE | `/api/channels/telegram/:agentId` | Desconectar bot Telegram |
| DELETE | `/api/channels/whatsapp/:agentId` | Desconectar WhatsApp |
| POST | `/api/channels/telegram/:agentId` | Webhook receptor updates Telegram |
| GET | `/api/channels/whatsapp/:agentId` | Webhook verificación Meta |
| POST | `/api/channels/whatsapp/:agentId` | Webhook receptor eventos WhatsApp |

---

## Fuera de alcance (confirmado)

- Alta automática de número de WhatsApp.
- Verificación de negocio en Meta.
- Mensajes con multimedia o plantillas.
- Otros canales (Instagram, Messenger).
- Rotación automática de `CHANNEL_ENCRYPTION_KEY`.
- Validación de `X-Hub-Signature-256` sin `META_APP_SECRET` configurado.

---

## Decisiones que requieren confirmación humana

| ID | Decisión | Asunción tomada en este spec |
|---|---|---|
| D1 | ¿1 bot por agente o varios agentes por bot? | 1 bot ↔ 1 agente por proveedor (`@@unique([agentId, provider])`). Cambiar esto requiere eliminar la restricción unique y añadir lógica de enrutamiento. |
| D2 | ¿Almacenamiento de update_ids procesados (dedup)? | El spec no prescribe la implementación (in-memory TTL vs. tabla DB). Decisión queda para la fase de diseño. |
| D3 | ¿Validar `X-Hub-Signature-256` de Meta siempre? | Se hace opcional si `META_APP_SECRET` no está configurado. Confirmar si debe ser obligatorio en producción. |
| D4 | ¿Versión de la Graph API de Meta? | Parametrizada por env META_GRAPH_VERSION; default v21.0 (AD7 en design.md). |
