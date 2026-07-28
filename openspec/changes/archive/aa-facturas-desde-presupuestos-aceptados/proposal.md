# Propuesta ? Facturas desde presupuestos aceptados

**Nivel Gru: 3 ? Alta.** Cambio comercial con impacto en modelo, API, documento y UI.
**Estado: SPEC (aprobado el alcance, pendiente implementaci?n).**

## Contexto
En `agents-agency`, la navegaci?n actual de `Facturaci?n` opera sobre presupuestos. El usuario pidi?
separar `Facturas` como un nav propio, manteniendo la misma experiencia visual de la pantalla actual,
pero sin creaci?n manual: la factura nace sola cuando un presupuesto pasa a `aceptada`.

## Intenci?n
1. Crear una entidad de factura vinculada al presupuesto aceptado por `budgetId` o el campo relacional equivalente.
2. Mostrar una pantalla `Facturas` con la misma base visual que `Facturaci?n`, incluyendo `Ver / Imprimir`.
3. Generar el documento reutilizando la plantilla actual, cambiando la terminolog?a de presupuesto por factura.
4. Calcular autom?ticamente indicadores de cantidad, cobro e importes.

## Decisiones
- La factura se genera **autom?ticamente** al aceptar un presupuesto; no existe bot?n `+ Nueva factura`.
- La relaci?n con el presupuesto debe ser **idempotente**: un presupuesto aceptado no puede generar duplicados.
- El documento mantiene el layout actual, pero sustituye `PRESUPUESTO` por `FACTURA`, `Fecha presupuesto` por `Fecha factura` y el n?mero visible por `FAC - ...`.
- El estado visible inicial es `pendiente`; pasa a `cobrada` cuando se registre el cobro.

## Alcance
- Modelo persistente de factura y relaci?n con presupuesto.
- Creaci?n autom?tica al aceptar presupuesto.
- Listado, m?tricas, estado y documento imprimible de facturas.
- Acci?n `Ver / Imprimir` en la nueva pantalla.

## Fuera de alcance
- Pasarelas de pago, contabilidad externa o conciliaci?n bancaria.
- Alta manual de facturas sin presupuesto origen.
- Backfill masivo de presupuestos hist?ricos ya aceptados.

## Riesgos
- Duplicidad si el cambio de estado se procesa dos veces.
- Mezcla de textos entre presupuesto y factura en el documento.
- Desfase entre m?tricas y estados si no se centraliza el c?lculo en datos persistidos.

## Dependencias
Este cambio debe ejecutarse antes de `aa-navegacion-lateral-agrupada` y antes de `crm-paridad-facturas-pedidos-aa`.

