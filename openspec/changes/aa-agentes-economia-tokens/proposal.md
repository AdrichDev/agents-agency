# Propuesta — aa-agentes-economia-tokens

## Intención

Bajar el consumo de tokens por mensaje **sin recortar capacidades ni calidad de respuesta**. Hoy un
mensaje real cuesta ~6000 tokens y una conversación larga ~150k; el objetivo es dejar el mensaje
típico por debajo de 2500 y que una conversación larga deje de crecer sin techo.

No es una propuesta de "que el agente haga menos". Todas las palancas de este cambio son
estructurales: eliminar reenvíos redundantes, dejar de inyectar contenido irrelevante y aprovechar
el caché del proveedor. Dos de ellas además **mejoran** la calidad de la respuesta y la latencia.

## El problema, con evidencia

Medido el 27/07/2026 contra la base de datos de producción (`aa.TokenUsage`) y ejecutando
`buildSystemPrompt`/`buildAgentTools` con los datos reales del agente.

### Composición de un mensaje de "Agente Wabiks"

| Bloque | chars | ~tokens |
|---|---|---|
| `systemPrompt` construido | 6365 | ~1591 |
| Definiciones de 8 herramientas (JSON) | 4381 | ~1252 |
| **Entrada base, por iteración** | **10,7 KB** | **~2250 reales** |

De los 6365 chars del system prompt, **sólo 748 son el prompt que escribió el propietario** (12%).
El resto lo inyecta la plataforma.

### El multiplicador: el bucle de herramientas

`engine.ts:467` itera hasta `MAX_ITERATIONS = 8`, y **cada iteración reenvía el prompt completo**.
`tokensUsed` suma todas (`engine.ts:483`). Conversación real `cms3rxxrz00081bby8vfa7ri2`:

| Mensaje | tokens | Por qué |
|---|---|---|
| 1 ("Hola") | 2285 | 1 iteración, no disparó búsqueda |
| 2 | 6054 | 2 iteraciones: base + base repetida + ~1400 de chunks |
| 3 | 6771 | ídem, con historial ya crecido |

Aritmética comprobada: 2285 (iter 1) + 2285 (iter 2, prompt repetido) + ~1400 (chunks) + tool_call
≈ 6055. Observado: 6054.

El primer mensaje fue la excepción, no la norma: `engine.ts:399` inyecta
`"Usa search_knowledge antes de responder preguntas sobre el negocio del cliente."`, así que
**cualquier pregunta real dispara la búsqueda y por tanto paga dos iteraciones**.

### Los tres agujeros

| # | Defecto | Evidencia |
|---|---|---|
| 1 | El historial está acotado **por el extremo equivocado** | `engine.ts:686` — `include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } }`. Sí hay tope (20), así que el coste no crece sin techo; pero `asc` + `take` devuelve los **20 más antiguos**. Pasados 20 mensajes, el agente deja de ver lo que se acaba de decir y sigue releyendo el arranque de la conversación. Es un fallo funcional, no sólo de coste |
| 2 | La búsqueda de conocimiento no filtra por relevancia | `embeddings.ts:26` — `k = 5` fijo, `ORDER BY distance ASC LIMIT 5` **sin umbral**. Devuelve 5 chunks de ~1000 chars siempre, aunque los 5 sean irrelevantes |
| 3 | El prefijo del prompt no es estable, así que rompe el caché del proveedor | `engine.ts:384` mete `contextFacts` (dato variable: nombre/email del visitante) **en medio** del prompt, antes de la guía de estilo (`:401`). Cuando el visitante da su nombre a mitad de conversación, invalida el caché de todo lo que va detrás |

### Coste acumulado real por conversación

`aa.TokenUsage` agrupado por conversación, top 4:

| tokens | mensajes | media |
|---|---|---|
| 35 821 | 7 | 5117 |
| 22 668 | 7 | 3238 |
| 20 853 | 7 | 2979 |
| 15 110 | 3 | 5037 |

Extrapolado a 20 turnos con búsqueda en cada uno: ~150-180k por conversación. Con el cupo por
defecto de 10M (`quota.ts:33`), **~60-65 conversaciones largas lo funden**.

## Lo que NO es este cambio

- **No es "el LLM tiene memoria y no la usamos".** La API es sin estado: reenviar el system prompt y
  el historial en cada llamada es obligatorio, no un descuido. Lo que se ataca son los reenvíos
  *evitables* (la segunda iteración) y el contenido *inútil* (chunks irrelevantes, prosa duplicada).
- **No es subir el cupo.** Eso es una constante (`quota.ts:33`) y una decisión comercial aparte. Este
  cambio reduce el consumo; cuánto cupo se regala es otra conversación.
- **No es cambiar la unidad de cobro.** Hoy se le imputa al tenant `total_tokens`, incluida la
  plantilla que reenviamos nosotros. Discutible, pero es política comercial, no economía de tokens.
- **No es apagar capacidades.** Ninguna herramienta se retira. El agente sigue pudiendo reservar,
  guardar leads, calificar y consultar pedidos.

## Alcance

| # | Palanca | Ahorro estimado | Efecto secundario |
|---|---|---|---|
| **A** | **Búsqueda anticipada de conocimiento**: recuperar los fragmentos ANTES de la primera llamada e inyectarlos, en vez de dar la herramienta y esperar a que el modelo la llame (2 iteraciones → 1) | **−2250 tok/mensaje** (−38%) | **Baja la latencia ~1,5 s**: una llamada al LLM menos |
| **B** | **Umbral de relevancia** en `searchKnowledge` + `k` de 5 a 3 | −700 a −900 tok/búsqueda | **Mejora la respuesta**: 5 fragmentos irrelevantes confunden al modelo |
| **C** | **Ventana de historial** (últimos N turnos) | Convierte el crecimiento cuadrático en lineal | Ninguno con N generoso (ver §D3 del diseño) |
| **D** | **Prefijo estable** para el caché de OpenAI: lo variable al final | No baja el cupo; **baja el dinero** (input cacheado se factura a tarifa reducida) | Ninguno |
| **E** | **Comprimir el prompt**: guía de estilo (1893 chars) y prosa que repite lo que ya dice el JSON de cada herramienta | −600 a −800 tok/iteración | Riesgo de regresión de comportamiento — va última y con comparación manual |
| **F** | **Registrar `cached_tokens`** de `prompt_tokens_details` | Cero ahorro: es medición | Sin ella no sabemos nuestro coste real |

Objetivo agregado: **mensaje típico de ~6000 a ~2300 tokens (−60%)**, y conversación de 20 turnos de
~150k a ~40k.

## Fuera de alcance

- Subir `DEFAULT_TOKEN_QUOTA_PER_AGENT` o diferenciarlo por plan.
- Cambiar qué se le imputa al tenant (cupo vs. coste real).
- Límite de turnos por conversación como freno anti-abuso. Es seguridad, no economía; queda anotado
  como deuda junto al limitador de 20/min por IP de `aiLimiter`.
- `prompt_cache_retention: "24h"`: sólo en modelos nuevos, y el caché estándar ya cubre el caso de
  una conversación activa.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **La búsqueda anticipada gasta un embedding en mensajes que no lo necesitan** ("Hola", "gracias") | Un embedding cuesta ~1/100 de una iteración de LLM. Aun así, la palanca A lleva un guardado barato: no buscar en mensajes de <4 palabras sin signo de interrogación |
| **El umbral de relevancia deja al agente sin contexto** si está mal calibrado | El umbral se calibra contra las distancias reales de los 33 chunks de Wabiks antes de fijarlo, y con `k=3` mínimo garantizado si el mejor resultado pasa el umbral |
| **La ventana de historial pierde contexto de conversaciones largas** | N generoso (10-12 mensajes). Los datos del contacto NO viven en el historial: van aparte en `contextFacts`, así que no se pierden nunca |
| **Comprimir el prompt cambia el comportamiento del agente** | Es el riesgo real de este cambio. Por eso E va al final, en commit propio, con las reglas conservadas una a una en una tabla de equivalencia y comparación manual de respuestas antes/después |
| **La búsqueda anticipada rompe agentes que hoy llaman `search_knowledge` para seguimientos** | La herramienta NO se retira. Sigue disponible para búsquedas adicionales; lo que cambia es que la primera ya viene hecha |

## Dependencias

- `aa-metering-fail-closed` (H1): `deductTokens` consume `reply.tokensUsed`. Bajar el consumo no
  toca el gate, pero la palanca F añade una columna de medición a su lado.
- `aa-agent-skills-install-execute` (F1/F2b): el índice de skills y `usar_skill` entran en el mismo
  prompt. Con 0 skills instaladas en los agentes actuales no aportan hoy, pero la compresión de E no
  debe romper su contrato de retrocompatibilidad byte-idéntica.
- `aa-agent-backend-foundation` (F3): las 5 herramientas de backend y sus bloques de prosa son el
  mayor bulto condicional. E toca su prosa, no su gating.
