# Spec — oauth-integrations

Canal objetivo: **oauth**
Fecha: 2026-06-12
Estado: spec-ready

---

## Convenciones de este documento

- Las palabras **MUST**, **SHALL**, **SHOULD**, **MAY** siguen RFC 2119.
- Los nombres de modelos Prisma se escriben en `CamelCase`.
- Los escenarios usan formato GIVEN / WHEN / THEN.
- `Integration` se refiere al modelo Prisma existente (PR: `back/prisma/schema.prisma` líneas 101-113).
- `crypto.ts` se refiere a `back/src/lib/crypto.ts`, módulo introducido en P1 (`telegram-whatsapp-bots`).

---

## R1 — Cifrado de tokens en reposo

Los campos `accessToken` y `refreshToken` del modelo `Integration` MUST almacenarse cifrados
usando AES-256-GCM reutilizando la utilidad `crypto.ts` (misma clave `CHANNEL_ENCRYPTION_KEY`,
misma estructura `{ iv, authTag, data }` en hexadecimal).

La dependencia de `crypto.ts` establece que esta fase (P2) requiere que P1 ya haya entregado
ese módulo antes de aplicar las tareas de cifrado.

### R1-1 — Cifrado al persistir

**Escenario R1-1-a — Callback OAuth guarda tokens cifrados**

```
GIVEN un proveedor OAuth con clientId/clientSecret configurados en entorno
  AND el usuario completa el flujo OAuth y llega el code al callback
WHEN handleCallback intercambia el code por accessToken (y refreshToken si presente)
THEN el backend cifra accessToken con encrypt(crypto.ts) antes de escribirlo en Integration
 AND el backend cifra refreshToken con encrypt(crypto.ts) si el proveedor lo devuelve
 AND el campo accessToken en la base de datos es el JSON stringificado del EncryptedPayload
   (nunca el token en texto plano)
 AND el campo refreshToken en la base de datos es el JSON stringificado del EncryptedPayload
   o NULL si el proveedor no envió refresh token
```

**Escenario R1-1-b — Verificación de no exposición en base de datos**

```
GIVEN una Integration persistida tras el callback
WHEN se consulta la fila directamente en la base de datos
THEN accessToken NO contiene el token en texto plano
 AND refreshToken, si presente, NO contiene el token en texto plano
 AND ambos campos son objetos JSON con claves iv, authTag, data
```

### R1-2 — Descifrado transparente al usar el token

**Escenario R1-2-a — getAccessToken descifra antes de usar**

```
GIVEN una Integration con accessToken cifrado y expiresAt en el futuro (no expirado)
WHEN se llama getAccessToken(integration)
THEN el sistema descifra accessToken con decrypt(crypto.ts)
 AND devuelve el token en texto plano para uso en llamadas HTTP externas
 AND el token descifrado NO se persiste en ningún log ni respuesta de API
```

**Escenario R1-2-b — Refresh descifra refreshToken y vuelve a cifrar el nuevo**

```
GIVEN una Integration con accessToken cifrado y expiresAt en el pasado
  AND refreshToken cifrado presente
WHEN se llama getAccessToken(integration) detecta expiración
THEN el sistema descifra refreshToken antes de enviarlo al tokenUrl del proveedor
 AND si el proveedor devuelve nuevo accessToken:
     el sistema cifra el nuevo accessToken antes de persistirlo en Integration
     y si el proveedor devuelve nuevo refreshToken (rotación de Google), también lo cifra
 AND getAccessToken devuelve el nuevo accessToken en texto plano
```

### R1-3 — Migración de tokens existentes en claro

El sistema MUST proporcionar un mecanismo de migración idempotente que cifre los
tokens existentes en la base de datos que estén almacenados en texto plano.

**Escenario R1-3-a — Migración idempotente detecta ya-cifrados**

```
GIVEN una tabla Integration con algunas filas con tokens en texto plano
  AND otras filas con tokens ya cifrados (JSON con claves iv/authTag/data)
WHEN se ejecuta el script/endpoint de migración
THEN las filas con tokens en texto plano son cifradas y actualizadas en la base de datos
 AND las filas que ya contienen JSON de EncryptedPayload NO son modificadas
 AND el script termina indicando cuántas filas fueron migradas y cuántas ya estaban cifradas
```

Nota: el criterio de detección de "ya cifrado" es intentar parsear el valor como JSON
y verificar presencia de claves `iv`, `authTag`, `data`. Si el parseo falla o faltan
claves, se trata el valor como texto plano pendiente de cifrar.

**Escenario R1-3-b — Migración falla de forma segura**

```
GIVEN que el script de migración se ejecuta sin CHANNEL_ENCRYPTION_KEY configurada
WHEN se intenta cifrar la primera fila
THEN el script aborta con error explícito
 AND no modifica ninguna fila
```

### R1-4 — Clave de cifrado no configurada

```
GIVEN que CHANNEL_ENCRYPTION_KEY no está definida en el entorno
WHEN el backend procesa un callback OAuth que intenta cifrar tokens
THEN el endpoint devuelve HTTP 500 con { error: "Configuración de cifrado incompleta" }
 AND no persiste ninguna Integration con tokens en texto plano
```

### R1-5 — API nunca expone tokens completos

```
GIVEN cualquier endpoint que devuelve datos de Integration o estado de conexión
WHEN el cliente realiza una petición GET a esos endpoints
THEN la respuesta NO incluye accessToken ni refreshToken (ni cifrados ni en claro)
 AND la respuesta PUEDE incluir metadatos de cuenta (email, workspace name) si están en metadata
 AND para identificar la cuenta se usa el email u otro identificador de metadata, no el token
```

---

## R2 — Google unificado (Calendar + Gmail)

El proveedor `google` MUST reemplazar a los proveedores separados `gmail` y `calendar`.
Un único flujo OAuth solicita los scopes de Gmail y Calendar en la misma autorización.

### R2-1 — Proveedor `google` con scopes unificados

**Escenario R2-1-a — Flujo OAuth google solicita ambos scopes**

```
GIVEN la configuración del proveedor google con GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET
WHEN el cliente inicia el flujo OAuth llamando GET /api/oauth/google?agentId=...
THEN authorizationUrl genera una URL hacia accounts.google.com con:
     scope que incluye https://www.googleapis.com/auth/gmail.modify
     Y https://www.googleapis.com/auth/calendar
     Y access_type=offline y prompt=consent para garantizar refresh token
 AND el state contiene el agentId
```

**Escenario R2-1-b — Callback crea Integration con provider=google**

```
GIVEN el usuario autoriza en Google y el callback recibe el code
WHEN handleCallback(provider="google", code, agentId) procesa la respuesta
THEN se crea o actualiza una Integration con provider="google"
 AND se almacena email de la cuenta Google en metadata si la respuesta del token
     o una llamada a userinfo lo provee
 AND accessToken y refreshToken se cifran antes de persistir
```

### R2-2 — Decisión de migración: D-P2-1 (requiere confirmación)

Ver sección de decisiones al final. En tanto no se confirme, el spec asume:

**Escenario R2-2-a — Migración de filas gmail/calendar a google**

```
GIVEN filas Integration con provider="gmail" o provider="calendar" para un mismo agentId
WHEN se ejecuta el script de migración de proveedores
THEN se conserva UNA Integration con provider="google" por agentId
 AND el refreshToken conservado es el más reciente entre las filas gmail y calendar
 AND las filas gmail y calendar originales son eliminadas
 AND si un agente solo tiene gmail o solo calendar, se migra esa única fila a google
```

**Escenario R2-2-b — Constraint unique no se viola tras migración**

```
GIVEN que el script ha migrado filas a provider="google"
WHEN se consulta la tabla Integration
THEN ningún agentId tiene más de una fila con provider="google"
 AND la constraint @@unique([agentId, provider]) se mantiene satisfecha
```

---

## R3 — Notion como nuevo proveedor

El sistema MUST añadir `notion` al catálogo `PROVIDERS` de `oauth.ts`.
Notion usa OAuth 2.0 con token de larga duración (sin expiración, sin refresh token).

### R3-1 — Configuración del proveedor Notion

El proveedor `notion` MUST incluir:
- `authUrl`: `https://api.notion.com/v1/oauth/authorize`
- `tokenUrl`: `https://api.notion.com/v1/oauth/token`
- Scopes: los definidos por la Notion OAuth App (no hay selector de scopes explícito en Notion; se solicitan en la configuración de la app)
- Variables de entorno: `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`

**Escenario R3-1-a — Flujo OAuth Notion completa sin refreshToken**

```
GIVEN NOTION_CLIENT_ID y NOTION_CLIENT_SECRET configurados
WHEN el usuario completa el flujo OAuth de Notion y llega el code al callback
THEN el sistema intercambia el code por accessToken en el endpoint de Notion
 AND persiste Integration con provider="notion", accessToken cifrado
 AND refreshToken es NULL (Notion no emite refresh tokens)
 AND expiresAt es NULL (el token de Notion no caduca)
 AND metadata incluye el workspace_name y workspace_id si la respuesta de Notion los provee
```

**Escenario R3-1-b — getAccessToken con proveedor sin expiración**

```
GIVEN una Integration con provider="notion" y expiresAt=NULL
WHEN se llama getAccessToken(integration)
THEN el sistema descifra y devuelve accessToken sin intentar refresh
 AND no realiza ninguna llamada al tokenUrl de Notion
```

### R3-2 — Acciones de Notion disponibles

Las acciones soportadas en el catálogo de servicios para Notion MUST incluir al menos:
- `create_page` — crear una página en un database de Notion
- `append_block` — agregar bloques de contenido a una página existente
- `query_database` — consultar filas de un database de Notion

Estas acciones son la especificación funcional mínima; la implementación de los
endpoints correspondientes corresponde a la fase de automatizaciones (P3). En esta
fase se requiere únicamente que la conexión OAuth sea posible y que el servicio
`notion` esté mapeado en la tabla `service → provider`.

---

## R4 — Refresh automático transparente

El sistema MUST renovar el `accessToken` expirado antes de usarlo, de forma
transparente para quien llame a `getAccessToken`.

### R4-1 — Renovación al detectar expiración

**Escenario R4-1-a — Token expirado con refreshToken disponible**

```
GIVEN una Integration con accessToken cifrado
  AND expiresAt en el pasado (o dentro del margen de 60 segundos)
  AND refreshToken cifrado y no nulo
WHEN cualquier servicio llama getAccessToken(integration)
THEN el sistema descifra refreshToken
 AND envía petición de refresh al tokenUrl del proveedor con grant_type=refresh_token
 AND si el proveedor responde con nuevo accessToken:
     cifra el nuevo accessToken y actualiza Integration.accessToken
     si el proveedor rota el refreshToken (Google puede hacerlo), cifra y actualiza
     Integration.refreshToken también
     actualiza expiresAt con la nueva duración
     devuelve el nuevo accessToken en texto plano
```

**Escenario R4-1-b — Proveedor sin refresh (Slack bot tokens, Notion)**

```
GIVEN una Integration con provider que no rota tokens
  (Slack bot tokens nunca caducan; Notion no emite refreshToken)
WHEN se llama getAccessToken(integration)
THEN el sistema NO intenta refresh si refreshToken es NULL
 AND devuelve el accessToken descifrado directamente
 AND no realiza llamadas al tokenUrl del proveedor
```

### R4-2 — Fallo de refresh → estado reauth_required

**Escenario R4-2-a — Refresh falla por token revocado**

```
GIVEN una Integration con refreshToken cifrado pero el token ha sido revocado externamente
WHEN el sistema intenta el refresh y el proveedor responde con error (p.ej. invalid_grant)
THEN el sistema actualiza Integration con un campo de estado que indica reauth_required
     (implementación: añadir campo status a Integration, o usar metadata.status="reauth_required")
 AND getAccessToken lanza un error tipado que el caller puede detectar
 AND la UI refleja el estado "reauth_required" con llamada a acción para reconectar
```

**Escenario R4-2-b — Refresh falla por error de red**

```
GIVEN que el tokenUrl del proveedor no responde (timeout o error de red)
WHEN el sistema intenta el refresh
THEN getAccessToken devuelve el accessToken antiguo (posiblemente expirado)
     o lanza error según la severidad del fallo
 AND el error se registra en los logs del backend
 AND la Integration no se marca como reauth_required (es fallo transitorio)
```

### R4-3 — Estado reauth_required visible en UI

```
GIVEN una Integration con estado reauth_required
WHEN el usuario navega a la pestaña Integraciones del agente
THEN la UI muestra la conexión del proveedor con estado "Requiere reconexión"
 AND muestra un aviso explicativo (p.ej. "El acceso fue revocado o caducó definitivamente")
 AND muestra el botón "Volver a conectar" que inicia el flujo OAuth desde cero
```

---

## R5 — Estado de conexiones OAuth en la UI

La pestaña Integraciones de `app/agents/[id]/page.tsx` MUST mostrar el estado de
las conexiones OAuth del agente para todos los proveedores de la fase inicial.

### R5-1 — Lista de proveedores con estado

**Escenario R5-1-a — Proveedor conectado**

```
GIVEN una Integration activa con provider="google" para el agente
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra una card "Google" con estado "Conectado"
 AND muestra el email o nombre de cuenta de metadata si está disponible
 AND muestra el botón "Desconectar"
 AND NO muestra el accessToken ni ningún token
```

**Escenario R5-1-b — Proveedor desconectado**

```
GIVEN que no existe Integration con provider="google" para el agente
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra una card "Google" con estado "Desconectado"
 AND muestra el botón "Conectar" que inicia el flujo OAuth
```

**Escenario R5-1-c — Proveedor con reauth_required**

```
GIVEN una Integration con estado reauth_required para cualquier proveedor
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra la card del proveedor con estado "Requiere reconexión" (indicador amarillo o rojo)
 AND muestra el botón "Volver a conectar"
 AND NO muestra el botón "Desconectar" (ya no hay conexión operativa)
```

### R5-2 — Proveedores fase inicial y fase posterior

Los proveedores MUST clasificarse en dos grupos visibles en la UI:

**Fase inicial (conectables):** `google`, `slack`, `notion`

**Fase posterior (próximamente — no conectables en esta fase):** `jira`, `instagram`

```
GIVEN que el usuario navega a la pestaña Integraciones
WHEN la UI renderiza el panel OAuth
THEN los proveedores google, slack y notion muestran botón "Conectar" / "Desconectar"
 AND los proveedores jira e instagram muestran etiqueta "Próximamente"
   con botón "Conectar" deshabilitado
 AND la UI NO redirige a flujo OAuth si el usuario intenta conectar jira o instagram
```

### R5-3 — Desconexión desde la UI

```
GIVEN una Integration activa para provider="slack"
WHEN el usuario pulsa "Desconectar" y confirma la acción
THEN el frontend llama DELETE /api/integrations con { agentId, provider: "slack" }
 AND la UI actualiza el estado a "Desconectado" sin recargar la página
 AND el endpoint borra la fila Integration correspondiente
```

---

## R6 — Mapeo SERVICES → conexiones OAuth

El catálogo `SERVICES` de `AutomationsPanel.tsx` MUST indicar para cada servicio si
requiere una conexión OAuth y cuál es su estado en el agente actual.

### R6-1 — Tabla service → provider (back)

El backend MUST exponer (o el código compartido MUST definir) una tabla canónica que
mapee cada `service` del catálogo al `provider` OAuth correspondiente:

| service | provider OAuth |
|---|---|
| `google_calendar` | `google` |
| `gmail` | `google` |
| `slack` | `slack` |
| `notion` | `notion` |
| `jira` | `jira` |
| `instagram` | `instagram` |

Esta tabla MUST ser la única fuente de verdad; no se permite duplicar el mapeo
en diferentes partes del código.

### R6-2 — Aviso al seleccionar servicio sin conexión

**Escenario R6-2-a — Servicio requiere conexión no existente**

```
GIVEN un agente sin Integration de provider="google"
  AND el usuario selecciona la acción "Crear evento de Calendar" (service=google_calendar)
    en AutomationsPanel
WHEN AutomationsPanel resuelve el servicio contra el mapa service→provider
THEN la UI muestra un aviso: "Este servicio requiere conectar Google en la pestaña Integraciones"
 AND muestra un enlace / botón que navega a la pestaña Integraciones del agente
 AND la acción NO puede guardarse sin la conexión (botón guardar deshabilitado o muestra error)
```

**Escenario R6-2-b — Servicio con reauth_required**

```
GIVEN un agente con Integration de provider="google" en estado reauth_required
  AND el usuario selecciona una acción que requiere google
WHEN AutomationsPanel resuelve el estado de la conexión
THEN la UI muestra un aviso: "La conexión con Google requiere reconexión"
 AND muestra enlace a la pestaña Integraciones
```

**Escenario R6-2-c — Servicio próximamente (jira / instagram)**

```
GIVEN el usuario selecciona una acción de servicio=jira o service=instagram
WHEN AutomationsPanel verifica el estado
THEN la UI muestra el aviso "Este servicio estará disponible próximamente"
 AND el campo de acción queda deshabilitado
```

### R6-3 — Validación en el backend al usar una automatización

```
GIVEN una Automation con config.service="slack" para agentId=A1
  AND NO existe Integration con provider="slack" y agentId=A1
WHEN el motor de automatizaciones intenta ejecutar la automatización
THEN el motor detecta la ausencia de conexión
 AND marca la AutomationRun con status="skipped" o status="error"
   con mensaje: "Integration requerida (slack) no configurada para el agente"
 AND NO intenta llamar a ninguna API externa
```

---

## R7 — Seguridad del flujo OAuth

### R7-1 — Parámetro `state` anti-CSRF

```
GIVEN que el usuario inicia un flujo OAuth llamando GET /api/oauth/:provider?agentId=...
WHEN authorizationUrl genera la URL de autorización
THEN el parámetro state de la URL OAuth MUST contener un valor vinculado al agentId
     de forma que el callback pueda verificar que la respuesta corresponde
     a la petición iniciada
 AND el state no expone información sensible en texto plano
```

Nota: la implementación actual usa `state = agentId` directamente. Esta fase SHOULD
mejorar el state con un token de sesión o nonce para prevenir ataques CSRF, aunque el
nivel mínimo aceptable es incluir el agentId y validar su consistencia en el callback.
La decisión de implementar nonce se documenta como D-P2-2.

### R7-2 — Validación de redirect URI

```
GIVEN el callback OAuth en GET /api/oauth/:provider/callback
WHEN el sistema procesa el code recibido
THEN el sistema MUST enviar el mismo redirect_uri en el intercambio de tokens
     que el que fue registrado en el proveedor OAuth y el que se usó al generar authorizationUrl
 AND si el provider no está en PROVIDERS, el sistema devuelve HTTP 400
   sin procesar el code
```

### R7-3 — Secrets solo en variables de entorno

```
GIVEN el código fuente de back/src/lib/integrations/oauth.ts
WHEN se audita la configuración de proveedores
THEN NINGÚN clientId ni clientSecret MUST estar hardcodeado en el código fuente
 AND todos los valores se leen de process.env en tiempo de ejecución
 AND si un clientId o clientSecret está vacío, authorizationUrl lanza error
   con mensaje que indica qué variable de entorno está faltando
```

### R7-4 — Scopes mínimos por proveedor

Cada proveedor MUST solicitar únicamente los scopes necesarios para las acciones
declaradas. Scopes mínimos por proveedor en esta fase:

| Proveedor | Scopes mínimos |
|---|---|
| google | `gmail.modify`, `calendar` (ambos requeridos por el flujo unificado) |
| slack | `chat:write`, `channels:read`, `channels:history` |
| notion | los definidos por la Notion OAuth App (no modificables en la URL de auth) |

### R7-5 — Manejo del callback con error de usuario (deny)

**Escenario R7-5-a — Usuario cancela el flujo OAuth**

```
GIVEN que el usuario hace clic en "Denegar" / "Cancelar" en la pantalla de autorización del proveedor
WHEN el proveedor redirige al callback con parámetro error (p.ej. error=access_denied)
THEN el backend detecta el error en el callback
 AND redirige al frontend con: {FRONT_URL}/agents/{agentId}?tab=integraciones&error=oauth_cancelled
 AND NO crea ni modifica ninguna Integration
```

---

## Casos borde

### CB-1 — Revocación externa del token

```
GIVEN una Integration activa con provider="google"
  AND el usuario revoca el acceso desde su cuenta Google (fuera del sistema)
WHEN el sistema intenta usar el token (accessToken o refresh)
THEN la llamada al tokenUrl de Google devuelve invalid_grant
 AND el sistema actualiza la Integration a estado reauth_required
 AND la siguiente carga de la UI de Integraciones muestra el estado "Requiere reconexión"
```

### CB-2 — Agente eliminado (cascade)

```
GIVEN un Agent con Integrations activas para google y slack
WHEN se elimina el Agent
THEN el cascade de Prisma (onDelete: Cascade en Integration.agentId) elimina
     todas las Integrations del agente automáticamente
 AND NO se requiere lógica adicional de limpieza de tokens en el backend
```

La constraint `onDelete: Cascade` en `Integration` ya existe en el schema actual.
No se requiere cambio de schema para este caso borde.

### CB-3 — Múltiples agentes conectando el mismo workspace

```
GIVEN dos agentes del mismo cliente, agentId=A1 y agentId=A2
  AND ambos se conectan a la misma cuenta de Slack (mismo workspace)
WHEN se crean las Integrations
THEN A1 tiene su propia fila Integration(agentId=A1, provider=slack)
 AND A2 tiene su propia fila Integration(agentId=A2, provider=slack)
 AND las dos filas son independientes; desconectar A1 no afecta a A2
```

### CB-4 — Callback con state inválido o agentId inexistente

```
GIVEN un callback OAuth con state que no corresponde a ningún Agent existente
WHEN el backend procesa el callback
THEN el backend detecta el agentId inválido al intentar el upsert
 AND devuelve HTTP 400 o redirige al frontend con error=invalid_state
 AND NO crea ninguna Integration huérfana
```

### CB-5 — Registro de aplicación OAuth en proveedores (requisito operacional)

El sistema MUST documentar en `docs/SETUP-OAUTH.md` los pasos para registrar las
aplicaciones OAuth en Google, Slack y Notion, incluyendo:
- Redirect URIs requeridas (formato: `{BACK_URL}/api/oauth/{provider}/callback`)
- Scopes a solicitar en el panel del proveedor
- Advertencia: en entornos locales se requiere URL pública (ngrok / cloudflared)
  para que el callback sea accesible

Este documento es un deliverable de la fase; sin él el sistema no puede configurarse
en un entorno nuevo.

---

## Resumen de cambios en modelos de datos

El modelo `Integration` (existente) MUST soportar un campo de estado para reflejar
`reauth_required`. Opciones de implementación (decisión de diseño, no de spec):

- Añadir columna `status String @default("active")` al modelo `Integration`.
- O almacenar `metadata.status = "reauth_required"` en el campo Json existente.

La elección entre estas opciones es D-P2-3 (ver sección de decisiones).

Cambios de schema que SÍ prescribe este spec:

| Cambio | Tipo |
|---|---|
| `Integration.provider` acepta valor `"google"` (antes solo `gmail|slack|jira|calendar`) | Lógico, no de schema |
| Tokens `accessToken`/`refreshToken` contienen JSON de EncryptedPayload | Lógico, mismo tipo `String` |
| Estado `reauth_required` observable desde fuera | Pendiente de D-P2-3 |

No se añaden ni eliminan columnas en esta fase más allá de las requeridas por D-P2-3.
El campo `provider` sigue siendo `String`; las restricciones de valores son de lógica
de aplicación.

---

## Resumen de endpoints afectados / nuevos

| Método | Ruta | Cambio |
|---|---|---|
| GET | `/api/oauth/:provider` | Sin cambio de contrato; añadir provider `google`, `notion` |
| GET | `/api/oauth/:provider/callback` | Sin cambio de contrato; añadir lógica de cifrado y manejo de `error` |
| DELETE | `/api/integrations` | Sin cambio de contrato; ya existe |
| GET | `/api/integrations/:agentId` (nuevo) | Devuelve lista de integraciones con estado (sin tokens); formato ver R5-1 |

El endpoint `GET /api/integrations/:agentId` MUST devolver:

```json
{
  "integrations": [
    {
      "provider": "google",
      "status": "connected",
      "accountLabel": "usuario@gmail.com"
    },
    {
      "provider": "slack",
      "status": "reauth_required",
      "accountLabel": "Workspace Acme"
    },
    {
      "provider": "notion",
      "status": "disconnected",
      "accountLabel": null
    }
  ]
}
```

Los valores de `status` permitidos son: `"connected"` | `"reauth_required"` | `"disconnected"`.

---

## Fuera de alcance (confirmado)

- Implementación funcional de Jira e Instagram (solo UI de "Próximamente").
- Gestión de scopes incrementales por acción (todos los scopes se piden en el primer OAuth).
- Rotación automática de `CHANNEL_ENCRYPTION_KEY`.
- Publicación de la OAuth App en directorios públicos de los proveedores.
- Mensajes push / notificaciones desde los servicios hacia el agente (solo flujo agente → servicio).

---

## Decisiones que requieren confirmación humana

| ID | Decisión | Asunción tomada en este spec |
|---|---|---|
| D-P2-1 | Migración gmail/calendar → google: ¿conservar refresh token más reciente o forzar reconexión? | El spec asume conservar el refresh token más reciente y migrar automáticamente. Cambiar esto a "forzar reconexión" elimina el riesgo de migración pero invalida integraciones activas. |
| D-P2-2 | ¿El parámetro `state` del flujo OAuth MUST incluir un nonce anti-CSRF además del agentId? | El spec trata el nonce como SHOULD (recomendado). Confirmar si debe ser MUST para cumplir requisitos de seguridad del proyecto. |
| D-P2-3 | ¿El estado `reauth_required` se almacena como columna `status` en `Integration` o en `metadata.status`? | El spec es agnóstico; ambas son válidas. Añadir columna es más explícito y consultable; usar metadata no requiere migración de schema. Confirmar antes del diseño. |
| D-P2-4 | ¿Slack bot tokens tienen expiración? (Propuesta: no intentar refresh si refreshToken es NULL o si el proveedor es slack) | El spec asume que Slack bot tokens no caducan y no requieren refresh. Confirmar si el proyecto usa User tokens de Slack en lugar de Bot tokens (User tokens sí caducan). |
