# Design — oauth-integrations

Canal objetivo: **oauth**
Fecha: 2026-06-12
Estado: design-ready
Fuente: `proposal.md` + `spec.md` (spec-ready) + código real + contrato `crypto.ts` de P1 (`telegram-whatsapp-bots/design.md`).

---

## 0. Decisiones de arquitectura (ADR resumido)

| ID | Decisión | Alternativa rechazada | Razón |
|---|---|---|---|
| AD1 | `oauth.ts` se refactoriza a `providers/{google,slack,notion,jira}.ts` + `oauth.ts` (orquestador `authorizationUrl`/`handleCallback`/registro) | Mantener archivo único | El archivo crece con notion + lógica de cifrado + metadata por proveedor (userinfo Google, workspace Notion). Cada proveedor tiene parsing de respuesta distinto. Espeja patrón `channels/{telegram,whatsapp}.ts` de P1. Cada archivo < 500 líneas. |
| AD2 | Interfaz común `OAuthProvider`: `authUrl, tokenUrl, scopes, clientId(), clientSecret(), exchangeExtras?, parseTokenResponse(data)→{accessToken,refreshToken?,expiresAt?,metadata,accountLabel}, supportsRefresh` | Config plana actual (`ProviderConfig`) | El parsing actual está hardcodeado dentro de `handleCallback` con `if (provider==="slack")`. No escala. Cada proveedor encapsula su parsing. |
| AD3 | Capa única de tokens `getValidToken(agentId, provider)` en `oauth.ts`. Descifra → refresca si expirado → re-cifra → marca `reauth_required` si falla. TODOS los consumidores pasan por aquí | `getAccessToken(integration)` actual recibe la fila ya cargada | Centraliza descifrado/refresh/estado. `withToken` (executor) y los engines no deben tocar ciphertext ni saber de refresh. SRP. |
| AD4 | **Provider físico `google` ↔ providers lógicos `gmail`/`calendar`**: `withToken("gmail")` y `withToken("calendar")` resuelven a la fila `provider="google"` mediante un mapa `LOGICAL_TO_PHYSICAL` | Renombrar tools a `google` | tools.ts/executor.ts usan claves `gmail`/`calendar` (`TOOLS_BY_PROVIDER`, `withToken`). Renombrarlas rompe todo el catálogo de tools y el system prompt. Mapear es no invasivo. **DISCREPANCIA crítica, ver §10.** |
| AD5 | Columna nueva `Integration.status` (`"connected"`/`"reauth_required"`, default `"connected"`) | `metadata.status` | D-P2-3 confirmada. Explícito, consultable, indexable; el endpoint de estado lo lee sin parsear JSON. Migración SQL `ADD COLUMN` no destructiva. |
| AD6 | Cifrado con envoltura **`enc:v1:<base64>`** sobre `crypto.ts` (`encrypt(plain)→EncryptedPayload`) | Guardar JSON crudo de `EncryptedPayload` | El prefijo `enc:v1:` da detección O(1) de "ya cifrado" (idempotencia de migración) y versionado de formato. El payload va `enc:v1:` + base64(JSON.stringify(payload)). Spec R1-3 pedía parsear JSON; el prefijo es superior y compatible. |
| AD7 | `state` anti-CSRF = nonce aleatorio en **Map TTL en memoria** `{ nonce → { agentId, provider, exp } }`, TTL 10 min | Tabla DB; o `state=agentId` actual | D-P2-2 confirmada (MUST). Coherente con dedup en memoria de P1 (AD4). Flujo OAuth es corto (segundos); reinicio rara vez coincide con un callback en vuelo. Sin migración. |
| AD8 | Endpoint nuevo `GET /api/integrations/:agentId/status` (lista con máscara + estado) | Reusar el include de agent | El front necesita `status` y `accountLabel` por proveedor sin tokens. Endpoint dedicado, contrato del spec §Resumen de endpoints. |
| AD9 | Migración de datos vía **script TS** `back/scripts/encrypt-tokens.ts` (idempotente) + SQL manual `migrate-integration-status.sql` | Endpoint admin | El cifrado necesita la lib `crypto.ts` (TS), no SQL puro. Script aborta sin `CHANNEL_ENCRYPTION_KEY` (R1-3-b). No toca `.env` real. |

---

## 1. Arquitectura de módulos backend

```
back/src/lib/integrations/
  oauth.ts                 # registro PROVIDERS, authorizationUrl, handleCallback,
                           #   getValidToken, state store (Map TTL), enc/dec wrapper
  service-map.ts           # SERVICE_TO_PROVIDER + LOGICAL_TO_PHYSICAL (fuente única, R6-1)
  providers/
    google.ts              # scopes gmail.modify+calendar, parse userinfo→email, supportsRefresh
    slack.ts               # parse team name, supportsRefresh=false (bot token)
    notion.ts              # parse workspace_name/id, no refresh, expiresAt=null
    jira.ts                # existente, mover aquí (fase posterior, conectable=false)
  crypto.ts                # (de P1) encrypt/decrypt AES-256-GCM — SOLO LECTURA
back/scripts/encrypt-tokens.ts   # migración idempotente
```

Responsabilidades (SRP):
- **`providers/*`** — sin Prisma ni Express. Construyen URL, parsean respuesta de token, exponen `parseTokenResponse`. Reciben/devuelven texto plano.
- **`oauth.ts`** — orquesta: cifra antes de persistir (`enc:v1:`), descifra en `getValidToken`, gestiona el state store y el refresh con lock.
- **`service-map.ts`** — único lugar con `SERVICE_TO_PROVIDER` y `LOGICAL_TO_PHYSICAL`; consumido por executor, engines y (vía API/copia tipada) el front.
- **`executor.ts`/engines** — SIN cambio de firma; `withToken(logical)` resuelve a la fila física vía `LOGICAL_TO_PHYSICAL` y llama `getValidToken`.

---

## 2. Capa de tokens — `getValidToken`

```ts
// oauth.ts
async function getValidToken(agentId: string, provider: string): Promise<string>;
// 1. find Integration(agentId, physicalProvider)  → si no, throw IntegrationMissingError
// 2. decryptToken(accessToken) (descifra enc:v1:)
// 3. si expiresAt vencido (margen 60s) y supportsRefresh y refreshToken:
//      lock por clave `${agentId}:${provider}` (Map<string,Promise>) anti-carrera
//      POST tokenUrl grant_type=refresh_token (refreshToken descifrado)
//      ok  → re-cifra nuevo access (+ refresh si rota), update expiresAt, status="connected"
//      invalid_grant → update status="reauth_required", throw ReauthRequiredError
//      error de red → log, devuelve token viejo (transitorio, NO marca reauth) [R4-2-b]
// 4. devuelve texto plano (nunca se loguea)
```

Lock simple: `Map<string, Promise<string>>`; segunda llamada concurrente reusa la promesa en vuelo (evita doble refresh / rotación perdida en Google).

---

## 3. Cifrado — wrapper `enc:v1:`

```ts
// oauth.ts (helpers privados sobre crypto.ts)
encryptToken(plain: string): string   // "enc:v1:" + base64(JSON.stringify(encrypt(plain)))
decryptToken(stored: string): string  // si empieza por "enc:v1:" → decrypt; si no → texto plano (legacy)
isEncrypted(v: string): boolean       // v.startsWith("enc:v1:")
```

- `handleCallback` persiste `accessToken`/`refreshToken` ya envueltos.
- Sin `CHANNEL_ENCRYPTION_KEY` → callback responde **500 `{ error: "Configuración de cifrado incompleta" }`** (R1-4), no persiste texto plano.
- API nunca devuelve tokens (cifrados ni claros) — solo `accountLabel`/`status` (R1-5).

---

## 4. Contratos API REST

| Método | Ruta | Cambio |
|---|---|---|
| `GET` | `/api/oauth/:provider` | Genera nonce, guarda `{agentId,provider}` en state store, redirige con `state=nonce`. Añade `google`, `notion`. |
| `GET` | `/api/oauth/:provider/callback` | Valida `state` contra store (consume nonce), maneja `error=access_denied`, cifra y persiste. |
| `DELETE` | `/api/integrations` | Existente; revoke si el proveedor lo soporta (Google revoke endpoint), luego borra fila. |
| `GET` | `/api/integrations/:agentId/status` (nuevo) | Lista `[{provider,status,accountLabel}]`, sin tokens (R5-1). |

`status` ∈ `"connected" | "reauth_required" | "disconnected"` (derivado: sin fila → `disconnected`).

---

## 5. Flujo state anti-CSRF

```
GET /api/oauth/google?agentId=A1
  → nonce = randomHex(16); stateStore.set(nonce, {agentId:A1, provider:google, exp:now+10min})
  → redirect authUrl?...&state=nonce
... usuario autoriza ...
GET /api/oauth/google/callback?code=...&state=nonce
  → entry = stateStore.take(nonce)   // get + delete (un solo uso)
  → si !entry || expirado → redirect FRONT?tab=integraciones&error=invalid_state  (CB-4)
  → si error=access_denied            → redirect ...&error=oauth_cancelled        (R7-5)
  → handleCallback(entry.provider, code, entry.agentId)
```

Limpieza perezosa del Map al insertar (purga expirados). Reutiliza patrón TTL de `channels/dedup.ts` (P1).

---

## 6. Migración de datos — secuencia de despliegue

Orden seguro (no destructivo primero, destructivo al final):

1. **Schema**: editar `Integration` → añadir `status String @default("connected")`. SQL manual `back/prisma/migrate-integration-status.sql` (`ALTER TABLE ... ADD COLUMN`). `prisma generate`.
2. **Unificación google** (D-P2-1): por cada `agentId` con filas `gmail`/`calendar`, crear/actualizar fila `provider="google"` conservando el `refreshToken` más reciente (mayor `createdAt`); luego eliminar las filas `gmail`/`calendar`. Incluido en `migrate-integration-status.sql` o sub-script. Respeta `@@unique([agentId,provider])` (R2-2-b).
3. **Cifrado** (`encrypt-tokens.ts`): recorre todas las filas; si `accessToken`/`refreshToken` NO empiezan por `enc:v1:` → cifra y actualiza; si ya `enc:v1:` → no toca. Reporta migradas vs. ya-cifradas. Aborta sin clave (R1-3-b).

Rollback: `status` es `DROP COLUMN`; el cifrado no cambia el schema. La unificación google NO es reversible (filas borradas) → backup de la tabla antes del paso 2.

---

## 7. Frontend — pestaña Integraciones

Rediseño de `front/components/IntegrationsPanel.tsx`: carga `GET /api/integrations/:agentId/status`; card por proveedor con estado real.

| Estado | UI |
|---|---|
| `disconnected` | "Conectar" → `GET /api/oauth/:provider?agentId=` |
| `connected` | badge verde + `accountLabel` (email/workspace/team) + "Desconectar" |
| `reauth_required` | badge ámbar "Requiere reconexión" + "Volver a conectar" (sin "Desconectar") (R5-1-c) |

Proveedores: fase inicial `google, slack, notion` (conectables); `jira, instagram` con etiqueta "Próximamente" y botón deshabilitado (R5-2). Convive con `ChannelConnectPanel` de P1 (mismo tab).

**Mapeo SERVICES** (`AutomationsPanel.tsx`): al elegir un `service`, resolver `SERVICE_TO_PROVIDER[service]` y cruzar con el estado de conexión del agente:
- provider no conectado → aviso "Requiere conectar {X} en Integraciones" + enlace; guardar deshabilitado (R6-2-a).
- `reauth_required` → "La conexión con {X} requiere reconexión" (R6-2-b).
- `jira`/`instagram` → "Disponible próximamente", deshabilitado (R6-2-c).

Backend (R6-3): `automations/engine.ts` valida `config.service` → `SERVICE_TO_PROVIDER` → fila `connected`; si falta, `AutomationRun.status="skipped"` con mensaje, sin llamar API externa.

---

## 8. Variables de entorno

| Variable | ¿Existe? | Propósito |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sí (oauth.ts) | Flujo google unificado |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Sí | Slack |
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | **Nuevo** | Notion |
| `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET` | Sí | Fase posterior |
| `CHANNEL_ENCRYPTION_KEY` | De P1 | **Reutilizada** para cifrar tokens OAuth |
| `BACK_URL` | Sí | `redirectUri` callback (sin cambio) |

Actualizar `back/.env.example` con `NOTION_*` y nota jira/instagram. Documentar registro de apps en `docs/SETUP-OAUTH.md` (CB-5).

---

## 9. Estrategia de tests (Vitest back, sin red real)

| Capa | Qué | Cómo |
|---|---|---|
| Unit | state store TTL | `take` consume nonce; expirado → null; reloj mockeable |
| Unit | wrapper `enc:v1:` | `decryptToken(encryptToken(x))===x`; valor sin prefijo → legacy passthrough; `isEncrypted` |
| Unit | máscara API | `/status` nunca incluye `accessToken`/`refreshToken` |
| Unit | refresh google | mock `fetch`: 200 rota refresh → re-cifra; `invalid_grant` → `reauth_required`+throw; red caída → token viejo, sin marcar |
| Unit | `supportsRefresh=false` | slack/notion: `getValidToken` no llama tokenUrl |
| Unit | service-map | `SERVICE_TO_PROVIDER` y `LOGICAL_TO_PHYSICAL` (gmail/calendar→google) |
| Unit | migración | `encrypt-tokens` idempotente: cifra plano, ignora `enc:v1:`; aborta sin clave |
| E2E | front | Playwright: render connected/disconnected/reauth con backend mockeado |

Gate: `cd back && npm test` y `cd front && npm run build` en verde.

---

## 10. Riesgos / cuestiones abiertas

1. **DISCREPANCIA CRÍTICA spec↔código** (AD4): el spec unifica a provider `google`, pero `tools.ts` (`TOOLS_BY_PROVIDER.gmail/.calendar`), `executor.ts` (`withToken("gmail"/"calendar")`) y `agent/engine.ts` (`toolsForProviders(providers)`) dependen de las claves lógicas `gmail`/`calendar`. **Decisión de diseño**: NO renombrar tools; introducir `LOGICAL_TO_PHYSICAL = { gmail:"google", calendar:"google", slack:"slack", notion:"notion", jira:"jira" }`. `withToken` y `toolsForProviders` expanden la fila física `google` a las claves lógicas `gmail`+`calendar`. Confirmar con humano antes de implementar.
2. **Dependencia dura de P1**: `crypto.ts` lo entrega P1 en paralelo. Las tareas de cifrado (§3, §6 paso 3) NO pueden ejecutarse hasta que `back/src/lib/crypto.ts` exista con la firma `encrypt(plain)→EncryptedPayload`/`decrypt`.
3. **State en memoria**: reinicio del proceso invalida flujos OAuth en vuelo (usuario debe reintentar). Aceptable; ventana de segundos. Si se observa fricción, promover a tabla.
4. **Unificación google irreversible**: paso 2 de migración borra filas. Backup obligatorio antes de desplegar.
5. **Revoke en disconnect**: solo Google expone endpoint de revoke; Slack/Notion solo borran fila local (token sigue válido en el proveedor hasta revocación manual). Documentar.
6. **Tamaño de `oauth.ts`**: tras añadir state store + cifrado + getValidToken, vigilar el límite de 500 líneas; mover state store a `oauth-state.ts` si excede.
