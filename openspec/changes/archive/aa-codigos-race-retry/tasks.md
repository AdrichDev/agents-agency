# Tasks — aa-codigos-race-retry  (Nivel 2 — APROBADO)

> Diseño en `proposal.md`. Redo bajo SDD tras revert previo (git checkout en agents-agency).

## Fase A — Implementación
- [x] A.1 `back/src/lib/agent/service.ts` `createAgent`: agent.create envuelto en withCodeRetry, codCliente dentro.
- [x] A.2 `back/src/lib/agent/service.ts`: budget.create envuelto, quoteNumber dentro.
- [x] A.3 `back/src/lib/landing/budget.ts` `createLandingQrBudget`: quoteNumber dentro del closure.
- [x] A.4 `back/tests/codes.test.ts`: test de regresión añadido.

## Fase B — Verificación
- [x] B.1 `npx tsc --noEmit` limpio.
- [x] B.2 `npm test` (AA back) verde — 445 pass / 3 skip (444+1 regresión). (2026-06-28)

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [x] Agentic Runtime PASS — código idéntico al ya revisado y aprobado por Agentic Runtime (sin findings; indentación
      correcta ya incorporada). Re-aplicación verbatim bajo SDD tras revert.
