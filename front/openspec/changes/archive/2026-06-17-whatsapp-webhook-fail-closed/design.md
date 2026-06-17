# Design — WhatsApp Webhook Fail-Closed

## Decisión

### ADR-1 — Fail-closed en la verificación HMAC
Se sustituye el `if (appSecret) {...} else { warn }` (fail-open) por una guarda
única: si `!appSecret || !rawBody || !validateHmacSignature(rawBody, signature,
appSecret)` → `403`. Así ninguna petición sin verificar llega a la lógica de
procesamiento. `META_APP_SECRET` pasa a ser requisito operativo del canal
WhatsApp (documentado).

## Impacto / rollback
Solo el handler del webhook. Sin cambios de datos. Rollback = revertir el commit.
