# Propuesta — Estadísticas / Stats Dashboard (P7)

> Estado: **proposed** · Nivel estimado: **2** · Fase roadmap: **P7**
> Siguiente: `sdd-spec` y `sdd-design` (pueden correr en paralelo).

## Intención

La agencia acumula datos en BD (clientes, agentes, skills, leads,
conversaciones, mensajes, automatizaciones, presupuestos) pero **no hay ninguna
vista agregada** que los muestre. Para entender el estado del negocio hay que
consultar tablas sueltas o entrar página por página.

**Problema**: no existe un panel de estadísticas con KPIs y gráficos que
condense el estado real de la base de datos por secciones.

**Por qué ahora**: con P1-P6 generando volumen de datos (conversaciones,
leads, presupuestos), hace falta visibilidad agregada para tomar decisiones.

**Éxito**: una página "Estadísticas" con tarjetas de KPIs y gráficos
interactivos (líneas, barras, donut) que reflejan, sin filtros complejos, el
estado de la BD de los últimos 12 meses.

## Alcance

### Endpoint `GET /api/stats`
Devuelve en una sola respuesta:
- **Tarjetas (totales)**: nº skills por tipo (`SkillType`: SKILL|AGENT|
  EXTENSION|PLUGIN|MCP), nº agentes, nº clientes, nº leads, nº conversaciones,
  nº mensajes, nº automatizaciones.
- **Series temporales por mes (últimos 12 meses)**: agentes creados, leads,
  conversaciones, presupuestos (sobre `createdAt` de cada modelo).
- **Facturación desde `Budget`**: suma de totales por mes y por estado.
  Campos reales del modelo: `status` (draft|sent|accepted|rejected),
  `totalImpl` (pago único con IVA), `totalMaint` (mensual con IVA), `createdAt`.
  → Facturación mensual = suma de `totalImpl + totalMaint`; desglose por `status`.
- **Top agentes por conversaciones** (count de `Conversation` por `agentId`,
  con nombre del agente).

### Página `front/app/estadisticas/page.tsx`
- Cards de KPIs (estilo `.card`, `.kicker`).
- Gráficos interactivos con **recharts**:
  - Línea: series temporales mensuales.
  - Barras: facturación por mes (apilado por estado).
  - Donut: skills por tipo y leads por estado.
- Tooltips, leyendas, responsive.

### Navegación
- Item `{ href: "/estadisticas", label: "Estadísticas", icon: "📈" }` en
  `NAV_ITEMS` (`front/lib/navigation.ts`).

### Dependencias
- Front nueva: `recharts`.
- Back: ninguna nueva (Prisma `groupBy` / `count` / agregaciones).

## Fuera de alcance

- Filtros por rango de fechas avanzados (solo últimos 12 meses fijos).
- Export (CSV / PDF).
- Drill-down / navegación a registros individuales desde el gráfico.
- Caché del endpoint (cálculo on-demand en MVP).

## Aproximación y rationale

- **Un solo endpoint agregador**: `GET /api/stats` evita N llamadas desde el
  front y centraliza la lógica de agregación. Acepta el coste de varias queries
  Prisma por request (volumen actual bajo).
- **Series sobre `createdAt`**: todos los modelos relevantes tienen `createdAt`;
  agrupación por mes en SQL/Prisma. Ventana fija de 12 meses simplifica el MVP.
- **Facturación con campos reales**: se confirmó en scan que `Budget` no tiene
  un único `total`, sino `totalImpl` + `totalMaint` (ambos con IVA) y `status`.
  La suma combinada por mes y el desglose por estado son las métricas honestas.
- **recharts**: librería declarativa estándar para React, buena con
  responsive y tooltips, menor fricción que d3 directo.

## Riesgos y preguntas abiertas

- **R1 — Coste del endpoint**: varias agregaciones por request sin caché.
  Aceptable en MVP por volumen; vigilar si crece.
- **R2 — Agrupación mensual en Prisma**: `groupBy` no agrupa por mes
  truncado de forma nativa portable; puede requerir `$queryRaw` con
  `date_trunc('month', ...)` (PostgreSQL). Definir en design.
- **R3 — Bundle recharts**: peso moderado; cargar solo en la ruta
  `/estadisticas` (dynamic import si hace falta).
- **Q1**: ¿facturación cuenta todos los estados o solo `accepted`?
  (Asunción: barras apiladas muestran todos los estados; el usuario distingue.)
- **Q2**: ¿"top agentes" limita a N (p.ej. top 5)? (Asunción: top 5.)
