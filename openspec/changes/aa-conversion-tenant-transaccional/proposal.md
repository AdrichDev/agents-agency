# Proposal: aa-conversion-tenant-transaccional

## Problema

Tres flujos de conversión en `agents-agency/back` crean un Tenant y actualizan el origen
(contacto/lead) como escrituras SUELTAS, sin `$transaction`:

1. `convertirContactoHandler` — `src/routes/service-operator.ts:608-692`:
   `tenant.create` (dentro de `withCodeRetry`, línea 651) y luego
   `prospectContact.update` (línea 668) en round-trips independientes.
2. `convertirLeadHandler` — `src/routes/service-operator.ts:204-216`: mismo patrón
   con `lead.update`.
3. `convertToClientsHandler` — `src/routes/contacts.ts:196-248`: create + update en
   loop con `failed[]` y sin rollback.

Fallo entre create y update → tenant huérfano con código `cli-NN` asignado, contacto
sigue activo (`tenantId=null`), y el reintento pasa la guarda `already_converted` y crea
un SEGUNDO tenant duplicado. El catch solo loguea y devuelve 500 — no revierte.

## Solución

Envolver cálculo de código + `tenant.create` + update del origen en un
`prisma.$transaction` (callback), DENTRO de `withCodeRetry` — regla ya establecida en
[aa-codigos-race-retry]: el retry envuelve cálculo+create juntos; ahora envuelve la
transacción completa. Patrón de referencia correcto en el propio repo:
`src/routes/booking.ts:83-113` y `:188-197`.

`writeOperatorAudit` (fire-and-forget) queda FUERA de la transacción — auditoría no
bloqueante, comportamiento actual intencional.

## Alcance

- `src/routes/service-operator.ts` (2 handlers).
- `src/routes/contacts.ts` (1 handler).
- Tests: los existentes con prisma mockeado deben seguir verdes (ajustar mocks a
  `$transaction`) + test nuevo de fallo parcial por handler (update falla → no queda
  tenant creado).

## Fuera de alcance

- Cambios de contrato HTTP (status codes y payloads intactos).
- Auditoría transaccional.
