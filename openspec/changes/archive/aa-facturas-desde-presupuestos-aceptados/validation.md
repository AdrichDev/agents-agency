# Validaci?n ? aa-facturas-desde-presupuestos-aceptados

Historia: como usuario de Agents Agency quiero que una factura se genere sola al aceptar un
presupuesto, para no duplicar trabajo manual y poder cobrar con un documento comercial correcto.

## Criterios de aceptaci?n (AC)
- **AC1:** al pasar un presupuesto a `aceptada`, se crea exactamente una factura vinculada a ese presupuesto.
- **AC2:** la nueva pantalla `Facturas` replica la experiencia visual de `Facturaci?n`, pero sin bot?n `+ Nueva factura`.
- **AC3:** el documento visible e imprimible usa terminolog?a de factura: `FACTURA`, `Fecha factura` y n?mero `FAC - ...`.
- **AC4:** el estado visible de la factura es `pendiente` o `cobrada`, y los indicadores se calculan autom?ticamente.
- **AC5:** reaceptar o reprocesar un presupuesto aceptado no genera facturas duplicadas.

## Por tarea (Dado-Cuando-Entonces + test)
- **A.1-A.3 modelo y migraci?n** ? **DADO** un presupuesto persistido, **CUANDO** se aplica la migraci?n, **ENTONCES** existe una factura relacionada por `budgetId` o equivalente con unicidad suficiente para evitar duplicados. Test: migraci?n + esquema.
- **B.1-B.3 creaci?n autom?tica** ? **DADO** un presupuesto sin factura, **CUANDO** su estado cambia a `aceptada`, **ENTONCES** se crea una ?nica factura en estado `pendiente`. Test: API/e2e de aceptaci?n.
- **B.4 idempotencia** ? **DADO** un presupuesto ya facturado, **CUANDO** se reprocesa la aceptaci?n, **ENTONCES** la factura existente se reutiliza y no se duplica. Test: regresi?n de aceptaci?n repetida.
- **C.1-C.3 listado y m?tricas** ? **DADO** facturas pendientes y cobradas, **CUANDO** el usuario entra en `Facturas`, **ENTONCES** ve contadores e importes correctos calculados autom?ticamente. Test: UI + agregados.
- **C.4 documento** ? **DADO** una factura existente, **CUANDO** el usuario pulsa `Ver / Imprimir`, **ENTONCES** el documento conserva el layout actual y sustituye todos los textos de presupuesto por factura. Test: snapshot/UI documental.

> Regla del repo: una tarea est? DONE solo cuando su test est? verde. Sin spec, no hay implementaci?n v?lida.

