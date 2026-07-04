# Tareas: Facturas desde presupuestos aceptados

## Previsión de carga de revisión

| Campo | Valor |
|-------|-------|
| Líneas estimadas modificadas | 650-950 |
| Riesgo de superar 400 líneas | Alto |
| PRs encadenadas recomendadas | Sí |
| División sugerida | PR 1 backend/modelo → PR 2 UI de facturas → PR 3 pruebas y remates |
| Estrategia de entrega | consultar-ante-riesgo |
| Estrategia de cadena | pendiente |

Decisión necesaria antes de aplicar: Sí
PRs encadenadas recomendadas: Sí
Estrategia de cadena: pendiente
Riesgo de superar 400 líneas: Alto

### Unidades de trabajo sugeridas

| Unidad | Objetivo | PR probable | Notas |
|--------|----------|-------------|-------|
| 1 | Modelo, migración y rutas de facturas | PR 1 | Base para la UI. |
| 2 | Página y vista previa de facturas | PR 2 | Depende de PR 1. |
| 3 | Pruebas y ajustes de textos | PR 3 | Cierre de regresión. |

## Fase 1: Base

- [x] 1.1 Crear modelo Prisma `Invoice` relacionado 1:1 con `Budget.id`.
- [x] 1.2 Agregar migración con unicidad por presupuesto y campos `number/status`.
- [x] 1.3 Validar vocabulario de estado de presupuesto antes de generar factura.

## Fase 2: Backend

- [x] 2.1 Hacer idempotente la creación de factura en `PUT /api/budgets/:id/status`.
- [x] 2.2 Crear rutas `GET /api/invoices`, `GET /api/invoices/:id` y cambio de estado de cobro.
- [x] 2.3 Calcular métricas automáticas desde facturas persistidas.

## Fase 3: Frontend

- [x] 3.1 Crear `front/app/facturas/page.tsx` sin acción `+ Nueva factura`.
- [x] 3.2 Crear `InvoicePreview` con `FACTURA`, `Fecha factura` y número `FAC - ...`.
- [x] 3.3 Reusar el misma estructura visual de facturación preservando acciones `Ver / Imprimir`.

## Fase 4: Pruebas

- [x] 4.1 Probar idempotencia de factura al aceptar presupuesto.
- [x] 4.2 Probar métricas `pendiente y cobrada` e importes agregados.
- [x] 4.3 Probar ausencia de creación manual y textos imprimibles (estructural — ver Deviations).

## Nota de aplicación (sdd-apply)

Implementado en una sola sesión (sin PR chain 1/2/3 real) por instrucción explícita del
lanzador de la tarea, que pidió el cambio completo con un único reporte de archivos/tests.
Se marca aquí como `size:exception` respecto al forecast de "Alto riesgo / PRs encadenadas
recomendadas" — ver reporte de apply para el detalle. Migración Prisma generada pero NO
aplicada contra la base compartida (Supabase); requiere aplicación manual y verificación de
nombre real de tabla `presupuesto` (ver riesgo de drift de migraciones en el reporte).



