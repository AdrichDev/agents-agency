# Tasks — aa-stats-queries  (Nivel 3 — APROBADO)

> Formalizado bajo SDD. Código presente y verificado verde (revert previo transitorio).

## Fase A — Caracterización
- [x] A.1 `back/tests/stats-aggregator.test.ts`: mockea prisma; fija salida + nº queries (6/path).
- [x] A.2 Verde contra el comportamiento fijado (P7 + filtrado + top-agents).

## Fase B — Repository
- [x] B.1 `back/src/lib/stats/queries.ts`: fetchTotals, monthlyCount, billingQuery, fetchTopAgents.
- [x] B.2 `aggregator.ts`: ambos paths usan los helpers; P7 aliasa presupuesto como b.

## Fase C — Verificación
- [x] C.1 `npx tsc --noEmit` limpio. (2026-06-28)
- [x] C.2 `npm test` (AA back) verde — 469 pass / 3 skip.
- [x] C.3 Smoke real-DB: getStats P7 + filtrado + granularity day → SQL compone y ejecuta (12/12/5, 90/90).

## Tras verde: gate Ruflo ANTES de cualquier commit/push.
- [x] Ruflo PASS — revisado previamente (sin 🔴; riesgo SQL-sin-ejecutar cerrado con smoke).
