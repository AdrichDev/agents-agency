# Spec — Security Headers & Supply-chain Audit

## Requirement: Cabeceras de seguridad en el frontend

El frontend (Next.js) DEBE enviar cabeceras de seguridad en todas las respuestas
de ruta: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` y un `Permissions-Policy`
restrictivo (cámara, micrófono y geolocalización deshabilitados).

### Scenario: Respuesta del dashboard con cabeceras
- **WHEN** el navegador solicita cualquier ruta del frontend
- **THEN** la respuesta incluye `X-Frame-Options: SAMEORIGIN`
- **AND** `X-Content-Type-Options: nosniff`
- **AND** `Referrer-Policy: strict-origin-when-cross-origin`
- **AND** `Permissions-Policy` con `camera=()`, `microphone=()`, `geolocation=()`

### Scenario: Clickjacking mitigado
- **WHEN** un sitio externo intenta embeber el dashboard en un iframe
- **THEN** el navegador lo bloquea (`X-Frame-Options: SAMEORIGIN`)

## Requirement: Auditoría de dependencias en CI

El pipeline de CI DEBE ejecutar `npm audit` en los proyectos back y front para
dar visibilidad de CVEs en dependencias. El paso NO DEBE bloquear el pipeline
(informativo) para no generar fallos por vulnerabilidades preexistentes.

### Scenario: Audit informa sin bloquear
- **WHEN** corre el job de CI y `npm audit` encuentra vulnerabilidades
- **THEN** el resultado del audit queda registrado en el log del job
- **AND** el job NO falla por ello (`continue-on-error`)

## Requirement: Higiene de secretos

NINGÚN fichero `.env` con secretos DEBE estar rastreado por git. Solo se permiten
ficheros de ejemplo o con valores públicos (p. ej. `NEXT_PUBLIC_API_URL`).

### Scenario: Sin secretos en el repo
- **WHEN** se listan los ficheros rastreados
- **THEN** no aparece ningún `.env` con credenciales/llaves
- **AND** `back/.env.example` (ejemplo) y `front/.env.local` (solo URL pública)
  son los únicos ficheros tipo env rastreados
