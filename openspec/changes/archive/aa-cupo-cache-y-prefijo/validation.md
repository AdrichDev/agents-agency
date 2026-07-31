# Validación — aa-cupo-cache-y-prefijo

## Historia de usuario

**Como** propietario de la plataforma que vende agentes a clientes,
**quiero** que el cupo que descuento a un cliente refleje lo que su conversación me cuesta de verdad
**para** no cobrarle cupo por tokens que el proveedor me sirve de su caché al 10% del precio, y para
que el cupo de 10M le dure lo que su uso real justifica.

## Criterios de aceptación

- **AC1** — Un turno con tokens cacheados descuenta del cupo MENOS que el total bruto, con el ratio
  del modelo. Con `gpt-5.4-mini`, 1.000 cacheados de 3.000 totales imputan 3.000 − 1.000×0,9 = 2.100.
- **AC2** — Un modelo sin ratio conocido (Gemini, Anthropic, cualquier id nuevo) imputa el bruto.
  Ningún modelo desconocido afloja el cupo por accidente.
- **AC3** — Un turno sin `cachedTokens` informado (el proveedor no manda `prompt_tokens_details`)
  imputa el bruto. Un dato ausente no vale como cero.
- **AC4** — El bruto sigue siendo consultable: la fila de `uso_tokens` lleva `contexto.tokensBrutos`
  con el total sin ponderar.
- **AC5** — `tenant.tokensUsedPeriod` y `uso_tokens.tokens` guardan el MISMO número (el imputado),
  para que el tope del tenant y el del agente midan lo mismo.
- **AC6** — En `credentialMode: "byok"` se sigue sin tocar contadores, y la fila registrada lleva el
  imputado y el bruto igual que en `platform`.
- **AC7** — El bloque base de directrices supera por sí solo el mínimo cacheable, sin depender del
  prompt que escriba el operador.
- **AC8** — Con el bloque base puesto, una conversación real acierta la caché entre turnos
  (`cached_tokens > 0` en un turno con una sola iteración) — que es lo que hoy no ocurre nunca.
- **AC9** — Medido sobre la misma conversación de `evidence.md`: la factura del propietario BAJA y el
  cupo consumido por el cliente BAJA. Si el cupo sube, el change está mal.
- **AC10** — Las directrices base no degradan la conversación ni contradicen el prompt del operador:
  cuando ambos chocan, manda el del operador.

## Escenario Given-When-Then por tarea

### T1 — `chargeableTokens` (función pura)

**Given** un turno de `gpt-5.4-mini` con 3.000 tokens totales de los que 1.000 vinieron de caché
**When** se calcula lo imputable al cupo
**Then** devuelve 2.100, y devuelve 3.000 si el modelo es `gemini-3.5-flash` (sin ratio conocido),
si `cached` es `null`, o si `cached` es incoherente (mayor que el total).

**Test**: `back/tests/chargeable-tokens.test.ts`

### T2 — `deductTokens` aplica la ponderación

**Given** un tenant en `platform` con un turno de 3.000 tokens (1.000 cacheados) en `gpt-5.4-mini`
**When** se contabiliza el consumo
**Then** `tokensUsed` y `tokensUsedPeriod` suben 2.100, la fila de `uso_tokens` guarda
`tokens: 2100` y `contexto.tokensBrutos: 3000`; y con el mismo turno en `byok` no sube ningún
contador pero la fila lleva los mismos dos números.

**Test**: `back/tests/deduct-tokens-cached.test.ts`

### T3 — Bloque base por encima del mínimo cacheable

**Given** el bloque `BASE_DIRECTIVES`
**When** se mide su longitud, y se construye el system prompt de un agente cuyo `systemPrompt` es
una sola línea
**Then** el bloque supera `BASE_DIRECTIVES_MIN_CHARS` por sí solo, y aparece al principio del system
prompt construido, antes del nombre del agente y de su prompt.

**Test**: `back/tests/base-directives.test.ts`

### T4 — La caché acierta de verdad (verificación empírica)

**Given** un agente real con el bloque base desplegado
**When** se encadenan 6 turnos con `back/scripts/measure-history-cache.ts`
**Then** al menos 4 turnos con `iterations === 1` reportan `cachedTokens > 0`, y el total imputado de
la conversación es menor que el total bruto.

**Test**: ejecución de `back/scripts/measure-history-cache.ts` — no es un test de suite, es una
medición contra el proveedor real, y se registra su salida en `evidence.md`. Un test unitario no
puede probar esto: depende de cómo casa prefijos OpenAI.

### T5 — Las directrices no rompen la conversación

**Given** el mismo guion de conversación
**When** se responde con y sin el bloque base
**Then** ninguna respuesta contradice el prompt del operador, y ante conflicto explícito
(un prompt de operador que diga lo contrario de una directriz base) manda el del operador.

**Test**: la precedencia declarada en el texto va en `back/tests/base-directives.test.ts` (bloque
"AC10 — precedencia declarada"), junto al resto de aserciones sobre la misma constante. Lo que un
test no decide —si la conversación empeora— se registra en `evidence.md` con la comparación real.

## Fuera de esta validación

- Que 10M de tokens sea el cupo correcto. Este change cambia cómo se cuenta, no cuánto se da.
- Qué modelo deben usar los agentes. Change aparte, con comparativa n≥5.
- Los ratios de caché de Gemini y Anthropic. Sin verificar contra doc oficial no entran en la tabla.
