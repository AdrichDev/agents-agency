# Validación — aa-engine-split

Historia: como mantenedor del core del agente, quiero runAgent descompuesto en piezas testeables
sin cambiar su comportamiento observable, para que crezca sano y con red de tests.

## Criterios de aceptación (AC)

- **AC1**: `runAgent` sin tool_calls devuelve `{text, toolCalls:[], tokensUsed, model}` con el texto del modelo.
- **AC2**: con tool_calls, ejecuta `executeTool(agentId, name, input, conversationId)`, registra el resultado,
  itera y acumula tokens de todas las vueltas.
- **AC3**: error de una tool se captura (output `{error}`, input = arguments crudos) y el loop continúa.
- **AC4**: al alcanzar MAX_ITERATIONS (8) sin parar, devuelve el mensaje de límite; tokens acumulados.
- **AC5**: system prompt incluye el nombre del agente; tools siempre incluyen record_lead_intent + request_human_handoff.
- **AC6**: bloque RAG solo si hay knowledge chunks; booking solo si calendar ejecutable; order-status solo si orderStatusUrl.
- **AC7**: `buildAgentTools` y `buildSystemPrompt` son puras; producen la misma salida que el código inline original.
- **AC8**: `chatWithAgent` sin cambios. tsc limpio; AA back suite verde.

## Por tarea (Given-When-Then + test)

### T.1 — engine.test.ts (caracterización runAgent)
- **Given** completion sin tool_calls, **When** runAgent, **Then** AC1. _Test: unit mock openai._
- **Given** completion con tool_call luego texto, **When** runAgent, **Then** AC2 (executeTool llamado, tokens sumados). _Test: unit._
- **Given** executeTool lanza, **When** runAgent, **Then** AC3. _Test: unit._
- **Given** completions siempre con tool_calls, **When** runAgent, **Then** AC4 (8 llamadas, mensaje límite). _Test: unit._
- **Given** knowledgeChunk.count=0 vs >0, **When** runAgent, **Then** RAG ausente/presente; línea fija "Usa search_knowledge" SIEMPRE. _Test: unit._

### T.2 — unit de helpers puros
- **Given** buildAgentTools, **When** sin/ con orderStatusUrl, **Then** intent+handoff siempre, ecommerce condicional, sin duplicados. _Test: unit._
- **Given** buildSystemPrompt, **When** base/RAG/booking/order-status/contextFacts/missing+info skills, **Then** secciones correctas. _Test: unit._

### T.3 — refactor sin regresión
- **Given** engine.ts refactorizado, **When** suite AA back, **Then** verde (incluye los tests T.1/T.2). _Test: vitest._

### V — Verificación
- **Given** el cambio, **When** `npx tsc --noEmit` y `npm test`, **Then** tsc limpio y suite verde. _Test: AA back._
