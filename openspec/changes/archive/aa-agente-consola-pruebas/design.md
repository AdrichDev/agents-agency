# Design — aa-agente-consola-pruebas

## §A. Reutilización (lo que YA existe, no se toca)

- `runAgent` (`engine.ts:505`) → `runToolLoop` (`engine.ts:443`) devuelve `AgentReply`
  = `{ text, toolCalls: ToolCallRecord[], tokensUsed?, model? }` (`types.ts:14`).
- `ToolCallRecord` (`types.ts:7`) = `{ tool, input, output, error? }`. Se acumula en
  `engine.ts:474/478`. Incluye `search_knowledge` con `output = {source,content,distance}[]`.
- `POST /api/chat` (`ai.ts:54`) ya responde el `AgentReply` entero (toolCalls+tokens+model).
- Front tab `chat` ya monta `<ChatTester agentId>` (`page.tsx:127`).

**Regla:** no duplicar runtime. La consola consume lo que `/api/chat` ya emite.

## §B. F1 — Instrumentación backend (mínima, aditiva)

### B.1 Latencia por turno
- Medir wall-time alrededor del turno en `chatWithAgent`/`runAgent` (envolver la
  llamada al loop). Añadir `latencyMs?: number` a `AgentReply` (`types.ts:14`) y
  propagarlo en la respuesta de `/api/chat`.
- Regresión cero: campo opcional; si no se calcula, `undefined`.

### B.2 Modo test (no ensuciar conversaciones del cliente)
- `POST /api/chat` acepta `test?: boolean`. Cuando `true`, la `Conversation` creada se
  marca como de prueba.
- **Persistencia — decisión**: columna booleana de primer nivel en `Conversation`,
  `isTest Boolean @default(false) @map("es_prueba")` (migración aditiva). Motivo:
  permite filtrar limpio los listados/analítica del cliente (`WHERE es_prueba = false`)
  sin parsear metadata. Alternativa descartada: reusar `channel="test"` (pierde el
  canal real que se está simulando y contamina la semántica de `channel`).
- **Metering**: se mantiene `deductTokens` (gasto LLM real), pero el operador ve el
  coste en la consola. Los listados de conversaciones del cliente y la analítica
  excluyen `isTest = true`. (Ajuste de esos listados: aditivo, filtro por defecto.)
- Regresión cero: sin `test`, `isTest=false`, comportamiento idéntico a hoy.

### B.3 Estado del agente (para el banner)
- Reutilizar el conteo `hasKnowledge`/nº chunks (`engine.ts:553`) y exponerlo por un
  endpoint ligero o incluirlo en el GET del agente que ya consume la ficha. El builder
  elige el camino más limpio (probablemente ya viaja en el agente cargado por la ficha).

## §C. F2 — UI de la Consola de pruebas (hiper-intuitiva)

Sobre el `ChatTester` existente, reconstruido. Nombre de pestaña: **"Probar agente"**
(antes "Chat"). Lenguaje llano; el operador NO es técnico.

### C.1 Layout (ASCII mock)

```
┌───────────────────────────────────────────────────────────────┐
│  Probar agente                                    [ Reiniciar ] │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟢 Listo para probar · Canal: Telegram · Conocimiento:   │   │  ← Banner estado
│  │    12 fragmentos indexados · Modelo: gpt-4o              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   Tú:  Quiero cita para el jueves                               │
│                                                                 │
│   Agente:  Tengo hueco a las 10:00 y a las 12:00 ¿cuál…         │
│   ┌── ▸ Ver qué hizo el agente (2 acciones) ───────────────┐    │  ← Colapsable
│   │  🔍 Consultó su conocimiento                           │    │
│   │     Búsqueda: "horario jueves"                          │    │
│   │     • horarios.html — "Jueves 9-14h y 16-20h" (92%)     │    │  ← chunk+fuente+score
│   │  📅 Consultó disponibilidad                             │    │
│   │     Entrada: { dia: "jueves" }                          │    │
│   │     Resultado: ["10:00","12:00"]                        │    │
│   └────────────────────────────────────────────────────────┘    │
│   ⚡ 1.2 s · 340 tokens · gpt-4o                                 │  ← footer turno
│                                                                 │
│  ┌───────────────────────────────────────────────┐  [ Enviar ] │
│  │ Escribe como si fueras el cliente…            │              │
│  └───────────────────────────────────────────────┘             │
└───────────────────────────────────────────────────────────────┘
```

### C.2 Elementos y copy

- **Banner de estado** (arriba, siempre visible):
  - 🟢/🟡 "Listo para probar" / "Aún sin conocimiento" (si 0 chunks → avisar que el
    agente no sabrá nada del negocio, enlazar a pestaña Conocimiento).
  - Canal seleccionado · nº fragmentos indexados · modelo.
- **Transcript**: burbujas Tú / Agente.
- **Desglose por turno del asistente** (colapsable, cerrado por defecto, título
  "Ver qué hizo el agente (N acciones)"):
  - Cada `toolCall` con **icono + etiqueta llana + args + resultado**:
    - `search_knowledge` → 🔍 "Consultó su conocimiento" → lista de chunks:
      `• {source} — "{snippet ≤120 chars}" ({(1-distance)*100 %})`.
    - `crear_reserva`/`consultar_disponibilidad`/`guardar_lead`/`consultar_pedido`/
      `notificar`/`request_human_handoff` → icono + etiqueta humana (mapa
      `tool → {icon,label}`), args y resultado en formato legible.
    - error → ⚠️ "No pudo completar la acción" + mensaje.
  - Si no hubo tools: no se muestra el colapsable.
- **Footer por turno**: ⚡ latencia · nº tokens · modelo.
- **Botón Reiniciar**: descarta la conversación de prueba y empieza otra.
- **Input**: placeholder "Escribe como si fueras el cliente…".

### C.3 Principios de intuición (requisito de primer nivel)

- Nada de jerga cruda visible: `tool`, `chunk`, `distance`, `toolCalls` → traducidos.
- El desglose viene **colapsado**: el operador ve una conversación normal; si quiere
  entender el "por qué", lo despliega.
- El score de similitud se muestra como **%**, no como distancia coseno.
- Empty state inicial: tarjeta "Háblale a tu agente como lo haría un cliente real para
  ver cómo responde antes de publicarlo."
- Estado de carga: indicador "El agente está pensando…" mientras el turno bloquea.

### C.4 Datos que consume el front (todo del `/api/chat` response)

```ts
// respuesta de POST /api/chat  (test:true)
{
  conversationId: string,
  text: string,
  toolCalls: { tool: string, input: unknown, output: unknown, error?: string }[],
  tokensUsed?: number,
  model?: string,
  latencyMs?: number,        // NUEVO (F1.1)
}
```

Mapa `tool → {icon,label}` en el front (constante). `search_knowledge.output` se
renderiza especial (chunks). Todo lo demás: `input`/`output` en `<pre>` compacto legible.

## §D. Tests (vitest — AA)

- **B1**: `/api/chat` devuelve `latencyMs` numérico ≥ 0 en un turno.
- **B2**: `/api/chat` con `test:true` crea `Conversation` con `isTest=true`; sin flag →
  `isTest=false` (regresión). Un listado/analítica de cliente excluye `isTest=true`.
- **B2b**: el metering sigue contando en modo test (deductTokens llamado).
- **F2**: `front npx tsc --noEmit` verde. Test de render del desglose (si el harness de
  front lo admite): dado un `AgentReply` con un `search_knowledge` toolCall, la consola
  pinta la fuente y el % del chunk; dado un toolCall con `error`, pinta el aviso.

Regla del repo: DONE solo con test verde.
