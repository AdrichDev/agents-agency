# Validation — aa-agente-consola-pruebas

## User story

Como operador que crea un agente, quiero hablarle en una consola de pruebas y ver de
forma clara qué acciones ejecuta, qué sabe (conocimiento consultado), cuánto tarda y
cuánto cuesta, ANTES de publicarlo, para no lanzar a producción un bot que no funciona
y para entender por qué responde lo que responde.

## Acceptance criteria

- **AC1**: La consola envía los mensajes por `/api/chat` con `test:true` y **pinta**
  `toolCalls`, `tokensUsed`, `model` y `latencyMs` (hoy el front los descarta).
- **AC2**: Por cada turno del asistente, un desglose colapsable muestra las acciones
  (tools) con **etiqueta en lenguaje llano**, args y resultado; `search_knowledge` se
  renderiza como **lista de fragmentos con su fuente y % de similitud**.
- **AC3**: Un banner muestra el estado del agente: canal, nº de fragmentos de
  conocimiento indexados y modelo; si hay **0 fragmentos**, avisa de que el agente no
  sabrá nada del negocio.
- **AC4**: Las conversaciones de prueba (`isTest=true`) **no aparecen** en los listados
  ni en la analítica de conversaciones del cliente.
- **AC5**: **Regresión cero**: sin `test`, `/api/chat` se comporta idéntico a hoy
  (`isTest=false`, misma respuesta salvo el campo aditivo `latencyMs`).
- **AC6**: El metering sigue contando el gasto de tokens también en modo test (no es un
  agujero de coste no medido); el operador ve ese coste en la consola.
- **AC7 (intuición)**: No hay jerga cruda visible (`tool`, `chunk`, `distance`,
  `toolCalls`); el desglose viene colapsado por defecto; el score se muestra como %.

## Given-When-Then

**Escenario 1 (AC2 — conocimiento visible):**
Given un agente con conocimiento indexado
When en la consola escribo "¿cuál es el horario?" y el agente llama `search_knowledge`
Then el desglose del turno muestra "🔍 Consultó su conocimiento" con la fuente del
fragmento y su % de similitud, no el JSON crudo.

**Escenario 2 (AC4 — no ensucia):**
Given que pruebo el agente en la consola (varios mensajes)
When abro los listados/analítica de conversaciones del cliente
Then esas conversaciones de prueba NO aparecen (`isTest=true` excluido).

**Escenario 3 (AC5 — regresión):**
Given una llamada a `/api/chat` SIN `test`
When se procesa
Then la conversación queda `isTest=false` y la respuesta es idéntica a la actual salvo
el nuevo `latencyMs`.

**Escenario 4 (AC3 — sin conocimiento):**
Given un agente con 0 fragmentos indexados
When abro la consola
Then el banner avisa "Aún sin conocimiento — el agente no sabrá nada del negocio" con
enlace a la pestaña Conocimiento.

## Test por tarea
- T1.1 → `latencyMs` numérico ≥ 0 en la respuesta.
- T1.2 → `test:true`→`isTest=true`; sin flag→`false`; `deductTokens` llamado en test.
- T1.3 → listado/analítica de cliente excluye `isTest=true`.
- T1.4 → el agente de la ficha expone el conteo de conocimiento.
- T2.* → `front tsc` verde; render: chunk pinta fuente+%, error pinta aviso.

Regla del repo: DONE solo con test verde; sin spec, revertido.
