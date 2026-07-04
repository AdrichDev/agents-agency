# Diseño: Facturas desde presupuestos aceptados

## Enfoque técnico

Crear una capacidad de facturas en Agents Agency derivada de `Budget`. `Budget` sigue siendo la fuente de líneas, snapshots y totales; `Invoice` guarda identidad fiscal, estado de cobro y vínculo 1:1 con el presupuesto aceptado.

## Decisiones de arquitectura

| Decisión | Elección | Alternativas consideradas | Motivo |
|----------|----------|---------------------------|--------|
| Relación factura-presupuesto | `Invoice.budgetId` único hacia `Budget.id`, mapeado a `presupuesto_id` o relación equivalente | Copiar líneas a una tabla propia | Evita divergencia y cumple el requisito de relación por id real del schema. |
| Generación | Crear factura idempotente dentro de `PUT /api/budgets/:id/status` cuando el estado sea `aceptada` | Botón manual en UI | El dominio dice que la factura nace del presupuesto aceptado; hacerlo manual introduce duplicados. |
| Número visual | `FAC - {secuencia o derivado estable}` persistido en factura | Reusar `quoteNumber` | Separa la identidad visual de factura y presupuesto. |
| Estado | `pendiente/cobrada` | Reusar estados de presupuesto | Cobro y aceptación son ciclos de vida distintos. |

## Flujo de datos

    UI Presupuestos ──acepta──> PUT /api/budgets/:id/status
         │                        │
         │                        └── upsert Invoice(budgetId, number, status=pending)
         │
    UI Facturas ──GET──> /api/invoices ──include──> Budget + lines + snapshots
         └── Ver/Imprimir ──> InvoicePreview con la misma estructura visual de `BudgetPreview`, adaptada a factura

## Cambios de archivos

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `agents-agency/back/prisma/schema.prisma` | Modificar | Agregar `Invoice` con relación única a `Budget`. |
| `agents-agency/back/src/routes/budgets.ts` | Modificar | Validar estados conocidos y crear factura al aceptar. |
| `agents-agency/back/src/routes/invoices.ts` | Crear | Listado, detalle, métricas y marcado de cobro. |
| `agents-agency/front/app/facturas/page.tsx` | Crear | Página de facturas sin creación manual. |
| `agents-agency/front/components/facturacion/InvoicePreview.tsx` | Crear | Vista previa imprimible con textos de factura. |
| `agents-agency/front/components/facturacion/types.ts` | Modificar | Tipos `Invoice`, estados e indicadores. |

## Interfaces y contratos

- `GET /api/invoices`: devuelve facturas con presupuesto origen y métricas agregadas.
- `GET /api/invoices/:id`: devuelve una factura imprimible.
- `PUT /api/invoices/:id/status`: permite cambiar `pendiente` a `cobrada` si el producto lo permite.

## Estrategia de pruebas

| Capa | Qué probar | Enfoque |
|------|------------|---------|
| Unidad | Generación de número y métricas | Pruebas de funciones puras o servicio. |
| Integración | Aceptar presupuesto crea factura idempotente | Prueba de ruta con Prisma o base de test. |
| UI | Sin botón crear, métricas y vista previa | Pruebas de componentes y página. |
| Regresión | Los presupuestos siguen muestrando como presupuestos | Prueba de textos en `BudgetPreview`. |

## Migración y despliegue

Requiere migración Prisma. No se hará migración histórica de presupuestos aceptados históricos salvo decisión explícita; la primera versión genera facturas para nuevas aceptaciones.

## Preguntas abiertas

- [ ] Definir si `FAC - ...` debe ser secuencia global, por tenant o derivada de `quoteNumber`.



