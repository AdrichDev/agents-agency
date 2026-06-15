# Spec — API Foundations (error & validation)

## Requirement: Error tipado HttpError

El backend DEBE ofrecer una clase `HttpError` con `status` (number), y `code` y
`details` opcionales, para que cualquier capa lance errores con semántica HTTP.

### Scenario: Lanzar un error con status
- **WHEN** un handler lanza `new HttpError(404, "Cliente no encontrado")`
- **THEN** el `errorHandler` responde con status `404` y mensaje `"Cliente no encontrado"`

## Requirement: Captura de errores async

El backend DEBE ofrecer `asyncHandler(fn)` que envuelva handlers async y reenvíe
cualquier error (rechazo de promesa o `throw`) al manejador central, sin colgar
la petición.

### Scenario: Handler async que lanza
- **WHEN** un handler envuelto en `asyncHandler` lanza una excepción
- **THEN** el error llega al `errorHandler` (no queda la petición colgada)
- **AND** el cliente recibe una respuesta de error

## Requirement: Validación con Zod uniforme

El backend DEBE ofrecer helpers de validación (`body`/`query`/`params`) sobre
esquemas Zod. Ante datos inválidos DEBEN lanzar `HttpError(400)` con
`code: "VALIDATION_ERROR"` y `details` derivados del error de Zod.

### Scenario: Body inválido
- **WHEN** llega un body que no cumple el esquema
- **THEN** la respuesta es `400` con `code: "VALIDATION_ERROR"` y `details` con los
  campos que fallan
- **AND** `error` es un mensaje legible (string)

## Requirement: Envelope de error consistente

El `errorHandler` DEBE responder con la forma
`{ error: string, code?, details?, requestId }`. El campo `error` DEBE ser siempre
un string (compatibilidad con el front). En respuestas `5xx` NO DEBE incluir
`code`/`details` ni detalles internos.

### Scenario: Error de cliente (4xx)
- **WHEN** se lanza un `HttpError(400, msg, code, details)`
- **THEN** la respuesta incluye `error` (string), `code`, `details` y `requestId`

### Scenario: Error interno (5xx)
- **WHEN** un handler lanza un error sin status (p. ej. fallo de Prisma)
- **THEN** la respuesta es `500` con `error` genérico y `requestId`, sin `details`

## Requirement: Router clients como referencia

El router `clients` DEBE usar `asyncHandler` + `validate` + `HttpError`,
manteniendo el comportamiento observable (mismas rutas y semántica), y mapeando
el borrado de un cliente inexistente a `404`.

### Scenario: Borrar cliente inexistente
- **WHEN** se hace `DELETE /api/clients/:id` con un id que no existe (Prisma `P2025`)
- **THEN** la respuesta es `404`, no `500`
