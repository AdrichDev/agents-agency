# Validación — aa-stats-queries

Historia: como mantenedor de analytics, quiero el SQL repetido encapsulado en un repository
testeable, sin cambiar los números que devuelve el dashboard.

## Criterios de aceptación (AC)

- **AC1**: `getStats()` (sin params, path P7) devuelve totals, serie mensual de 12 puntos,
  billing de 12 y top-agents — idéntico al original.
- **AC2**: `getStats(query)` (filtrado) aplica filtros (clientId/sector/serviceId/status/agentId/revenueType)
  y zero-fill; salida idéntica al original.
- **AC3**: `unit` de date_trunc proviene SIEMPRE de GRANULARITY_MAP (o 'month' en P7) vía Prisma.raw;
  ningún input de usuario alcanza Prisma.raw.
- **AC4**: Ambos paths emiten el mismo nº de queries crudas (6) que antes.
- **AC5**: tsc limpio; AA back suite verde; smoke real-DB OK.

## Por tarea (Given-When-Then + test)

### T.1 — stats-aggregator.test.ts (caracterización)
- **Given** prisma mockeado ($queryRaw→[]), **When** getStats() (P7), **Then** totals 0, monthly 12,
  billing 12, topAgents [], 6 queries, sin findMany. _Test: unit._
- **Given** prisma mockeado, **When** getStats({granularity:'month'}), **Then** serie zero-fill last12m,
  topAgents [], 6 queries. _Test: unit._
- **Given** top agents query con 1 fila, **When** getStats filtrado, **Then** resuelve agentName vía findMany.
  _Test: unit._

### T.2 — queries.ts (repository)
- **Given** monthlyCount/billingQuery/fetchTotals/fetchTopAgents, **When** se usan en ambos paths,
  **Then** la suite AA back queda verde (regresión cero). _Test: vitest._

### V — Verificación
- **Given** el cambio, **When** tsc + npm test + smoke real-DB, **Then** limpio, verde, SQL ejecuta.
  _Test: AA back + smoke puntual (getStats P7/filtrado/day)._
