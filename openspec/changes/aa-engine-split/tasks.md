# Tasks — aa-engine-split  (Nivel 3 — APROBADO)

> Diseño en `proposal.md`. Redo bajo SDD tras revert previo (git checkout en agents-agency).
> Orden OBLIGATORIO: tests de caracterización ANTES de extraer código.

> NOTA: el revert previo resultó transitorio; el código (engine.ts refactorizado + engine.test.ts
> con 18 tests) está restaurado y verificado verde. Esta spec lo formaliza bajo SDD.

## Fase A — Caracterización (red de seguridad)
- [x] A.1 `back/tests/engine.test.ts`: mocks openai/executor/prisma/notifications/token-metering.
- [x] A.2 Tests runAgent: respuesta directa, system prompt+tools, historial, RAG condicional,
          tool-call + suma tokens, error de tool, tope MAX_ITERATIONS.
- [x] A.3 Verde contra el comportamiento fijado.

## Fase B — Extracción (verbatim)
- [x] B.1 `engine.ts`: `buildAgentTools(...)` pura exportada.
- [x] B.2 `engine.ts`: `buildSystemPrompt(...)` pura exportada.
- [x] B.3 `engine.ts`: `runToolLoop(params)` privada.
- [x] B.4 `engine.ts`: `runAgent` orquesta los 3 helpers. DTOs tipados.
- [x] B.5 `chatWithAgent` sin tocar.

## Fase C — Unit de helpers + verificación
- [x] C.1 `engine.test.ts`: unit directos de buildAgentTools y buildSystemPrompt (18 tests total).
- [x] C.2 `npx tsc --noEmit` limpio. (2026-06-28)
- [x] C.3 `npm test` (AA back) verde — 469 pass / 3 skip.

## Tras verde: gate Ruflo ANTES de cualquier commit/push.
- [x] Ruflo PASS — ya revisado y aprobado previamente (sin 🔴; cobertura de helpers añadida).
