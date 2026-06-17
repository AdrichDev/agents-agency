# Tasks — oauth-integrations

Orden: back providers → back cifrado/migración → back refresh → front UI/mapeo → tests.
Dependencia: la utilidad `back/src/lib/crypto.ts` proviene de `telegram-whatsapp-bots`.

## 1. Providers OAuth (back)

- [x] 1.1 En `back/src/lib/integrations/oauth.ts`, unificar Google: provider
      `google` con scopes Calendar + Gmail; mapear/deprecar `gmail` y `calendar`.
- [x] 1.2 Añadir provider `notion` (authUrl, tokenUrl, scopes, intercambio de token).
- [x] 1.3 Documentar `jira` e `instagram` como fase posterior (comentario + docs),
      sin habilitarlos en la UI conectable.
- [x] 1.4 Actualizar `back/.env.example` con GOOGLE_*, SLACK_*, NOTION_* y nota de jira/instagram.

## 2. Cifrado de tokens (back)

- [x] 2.1 Cifrar `accessToken`/`refreshToken` con `crypto.ts` en el upsert de
      `handleCallback` (Integration). Wrapper enc:v1: implementado.
- [x] 2.2 Descifrar en `getValidToken` antes de usar/refrescar.
- [x] 2.3 Script TS idempotente `back/scripts/encrypt-tokens.ts` con backup obligatorio.
      SQL `back/prisma/migrate-integration-status.sql` para columna status + unificación google.
- [x] 2.4 Test unitario: enc:v1: roundtrip + idempotencia + passthrough legacy.

## 3. Refresh y robustez (back)

- [x] 3.1 Ajustar `getValidToken` a rotación de refresh token de Google + lock anti-carrera.
- [x] 3.2 No intentar refresh donde no aplica (Slack/Notion: supportsRefresh=false).
- [x] 3.3 Manejo de error: invalid_grant → status "reauth_required" + ReauthRequiredError;
      red caída → devuelve token viejo sin marcar reauth.

## 4. Mapeo SERVICES → conexiones (back + front)

- [x] 4.1 Tabla canónica `back/src/lib/integrations/service-map.ts` con
      SERVICE_TO_PROVIDER y LOGICAL_TO_PHYSICAL (fuente única).
- [x] 4.2 `automations/engine.ts`: validar provider conectado según el `service`
      del config de la automatización usando SERVICE_TO_PROVIDER.
- [x] 4.3 Front: en `AutomationsPanel.tsx`, deshabilitar/avisar acciones cuyo
      servicio no esté conectado en el agente (avisos R6-2-a/b/c).

## 5. Frontend — estado de integraciones (front)

- [x] 5.1 `IntegrationsPanel.tsx` rediseñado: carga GET /api/integrations/:agentId/status;
      cards para google, slack, notion, jira (próximamente), instagram (próximamente).
- [x] 5.2 Botón "Conectar" → OAuth; botón "Desconectar" → DELETE; "Volver a conectar" para reauth_required.
- [x] 5.3 Mostrar accountLabel (email Google, team Slack, workspace Notion) cuando exista.
- [x] 5.4 Jira/Instagram marcados como "Próximamente" con botón deshabilitado.

## 6. Tests

- [x] 6.1 Vitest back: enc:v1: roundtrip + idempotencia (isEncrypted, decryptToken legacy).
- [x] 6.2 Vitest back: state store TTL + un solo uso + nonce inexistente/expirado.
- [x] 6.3 Vitest back: LOGICAL_TO_PHYSICAL + SERVICE_TO_PROVIDER (service-map).
- [x] 6.4 Vitest back: supportsRefresh por proveedor, lógica de refresh/invalid_grant/red.
- [x] 6.5 `cd back && npm test`: 78 tests, 9 suites — todo verde.
      `cd front && npm run build`: compilado limpio.
