# Spec — WhatsApp Webhook Fail-Closed

## Requirement: Verificación obligatoria de firma en el webhook de WhatsApp

`POST /api/channels/whatsapp/:agentId` DEBE verificar la firma HMAC
(`x-hub-signature-256`) con `META_APP_SECRET` ANTES de procesar el evento. Si la
firma no puede verificarse (secreto ausente, `rawBody` ausente o firma inválida),
DEBE responder `403` sin procesar el mensaje (fail-closed).

### Scenario: Sin secreto configurado
- **WHEN** llega un POST al webhook y `META_APP_SECRET` no está definido
- **THEN** responde `403` y NO procesa el evento

### Scenario: Firma inválida
- **WHEN** llega un POST con `x-hub-signature-256` que no coincide
- **THEN** responde `403`

### Scenario: Firma válida
- **WHEN** llega un POST con firma HMAC válida
- **THEN** se procesa el evento con normalidad
