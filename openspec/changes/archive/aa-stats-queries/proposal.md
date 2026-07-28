# Proposal — Encapsular SQL de analytics en un repository (aa-stats-queries)

**Nivel Gru: 3 — Grande.** Refactor de de-duplicación de SQL crudo; sin tests previos de agregación.
Refactor puro (comportamiento idéntico). 1 fichero nuevo + 1 modificado + 1 test nuevo.
**Estado: APROBADO (2026-06-28) — formalizado bajo SDD (código ya presente tras revert transitorio).**

## Contexto

`back/src/lib/stats/aggregator.ts` tenía `getStats` (path filtrado) y `getStatsP7` (no-params,
"byte-identical to original") duplicando: totals (10 counts + buildTotals), la query date_trunc
COUNT (8 ocurrencias), la query de billing y la de top-agents. La suite de stats solo cubría
schema + helpers puros, NO la agregación SQL.

## Intención

Extraer las queries crudas repetidas a un repository (`stats/queries.ts`), SIN cambiar el
comportamiento. Caracterización primero.

## Decisiones técnicas

- `stats/queries.ts`:
  - `fetchTotals()`: Promise.all de 10 counts + buildTotals.
  - `monthlyCount({from,tsCol,unit,joins?,where})`: query date_trunc COUNT::bigint con Prisma.sql.
    `unit` = Prisma.raw whitelisteado (GRANULARITY_MAP / 'month'); NUNCA input de usuario.
  - `billingQuery<T>({unit,revenueExpr,from,joins?,where})`: SUM por mes+estado; tabla aliasada b.
  - `fetchTopAgents()`: raw conversaciones GROUP BY + findMany nombres + mapTopAgents.
- `aggregator.ts`: ambos paths usan los helpers; filtros y zero-fill se quedan en getStats.
  getStatsP7 aliasa presupuesto como b para reusar billingQuery (semánticamente idéntico).
- Caracterización: `tests/stats-aggregator.test.ts` mockea prisma ($queryRaw→[]) y fija forma de
  salida + nº de queries (6 por path).

## Alcance

1. `back/src/lib/stats/queries.ts` (NUEVO) — repository.
2. `back/src/lib/stats/aggregator.ts` — usar los helpers en ambos paths.
3. `back/tests/stats-aggregator.test.ts` (NUEVO) — caracterización.

## Fuera de alcance

- Reescribir a ORM (SQL crudo se mantiene por rendimiento).
- Test de integración con DB real (infra AA sin DB; validado por smoke puntual).

## Riesgos

- SQL nunca ejecutado en tests (toda la suite mockea prisma) → riesgo pre-existente. Cerrado con
  smoke real-DB puntual (getStats P7 + filtrado + granularity day): SQL compone y corre.
- Embedding de fragmentos Prisma.sql en FROM/SELECT: mismo mecanismo ya usado para joins/filtros.
