# Spec — HTTP Caching

## Requirement: Utilidad de Cache-Control reutilizable

El backend DEBE ofrecer una utilidad para fijar la cabecera `Cache-Control`:
`setCache(res, opts)` para una respuesta concreta y `cacheControl(opts)` como
middleware de ruta. Las opciones DEBEN soportar `maxAge` (segundos),
`public`/`private` y `staleWhileRevalidate` (segundos).

### Scenario: Construcción de la cabecera
- **WHEN** se usa `setCache(res, { maxAge: 60, public: true, staleWhileRevalidate: 300 })`
- **THEN** la respuesta lleva `Cache-Control: public, max-age=60, stale-while-revalidate=300`

### Scenario: Privado por defecto
- **WHEN** se usa `setCache(res, { maxAge: 30 })` sin `public`
- **THEN** la respuesta lleva `Cache-Control: private, max-age=30`

## Requirement: Caché en la config pública del widget

`GET /api/widget/config` DEBE devolver `Cache-Control: public, max-age=60,
stale-while-revalidate=300` SOLO en respuestas de éxito. Las respuestas de error
NO DEBEN llevar `Cache-Control`.

### Scenario: Config válida
- **WHEN** se pide `GET /api/widget/config?publicKey=...` de un agente existente
- **THEN** responde `200` con la config y `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- **AND** incluye `ETag` (por defecto de Express)

### Scenario: publicKey faltante
- **WHEN** se pide `GET /api/widget/config` sin `publicKey`
- **THEN** responde `400` y NO incluye `Cache-Control`

### Scenario: Revalidación condicional
- **WHEN** el cliente repite la petición con `If-None-Match` igual al `ETag` previo
- **THEN** responde `304 Not Modified` sin cuerpo

## Requirement: Caché en el catálogo de sectores

`GET /api/sectors` DEBE devolver `Cache-Control: private, max-age=30` (privado,
porque va tras autenticación).

### Scenario: Listado de sectores
- **WHEN** se pide `GET /api/sectors`
- **THEN** responde `200` con `Cache-Control: private, max-age=30`
