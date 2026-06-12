# Spec — OAuth Integrations

**Estado**: Archived from P2 — oauth-integrations (2026-06-12)

**Objetivo**: Conexiones OAuth reales para Google (Calendar + Gmail), Slack, Notion, con tokens cifrados y refresh automático.

---

## R1 — Cifrado de tokens en reposo

Los campos `accessToken` y `refreshToken` del modelo `Integration` MUST almacenarse cifrados usando AES-256-GCM reutilizando la utilidad `crypto.ts`.

**R1-1 — Cifrado al persistir**

```
GIVEN un proveedor OAuth con clientId/clientSecret configurados
WHEN handleCallback intercambia el code por accessToken (y refreshToken si presente)
THEN el backend cifra accessToken con encrypt(crypto.ts) antes de escribirlo en Integration
 AND el backend cifra refreshToken si el proveedor lo devuelve
 AND el campo accessToken en la base de datos es el JSON stringificado del EncryptedPayload
```

**R1-2 — Descifrado transparente al usar**

```
GIVEN una Integration con accessToken cifrado y expiresAt en el futuro (no expirado)
WHEN se llama getAccessToken(integration)
THEN el sistema descifra accessToken con decrypt(crypto.ts)
 AND devuelve el token en texto plano para uso en llamadas HTTP externas
 AND el token descifrado NO se persiste en ningún log ni respuesta de API
```

**R1-3 — Refresh descifra y vuelve a cifrar**

```
GIVEN una Integration con accessToken cifrado y expiresAt en el pasado
  AND refreshToken cifrado presente
WHEN se llama getAccessToken(integration) detecta expiración
THEN el sistema descifra refreshToken antes de enviarlo al tokenUrl del proveedor
 AND si el proveedor devuelve nuevo accessToken:
     el sistema cifra el nuevo accessToken antes de persistirlo
     y si el proveedor devuelve nuevo refreshToken (rotación), también lo cifra
 AND getAccessToken devuelve el nuevo accessToken en texto plano
```

**R1-4 — Migración idempotente de tokens existentes**

```
GIVEN una tabla Integration con algunas filas con tokens en texto plano
  AND otras filas con tokens ya cifrados (JSON con claves iv/authTag/data)
WHEN se ejecuta el script de migración
THEN las filas con tokens en texto plano son cifradas
 AND las filas que ya contienen JSON de EncryptedPayload NO son modificadas
 AND el script termina indicando cuántas filas fueron migradas
```

**R1-5 — API nunca expone tokens completos**

```
GIVEN cualquier endpoint que devuelve datos de Integration
WHEN el cliente realiza una petición GET
THEN la respuesta NO incluye accessToken ni refreshToken (ni cifrados ni en claro)
 AND la respuesta PUEDE incluir metadatos de cuenta (email, workspace name) si están en metadata
```

---

## R2 — Google unificado (Calendar + Gmail)

El proveedor `google` MUST reemplazar a los proveedores separados `gmail` y `calendar`.

**R2-1 — Proveedor `google` con scopes unificados**

```
GIVEN la configuración del proveedor google con GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET
WHEN el cliente inicia el flujo OAuth llamando GET /api/oauth/google?agentId=...
THEN authorizationUrl genera una URL hacia accounts.google.com con:
     scope que incluye https://www.googleapis.com/auth/gmail.modify
     Y https://www.googleapis.com/auth/calendar
     Y access_type=offline y prompt=consent para garantizar refresh token
 AND el state contiene el agentId
```

**R2-2 — Callback crea Integration con provider=google**

```
GIVEN el usuario autoriza en Google y el callback recibe el code
WHEN handleCallback(provider="google", code, agentId) procesa la respuesta
THEN se crea o actualiza una Integration con provider="google"
 AND se almacena email de la cuenta Google en metadata si la respuesta lo provee
 AND accessToken y refreshToken se cifran antes de persistir
```

**R2-3 — Migración de filas gmail/calendar a google**

```
GIVEN filas Integration con provider="gmail" o provider="calendar" para un mismo agentId
WHEN se ejecuta el script de migración de proveedores
THEN se conserva UNA Integration con provider="google" por agentId
 AND el refreshToken conservado es el más reciente entre las filas
 AND las filas gmail y calendar originales son eliminadas
```

---

## R3 — Notion como nuevo proveedor

El sistema MUST añadir `notion` al catálogo `PROVIDERS` de `oauth.ts`. Notion usa OAuth 2.0 con token de larga duración (sin expiración, sin refresh token).

**R3-1 — Configuración del proveedor Notion**

```
GIVEN NOTION_CLIENT_ID y NOTION_CLIENT_SECRET configurados
WHEN el usuario completa el flujo OAuth de Notion
THEN el sistema intercambia el code por accessToken
 AND persiste Integration con provider="notion", accessToken cifrado
 AND refreshToken es NULL (Notion no emite refresh tokens)
 AND expiresAt es NULL (el token de Notion no caduca)
 AND metadata incluye workspace_name y workspace_id si la respuesta los provee
```

**R3-2 — getAccessToken con proveedor sin expiración**

```
GIVEN una Integration con provider="notion" y expiresAt=NULL
WHEN se llama getAccessToken(integration)
THEN el sistema descifra y devuelve accessToken sin intentar refresh
```

**R3-3 — Acciones de Notion mínimas disponibles**

Mapeo en catálogo de servicios para `notion`:
- `create_page` — crear una página en un database
- `append_block` — agregar bloques de contenido a una página
- `query_database` — consultar filas de un database

(Implementación funcional corresponde a fases posteriores; P2 requiere únicamente que la conexión OAuth sea posible.)

---

## R4 — Refresh automático transparente

El sistema MUST renovar el `accessToken` expirado antes de usarlo, de forma transparente para quien llame a `getAccessToken`.

**R4-1 — Renovación al detectar expiración**

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
     actualiza expiresAt
     devuelve el nuevo accessToken en texto plano
```

**R4-2 — Proveedor sin refresh (Slack bot tokens, Notion)**

```
GIVEN una Integration con provider que no rota tokens
WHEN se llama getAccessToken(integration)
THEN el sistema NO intenta refresh si refreshToken es NULL
 AND devuelve el accessToken descifrado directamente
```

**R4-3 — Fallo de refresh → estado reauth_required**

```
GIVEN una Integration con refreshToken cifrado pero el token ha sido revocado
WHEN el sistema intenta el refresh y el proveedor responde con invalid_grant
THEN el sistema actualiza Integration con estado = "reauth_required"
 AND getAccessToken lanza un error tipado que el caller puede detectar
 AND la UI refleja el estado "reauth_required" con llamada a acción para reconectar
```

**R4-4 — Fallo de red durante refresh**

```
GIVEN que el tokenUrl del proveedor no responde (timeout o error de red)
WHEN el sistema intenta el refresh
THEN getAccessToken devuelve el accessToken antiguo (posiblemente expirado)
     o lanza error según la severidad
 AND el error se registra en logs del backend
 AND la Integration NO se marca como reauth_required (es fallo transitorio)
```

---

## R5 — Estado de conexiones OAuth en la UI

La pestaña Integraciones MUST mostrar el estado de las conexiones OAuth para todos los proveedores.

**R5-1 — Proveedor conectado**

```
GIVEN una Integration activa con provider="google"
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra una card "Google" con estado "Conectado"
 AND muestra el email o nombre de cuenta de metadata si está disponible
 AND muestra el botón "Desconectar"
 AND NO muestra el accessToken
```

**R5-2 — Proveedor desconectado**

```
GIVEN que no existe Integration con provider="google"
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra una card "Google" con estado "Desconectado"
 AND muestra el botón "Conectar"
```

**R5-3 — Proveedor con reauth_required**

```
GIVEN una Integration con estado reauth_required
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra la card con estado "Requiere reconexión"
 AND muestra el botón "Volver a conectar"
```

**R5-4 — Proveedores fase inicial vs fase posterior**

Fase inicial (conectables): `google`, `slack`, `notion`

Fase posterior (próximamente): `jira`, `instagram`

```
GIVEN que el usuario navega a la pestaña Integraciones
WHEN la UI renderiza el panel OAuth
THEN los proveedores google, slack y notion muestran botón "Conectar" / "Desconectar"
 AND los proveedores jira e instagram muestran etiqueta "Próximamente"
 AND la UI NO redirige a flujo OAuth para jira o instagram
```

**R5-5 — Desconexión desde la UI**

```
GIVEN una Integration activa para provider="slack"
WHEN el usuario pulsa "Desconectar" y confirma
THEN el frontend llama DELETE /api/integrations con { agentId, provider: "slack" }
 AND la UI actualiza el estado a "Desconectado" sin recargar
```

---

## R6 — Mapeo SERVICES → conexiones OAuth

El catálogo `SERVICES` MUST indicar para cada servicio si requiere una conexión OAuth y cuál es su estado en el agente actual.

**R6-1 — Tabla service → provider**

El backend MUST exponer una tabla canónica que mapee cada `service` del catálogo al `provider` OAuth correspondiente:

| service | provider OAuth |
|---|---|
| `google_calendar` | `google` |
| `gmail` | `google` |
| `slack` | `slack` |
| `notion` | `notion` |
| `jira` | `jira` |
| `instagram` | `instagram` |

Esta tabla MUST ser la única fuente de verdad.

**R6-2 — Aviso al seleccionar servicio sin conexión**

```
GIVEN un agente sin Integration de provider="google"
  AND el usuario selecciona la acción "Crear evento de Calendar" en AutomationsPanel
WHEN AutomationsPanel resuelve el servicio contra el mapa service→provider
THEN la UI muestra un aviso: "Este servicio requiere conectar Google"
 AND muestra un enlace que navega a la pestaña Integraciones
 AND la acción NO puede guardarse sin la conexión
```

**R6-3 — Servicio próximamente (jira / instagram)**

```
GIVEN el usuario selecciona una acción de servicio=jira o service=instagram
WHEN AutomationsPanel verifica el estado
THEN la UI muestra el aviso "Este servicio estará disponible próximamente"
 AND el campo de acción queda deshabilitado
```

**R6-4 — Validación backend al usar automatización**

```
GIVEN una Automation con config.service="slack" para agentId=A1
  AND NO existe Integration con provider="slack" y agentId=A1
WHEN el motor de automatizaciones intenta ejecutar la automatización
THEN el motor detecta la ausencia de conexión
 AND marca la AutomationRun con status="skipped" o status="error"
 AND NO intenta llamar a ninguna API externa
```

---

## R7 — Seguridad del flujo OAuth

**R7-1 — Parámetro `state` anti-CSRF**

```
GIVEN que el usuario inicia un flujo OAuth
WHEN authorizationUrl genera la URL
THEN el parámetro state MUST contener un valor vinculado al agentId
 AND el state no expone información sensible en texto plano
```

**R7-2 — Validación de redirect URI**

```
GIVEN el callback OAuth en GET /api/oauth/:provider/callback
WHEN el sistema procesa el code
THEN el sistema MUST enviar el mismo redirect_uri registrado en el proveedor
 AND si el provider no está en PROVIDERS, devuelve HTTP 400
```

**R7-3 — Secrets solo en variables de entorno**

```
GIVEN el código fuente de back/src/lib/integrations/oauth.ts
WHEN se audita la configuración
THEN NINGÚN clientId ni clientSecret MUST estar hardcodeado
 AND todos los valores se leen de process.env en tiempo de ejecución
 AND si un clientId está vacío, authorizationUrl lanza error
```

**R7-4 — Manejo del callback con error de usuario (deny)**

```
GIVEN que el usuario hace clic en "Denegar" en la pantalla de autorización
WHEN el proveedor redirige al callback con parámetro error=access_denied
THEN el backend detecta el error
 AND redirige al frontend con: {FRONT_URL}/agents/{agentId}?tab=integraciones&error=oauth_cancelled
 AND NO crea ninguna Integration
```

---

## Casos borde

**CB-1 — Revocación externa del token**

```
GIVEN una Integration activa con provider="google"
  AND el usuario revoca el acceso desde su cuenta Google
WHEN el sistema intenta usar el token
THEN la llamada al tokenUrl devuelve invalid_grant
 AND el sistema actualiza la Integration a estado reauth_required
 AND la siguiente carga de la UI muestra "Requiere reconexión"
```

**CB-2 — Agente eliminado (cascade)**

```
GIVEN un Agent con Integrations activas
WHEN se elimina el Agent
THEN el cascade de Prisma elimina todas las Integrations automáticamente
```

**CB-3 — Múltiples agentes conectando el mismo workspace**

```
GIVEN dos agentes agentId=A1 y agentId=A2
  AND ambos se conectan a la misma cuenta de Slack
WHEN se crean las Integrations
THEN A1 tiene su propia fila Integration(agentId=A1, provider=slack)
 AND A2 tiene su propia fila Integration(agentId=A2, provider=slack)
 AND las dos filas son independientes
```

---

## Endpoints afectados

| Método | Ruta | Cambio |
|---|---|---|
| GET | `/api/oauth/:provider` | Añadir provider `google`, `notion` |
| GET | `/api/oauth/:provider/callback` | Cifrado y manejo de `error` |
| DELETE | `/api/integrations` | Ya existe |
| GET | `/api/integrations/:agentId` | Nuevo — devuelve lista de integraciones con estado |

Contrato de `GET /api/integrations/:agentId`:

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

Valores de `status`: `"connected"` | `"reauth_required"` | `"disconnected"`.

---

## Fuera de alcance

- Implementación funcional de Jira e Instagram.
- Gestión de scopes incrementales por acción.
- Rotación automática de `CHANNEL_ENCRYPTION_KEY`.
- Publicación pública de la OAuth App.

---

## Technical Debt

**P3 — Test auth /execute**

- [ ] Auth de endpoint `/execute` con supertest real (actualmente solo asserts inline).
- Estimated effort: 12h. Priority: medium.

---

## Implementation Status

- [x] Cifrado de tokens (`crypto.ts` reutilizado)
- [x] Google unificado (Calendar + Gmail)
- [x] Notion provider
- [x] Refresh automático con rotación de tokens
- [x] Migración idempotente de tokens en claro
- [x] UI de estado por proveedor
- [x] Mapeo SERVICES → conexiones
- [x] Vitest coverage (78 tests)
- [ ] Supertest para auth de `/execute` (P3)
