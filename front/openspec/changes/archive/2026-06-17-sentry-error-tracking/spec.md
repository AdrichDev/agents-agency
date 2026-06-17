# Spec — Sentry Error Tracking

## Requirement: Inicialización guarded por DSN

El backend DEBE inicializar Sentry SOLO si `SENTRY_DSN` está definido. Sin DSN, la
integración DEBE ser un no-op y el arranque NO DEBE fallar.

### Scenario: Sin DSN (local)
- **WHEN** el proceso arranca sin `SENTRY_DSN`
- **THEN** Sentry no se inicializa y se registra un log informativo
- **AND** el arranque y las peticiones funcionan con normalidad

### Scenario: Con DSN
- **WHEN** el proceso arranca con `SENTRY_DSN`
- **THEN** Sentry se inicializa con el environment actual

## Requirement: Captura de errores 5xx

El `errorHandler` central DEBE capturar en Sentry los errores con status `5xx`
(cuando Sentry esté habilitado), adjuntando `requestId` y `status`. NO DEBE
capturar errores de cliente `4xx`.

### Scenario: Error interno capturado
- **WHEN** un handler lanza un error que resulta en `500` y Sentry está habilitado
- **THEN** el error se envía a Sentry con `requestId` y `status`

### Scenario: Error de cliente no capturado
- **WHEN** se lanza un `HttpError(400)`
- **THEN** NO se envía a Sentry
