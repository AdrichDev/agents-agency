# Proposal — aa-agente-consola-pruebas

Hijo H1 del plan maestro `aa-agentes-rediseno-operativo` (P0, columna vertebral).

## Intent

Dar al operador una **Consola de pruebas hiper-intuitiva**: hablarle al agente ANTES de
publicarlo y ver EN VIVO qué está pasando por dentro —qué acciones (tools) ejecuta, qué
sabe (chunks de conocimiento recuperados con su fuente), cuánto cuesta (tokens/modelo) y
cuánto tarda—. Es el bucle "prueba antes de publicar" que todo producto de bots serio
tiene y AA no. Sin esto se crea a ciegas.

## Descubrimiento clave (auditoría runtime, `file:line`)

La consola ya está **80% construida y desperdiciada**:
- `POST /api/chat` (`back/src/routes/ai.ts:54`) ya devuelve el `AgentReply` completo:
  `toolCalls[]` (nombre+args+resultado+error), `tokensUsed`, `model`.
- Las tool-calls incluyen `search_knowledge` (`executor.ts:159` → `embeddings.ts:22`),
  cuyo `output` es `{ source, content, distance }[]` — o sea, **los chunks recuperados
  con su fuente y score ya viajan hoy**.
- El front `ChatTester.tsx:25` **descarta** `toolCalls` y `tokensUsed`; solo pinta
  `data.text`.
- La ficha ya tiene la pestaña `chat` renderizando `ChatTester` (`page.tsx:127`).

Conclusión: NO hay que construir un runtime nuevo. Hay que **dejar de tirar los datos**
y pintarlos bien, más instrumentar 2 cosas que faltan (latencia + modo test).

## Scope

- **F1 Backend (instrumentación mínima):**
  - Medir **latencia por turno** (wall-time alrededor del turno) y devolverla en
    `AgentReply` / respuesta de `/api/chat`.
  - **Modo test**: flag `test:true` en `POST /api/chat` → marca la `Conversation` como
    de prueba para que NO ensucie los listados/analítica de conversaciones del cliente.
    El coste de tokens se sigue contando (es gasto LLM real) pero queda etiquetado.
- **F2 Front (el grueso — UI hiper-intuitiva):**
  - Transformar `ChatTester` en la **Consola de pruebas**: transcript + por cada turno
    del asistente un desglose legible de (a) acciones ejecutadas, (b) conocimiento
    consultado con fuente y snippet, (c) tokens/modelo/latencia.
  - Banner de estado del agente (qué canal, si tiene conocimiento y cuántos chunks, si
    está listo para publicar) para que el operador sepa qué está probando.
  - Copy en lenguaje llano (no "tool_call": "Acciones que ejecutó"; no "chunks":
    "Qué miró en su conocimiento"). Empty states claros.

## Fuera de scope (follow-ups)

- **Streaming token-a-token (SSE)** — hoy el runtime es bloqueante (`engine.ts:443`).
  La consola v1 es request/response; el "en vivo" se ve al completar el turno. SSE = H1b.
- **Latencia por-tool** y **coste monetario en €** (solo hay conteo de tokens contra
  saldo). Follow-up.

## Risks

- **Gasto LLM en pruebas**: cada test consume tokens reales. Mitigación: se cuenta y se
  muestra al operador (transparencia); conversación etiquetada test para separarla.
- **Cambio en hot-path** de `/api/chat` y `runToolLoop`: la instrumentación de latencia
  y el flag test deben ser aditivos, sin alterar el comportamiento actual (regresión
  cero: sin `test`, idéntico a hoy).
- **Migración**: marcar Conversation como test requiere un campo. Aditivo, `@default`.

## Dependencies

- Runtime: `engine.ts` (`runAgent`/`chatWithAgent`/`runToolLoop`), `ai.ts` (`/api/chat`),
  `types.ts` (`AgentReply`/`ToolCallRecord`), `embeddings.ts` (`search_knowledge`).
- Front: `ChatTester.tsx`, `front/app/agents/[id]/page.tsx` (tab `chat`).
