# Validation: aa-conversion-tenant-transaccional

## Historia de usuario

Como operador de la plataforma, quiero que la conversión de contacto/lead a tenant sea
atómica, para que un fallo a mitad no deje tenants huérfanos ni permita duplicados al
reintentar.

## Criterios de aceptación

- AC1: si el update del origen (contacto/lead) falla, el tenant creado en la misma
  operación NO persiste (rollback).
- AC2: reintento tras fallo parcial NO produce tenant duplicado: la conversión completa
  se aplica una sola vez.
- AC3: contrato HTTP intacto: mismos status codes y payloads que hoy (302 confirmación,
  201/200 éxito, 404, 409 already_converted, 500 error).
- AC4: `withCodeRetry` sigue cubriendo la colisión de código `cli-NN` (P2002) y ahora
  reintenta la transacción completa.
- AC5: tests existentes de los 3 handlers siguen verdes.

## Escenario Given-When-Then

- Given un contacto activo sin convertir y un mock de prisma donde `prospectContact.update`
  lanza error
- When llamo a `POST /contactos/:id/convertir` con confirmación
- Then responde 500, y no existe ningún tenant nuevo (create revertido); un segundo
  intento con update funcional convierte normalmente sin duplicar.

## Tests por tarea

| Tarea | Test | Estado |
|---|---|---|
| T1 convertirContactoHandler transaccional | fallo parcial → rollback (mock $transaction) | verde |
| T2 convertirLeadHandler transaccional | ídem para lead | verde |
| T3 convertToClientsHandler transaccional | ídem por elemento del loop; `failed[]` se mantiene | verde |
| T4 regresión | suites existentes service-operator*.test.ts y contacts verdes | verde |
