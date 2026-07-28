# Spec ? Facturas autom?ticas desde presupuestos aceptados

## UC-1 ? Generaci?n autom?tica de factura
**GIVEN** un presupuesto v?lido que todav?a no tiene factura asociada
**WHEN** su estado cambia a `aceptada`
**THEN** el sistema DEBE crear una ?nica factura vinculada a ese presupuesto y dejarla en estado `pendiente`.

- AC-1.1 La relaci?n con el presupuesto DEBE persistirse por `budgetId` o el campo relacional equivalente.
- AC-1.2 La creaci?n DEBE ser idempotente ante reintentos o reprocesos.

## UC-2 ? Pantalla de facturas sin alta manual
**GIVEN** que el usuario navega a `Facturas`
**WHEN** se carga la p?gina
**THEN** la UI DEBE mostrar el mismo patr?n visual que `Facturaci?n`, con listado, filtros y acci?n `Ver / Imprimir`, pero SIN bot?n `+ Nueva factura`.

- AC-2.1 Si no existen facturas, la UI DEBER?A mostrar un estado vac?o explicando que nacen al aceptar presupuestos.
- AC-2.2 La pantalla NO DEBE permitir crear facturas desvinculadas de un presupuesto aceptado.

## UC-3 ? Documento imprimible de factura
**GIVEN** una factura generada desde un presupuesto
**WHEN** el usuario abre `Ver / Imprimir`
**THEN** el documento DEBE reutilizar la estructura actual y cambiar la terminolog?a visible a factura.

- AC-3.1 El encabezado visible DEBE mostrar `FACTURA`.
- AC-3.2 `Fecha presupuesto` DEBE pasar a `Fecha factura`.
- AC-3.3 El n?mero visible DEBE seguir el formato `FAC - ...`.

## UC-4 ? M?tricas y estados autom?ticos
**GIVEN** un conjunto de facturas persistidas
**WHEN** se renderiza la pantalla `Facturas`
**THEN** el sistema DEBE calcular autom?ticamente `Facturas`, `Pendientes de cobro`, `Importe total`, `Importe cobrado` e `Importe pendiente de cobro`.

- AC-4.1 Los estados visibles DEBEN limitarse a `pendiente` y `cobrada`.
- AC-4.2 Los importes DEBEN derivarse de datos persistidos, no de c?lculos manuales en cliente.

