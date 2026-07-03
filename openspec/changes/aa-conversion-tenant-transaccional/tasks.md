# Tasks: aa-conversion-tenant-transaccional

- [x] T1 — `convertirContactoHandler`: `$transaction(código + tenant.create +
      prospectContact.update)` dentro de `withCodeRetry`. Test fallo parcial.
- [x] T2 — `convertirLeadHandler`: mismo tratamiento con `lead.update`. Test.
- [x] T3 — `convertToClientsHandler` (contacts.ts): transacción por elemento del loop,
      `failed[]` conservado. Test.
- [x] T4 — Suites existentes verdes (ajustar mocks de prisma a `$transaction` donde
      haga falta, sin cambiar asserts de contrato HTTP).
