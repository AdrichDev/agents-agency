# Proposal — Dividir runAgent + tipar DTOs (aa-engine-split)

**Nivel Gru: 3 — Grande.** Refactor del core del agente, sin tests previos directos. Refactor puro
(comportamiento idéntico). 2 ficheros (engine.ts + nuevo engine.test.ts).
**Estado: APROBADO (2026-06-28) — redo bajo SDD tras revert previo.**

## Contexto

`back/src/lib/agent/engine.ts` `runAgent` es un bloque de ~220 líneas que mezcla: construcción
de tools (unión integraciones∪skills+intent/handoff+ecommerce), construcción del system prompt
(secciones por skills/RAG/booking/intent/handoff/order-status/contextFacts), y el bucle agéntico
de OpenAI (tool calling, metering, MAX_ITERATIONS). Crece mal y NO tiene tests directos
(el loop nunca se mockea) → refactorizar a ciegas sería arriesgado.

## Intención

Descomponer `runAgent` en helpers nombrados y tipar los DTOs internos, SIN cambiar comportamiento.
Estrategia obligatoria: TESTS DE CARACTERIZACIÓN PRIMERO, luego extraer.

## Decisiones técnicas

- **Tests primero**: `tests/engine.test.ts` mockea openai/executor/prisma/notifications/token-metering
  y fija el comportamiento (loop, tool-calls, error, max-iter, metering, system prompt, tools).
- Extraer de `runAgent` (lógica VERBATIM):
  - `buildAgentTools(connectedProviders, executableProviders, ecomCfg) → OpenAITool[]` (pura, exportada).
  - `buildSystemPrompt(agent, caps, skillInputs, hasKnowledge, ecomCfg, contextFacts) → string` (pura, exportada).
  - `runToolLoop(params: ToolLoopParams) → AgentReply` (bucle OpenAI, privada).
  - `runAgent` orquesta: fetch agent → caps → buildAgentTools → count knowledge → buildSystemPrompt → runToolLoop.
- DTOs tipados: OpenAITool (parameters: Record<string,unknown> para casar con ChatCompletionTool),
  SkillInput, AgentSkillRow, AgentForPrompt, ToolLoopParams.
- `chatWithAgent` NO se toca (lead flow + persistencia + metering; más acoplado, fuera de scope).
- `messages: any[]` e `i: any` se quedan (boundary SDK OpenAI / Prisma — aceptable).

## Alcance

1. `back/tests/engine.test.ts` (NUEVO) — caracterización de runAgent + unit tests de los 2 helpers puros.
2. `back/src/lib/agent/engine.ts` — extraer buildAgentTools/buildSystemPrompt/runToolLoop + DTOs.

## Fuera de alcance

- `chatWithAgent` (persistencia/metering) — refactor futuro.
- Deuda pre-existente NO tocada: temperature solo para gpt-4*; toolCalls.input objeto-vs-string en error.

## Riesgos

- Refactor de código sin tests previos → mitigado por caracterización antes de mover nada.
- Reordenar tools o secciones del prompt = regresión → tests fijan orden/condicionales.
