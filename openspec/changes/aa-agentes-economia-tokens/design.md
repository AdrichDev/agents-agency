# Diseño — aa-agentes-economia-tokens

## D1 — Búsqueda anticipada: dos iteraciones se convierten en una

**Hoy.** El prompt ordena `"Usa search_knowledge antes de responder preguntas sobre el negocio del
cliente."` (`engine.ts:399`). El modelo obedece, así que el flujo de cualquier pregunta real es:

```
iteración 1: [system + tools + historial + pregunta]  → el modelo responde "llama a search_knowledge"
             ejecutamos la búsqueda
iteración 2: [system + tools + historial + pregunta + tool_call + chunks] → respuesta de verdad
```

La iteración 1 no produce nada útil para el usuario: gasta ~2250 tokens sólo para que el modelo nos
diga que busquemos. Y sabemos de antemano que va a decir eso, porque se lo hemos ordenado.

**Cambio.** Recuperar los fragmentos antes de la primera llamada e inyectarlos ya:

```
búsqueda (embedding + pgvector, sin LLM)
iteración 1: [system + tools + historial + chunks + pregunta] → respuesta de verdad
```

Un mensaje típico pasa de ~6055 a ~3800 tokens, y de dos llamadas al LLM a una (~1,5 s menos de
latencia).

**Dónde se inyectan los fragmentos — decisión que importa.** NO en el `systemPrompt`. El contenido
recuperado cambia en cada mensaje; si va dentro del bloque de sistema, rompe la estabilidad del
prefijo y anula la palanca D. Van **al final**, como mensaje propio inmediatamente antes del mensaje
del usuario:

```ts
const messages = [
  { role: "system", content: system },        // estable → cacheable
  ...historyWindow,                           // estable hasta donde llegue
  ...(prefetched ? [{ role: "system", content: bloqueDeFragmentos }] : []),  // variable, al final
  { role: "user", content: userMessage },
];
```

**La herramienta `search_knowledge` NO se retira.** Sigue en el array de `tools` y sigue ejecutable:
un agente puede necesitar una segunda búsqueda distinta a mitad de razonamiento. Lo que cambia es la
instrucción, que deja de forzar la primera llamada:

- antes: `"Usa search_knowledge antes de responder preguntas sobre el negocio del cliente."`
- después: en la nota del bloque de fragmentos — *ya tienes los fragmentos relevantes; llama a
  `search_knowledge` sólo si necesitas información distinta de la que aparece abajo.*

**Guardado barato para no gastar embeddings de balde.** Un embedding cuesta del orden de 1/100 de una
iteración de LLM, pero "Hola" y "gracias" no necesitan ninguno. No se busca cuando el mensaje tiene
menos de 4 palabras y no contiene `?`. Es heurística deliberadamente tonta: fallar hacia buscar es
barato; fallar hacia no buscar cuando hacía falta lo arregla el propio modelo llamando a la
herramienta, que sigue disponible.

**Retrocompatibilidad.** Agentes sin conocimiento (`hasKnowledge === false`, p. ej. AiAs) no ven
ningún cambio: no hay búsqueda que anticipar y el prompt queda igual.

## D2 — Umbral de relevancia: dejar de inyectar ruido

**Hoy** (`embeddings.ts:26`):

```ts
export async function searchKnowledge(agentId: string, query: string, k = 5) {
  ...
  ORDER BY distance ASC
  LIMIT ${k}
```

`ORDER BY` sin `WHERE` sobre la distancia. Si el agente tiene 33 fragmentos y ninguno tiene que ver
con la pregunta, devuelve los 5 menos malos: ~5000 chars, ~1400 tokens de ruido que además empujan al
modelo a responder con lo que no es.

**Corrección respecto a la primera versión de esta spec.** Aquí se planificaba "umbral absoluto de
distancia + `k=3`". La calibración de T2.1 (medida sobre tres agentes reales de producción) dice que
**el umbral absoluto no funciona como instrumento principal**, y descubre una causa mayor que no
estaba contemplada: **un tercio del conocimiento indexado son fragmentos duplicados literales**.

### Lo que dicen los datos

| Agente | fragmentos | de contenido distinto | duplicado |
|---|---|---|---|
| DorsIA | 252 | 197 | 22% |
| Agente EDM San Blas | 67 | 41 | **39%** |
| SanBlasIA | 71 | 45 | **37%** |

Los duplicados son boilerplate de navegación que se repite en cada página del sitio scrapeado. Al ser
texto idéntico tienen **embedding idéntico**, así que se agrupan en la cabeza del ranking: DorsIA
responde a "¿qué servicios ofrecéis?" con **el mismo fragmento cinco veces** (distancias 0.5290
×5). Se paga cinco veces por un texto y el modelo no recibe ni un dato más.

Y el umbral absoluto no separa limpiamente entre agentes — los rangos se cruzan:

| Agente | peor acierto | mejor fallo |
|---|---|---|
| DorsIA | 0.6680 | 0.7248 |
| Agente EDM San Blas | 0.7499 | 0.7546 |
| SanBlasIA | 0.7487 | 0.7521 |

Un umbral de 0.70 deja a DorsIA perfecto pero **enmudece 2 de 5 preguntas legítimas** de EDM
("¿cuánto cuesta?" a 0.7499, "¿dónde estáis?" a 0.7045). Un umbral de 0.75 salva a EDM pero deja
pasar el ruido de DorsIA ("quién ganó el mundial de 1986" a 0.7248). No hay valor global limpio: las
distancias son altas en general porque los fragmentos arrastran menús de navegación que diluyen la
similitud. **El problema de fondo es la calidad del troceado, no el umbral.**

### Cambio, en orden de seguridad

1. **Dedup por contenido** (riesgo cero, el mayor ahorro): `DISTINCT ON ("contenido")` en la query.
   Recorta 22-39% de los candidatos sin perder un solo dato.
2. **`k` por defecto de 5 a 3**: −40% de bulto.
3. **Poda relativa**: conservar el mejor vecino y descartar los que estén a más de `+0.08` de
   distancia de él. Medido en los tres agentes: **0 preguntas legítimas se quedan sin ningún
   fragmento**, y los fragmentos de ruido caen de 25 a 11-12.
4. **Techo absoluto permisivo de 0.85**, solo para matar basura evidente ("¿cuánto pesa un elefante?"
   a 0.9045). Deliberadamente flojo: por encima de 0.85 no hay ni un acierto en los tres agentes.

Se elige la poda **relativa** sobre la absoluta porque es autoajustable: no depende de la calidad
absoluta del corpus de cada agente, solo de cuánto peores son los vecinos que el mejor.

Se mantiene el contrato de la función (devuelve `{source, content, distance}[]`), así que
`executor.ts:159` no cambia.

**Por qué esto no es "que funcione peor".** Es lo contrario: menos contexto irrelevante es mejor
respuesta, y devolver el mismo párrafo cinco veces no ayuda a nadie. El único riesgo real era el
umbral mal calibrado, y por eso se calibró antes de fijarlo — y se descartó como instrumento
principal.

**Deuda que abre este hallazgo** (fuera de alcance): deduplicar en la **ingesta**, no en la consulta,
y quitar el boilerplate de navegación al trocear. Hoy se paga almacenamiento y embeddings de 55
fragmentos duplicados solo en DorsIA.

## D3 — Ventana de historial: arreglar el extremo, no poner el tope

**Corrección respecto a la primera versión de esta spec.** Aquí decía que el historial no tenía tope.
Es falso, y el dato lo desmiente: `engine.ts:686` carga
`include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } }`. Hay tope de 20 mensajes, así que
el coste **no** crece sin techo y esta palanca vale mucho menos de lo que decía.

**Pero el tope coge el extremo equivocado.** `orderBy: "asc"` + `take: 20` devuelve los **20 mensajes
más antiguos**. Consecuencias en una conversación de más de 20 mensajes:

- el agente **deja de ver los últimos turnos** y sigue releyendo el arranque;
- en la práctica es amnesia de lo reciente, que es justo el contexto que importa en atención al
  cliente;
- y encima paga por reenviar contexto viejo e inútil.

**Cambio.** Coger la **cola**, no la cabeza: `orderBy: { createdAt: "desc" }, take: N` y revertir el
orden antes de mapear. `N` configurable por `HISTORY_WINDOW_MESSAGES`, por defecto **16** (8 turnos).

**Por qué 16 y por qué no se pierde nada importante:**

- Una conversación de atención al cliente resuelve en 4-8 turnos. 8 turnos de ventana cubren el caso
  normal completo.
- **Los datos durables del visitante no viven en el historial.** Van aparte, en `contextFacts`
  (`engine.ts:384`), que se construye desde el contacto persistido. Truncar el historial NO hace que
  el agente vuelva a preguntar el nombre.
- Los efectos de la conversación (lead guardado, reserva creada, intención registrada) están en base
  de datos, no en el historial.

**Reclasificación honesta de esta palanca:** el ahorro de bajar de 20 a 16 es marginal (~4 mensajes).
Lo que justifica T3 no es el ahorro, es **el arreglo funcional del extremo**. Se queda en el alcance
porque toca la misma línea, pero no se le atribuye ahorro en la tabla de resultados.

### Lo que NO hace falta: purgar los resultados de herramientas del historial

Una recomendación habitual para este síntoma es "elimina del historial los `tool` outputs una vez
generada la respuesta, para no arrastrar 3000 tokens de búsqueda en la llamada siguiente". **En este
código no aplica: ya no se arrastran.**

- Lo que se persiste son sólo mensajes `user` y `assistant` (`engine.ts:740-741`), y el historial se
  reconstruye desde ahí (`engine.ts:747-750`, `role: m.role as "user" | "assistant"`).
- Los `tool_calls` y sus salidas viven **únicamente** en el array local `messages` del bucle, y mueren
  cuando el mensaje termina.
- **El dato lo confirma:** mensaje 2 = 6054, mensaje 3 = 6771. Diferencia **+717**, que es un
  intercambio de pregunta y respuesta. Si los ~1400 tokens de fragmentos del mensaje 2 hubieran
  persistido, el mensaje 3 habría partido de ~7500 largos.

Queda escrito para no implementar un no-op.

**Por qué 16 y por qué no se pierde nada importante:**

- Una conversación de atención al cliente resuelve en 4-8 turnos. 8 turnos de ventana cubren el caso
  normal completo.
- **Los datos durables del visitante no viven en el historial.** Van aparte, en `contextFacts`
  (`engine.ts:384`), que se construye desde el contacto persistido. Truncar el historial NO hace que
  el agente vuelva a preguntar el nombre.
- Los efectos de la conversación (lead guardado, reserva creada, intención registrada) están en base
  de datos, no en el historial.

**Lo que sí se pierde:** matices de la primera parte de una conversación de más de 8 turnos. Aceptado
y anotado: si aparece un caso real que lo necesite, la alternativa es resumir los turnos antiguos con
una llamada barata, y eso se decidirá con datos, no ahora.

## D4 — Prefijo estable: cobrar el descuento del caché

Verificado en la documentación de OpenAI (`developers.openai.com/docs/guides/prompt-caching`):

- El caché es **automático a partir de 1024 tokens**. Nuestros prompts (~2250) siempre lo superan.
- Casa por **prefijo exacto**, enrutando por hash de los primeros ~256 tokens, con aciertos en
  incrementos de 128.
- **Las definiciones de herramientas entran en el prefijo cacheable**, igual que los mensajes.
- El acierto se factura a tarifa de *cached input*, más baja.

**Defecto actual.** `engine.ts:384` inserta `contextFacts` —el nombre y el email del visitante— en
medio del prompt de sistema, antes de la guía de estilo (`:401`). En cuanto el visitante dice cómo se
llama, ese bloque cambia y **invalida el caché de todo lo que va detrás**, que es justamente la parte
más grande y más estable.

**Cambio.** Todo lo variable al final. Orden nuevo del prompt de sistema:

| Posición | Contenido | Estabilidad |
|---|---|---|
| 1 | Identidad (`Te llamas "..."`) | Estable por agente |
| 2 | `agent.systemPrompt` | Estable por agente |
| 3 | Bloques de capacidades (RAG, reservas, leads, pedidos) | Estable por agente |
| 4 | Guía de estilo | Estable global |
| 5 | *(nada variable aquí)* | — |

Y `contextFacts` sale del prompt de sistema a un mensaje propio **al final** de `messages`, junto al
bloque de fragmentos de D1.

**Qué ahorra y qué no.** No baja `total_tokens`, así que **no toca el cupo del cliente**. Baja lo que
nos factura OpenAI. Es la palanca de margen, no la de cupo — conviene no confundirlas al valorar el
resultado.

## D5 — Comprimir el prompt sin perder ninguna regla

Dos bultos, con tratamiento distinto.

**a) Guía de estilo** (`style.ts`, 1893 chars, incondicional para todos los agentes y canales). Es
prosa redundante: *"Habla como una persona real del equipo: cercana, resolutiva y profesional. Nunca
como un robot ni como un manual corporativo."* son 130 chars para una regla que cabe en 40. Objetivo:
**~800 chars conservando las 15 reglas**, con tabla de equivalencia regla-a-regla en `tasks.md`. Sin
tabla no se acepta el cambio: la revisión tiene que poder comprobar que no se ha caído ninguna.

**b) Prosa de las herramientas de backend** (4 bloques, 1893 chars). **Aquí hay que ser honesto: no
es duplicación pura.** El JSON de `crear_reserva` describe *qué* hace la herramienta; la prosa
describe *el flujo* — consultar huecos primero, no inventar slots, no repreguntar el email, qué hacer
si el hueco se ocupó. Eso el esquema no lo dice, y borrarlo sí degradaría el agente.

Así que: **comprimir, no eliminar**. Los 7 pasos numerados del flujo de reserva se dicen en menos
palabras sin quitar ninguno. Objetivo conservador: −35% en estos bloques, no −100%.

**Por qué esta palanca va última.** Es la única con riesgo real de regresión de comportamiento: el
resto son cambios estructurales cuyo efecto es aritmético y verificable. Va en commit propio, después
de que A-D estén verdes, con comparación manual de respuestas antes/después sobre el mismo guion de
conversación.

## D6 — Medir lo que nos cuesta de verdad

La respuesta trae `usage.prompt_tokens_details.cached_tokens` y `cache_write_tokens`. **No los
leemos.** Consecuencia: no sabemos qué fracción de nuestro gasto va a tarifa reducida, así que no
podemos valorar D ni poner precio con datos.

**Cambio.** Acumular `cached_tokens` en el bucle igual que `tokensUsed`, y guardarlo en
`TokenUsage.contexto`, que ya es `Json?` (`schema.prisma:207`). **Sin migración.**

Lo que se le imputa al tenant sigue siendo `total_tokens`, sin cambios: este cambio añade
observabilidad, no toca la política de cobro (fuera de alcance, ver `proposal.md`).

## Ficheros

| Fichero | Palanca | Cambio |
|---|---|---|
| `back/src/lib/agent/engine.ts` | A, C, D, F | Búsqueda anticipada antes del bucle; ventana de historial; reordenar el prompt y sacar `contextFacts` al final; acumular `cached_tokens` |
| `back/src/lib/embeddings.ts` | B | Umbral de distancia y `k` por defecto de 5 a 3 |
| `back/src/lib/agent/style.ts` | E | Guía de estilo comprimida |
| `back/src/lib/token-metering.ts` | F | Persistir `cached_tokens` en `contexto` |
| `back/tests/agent-prompt-economia.test.ts` | todas | Nuevo |
| `back/tests/embeddings-relevancia.test.ts` | B | Nuevo |

Sin migración de base de datos. Sin cambios de API pública. Sin cambios en el widget.

## Estrategia de prueba

La mayoría de estas palancas son **aritméticas**, así que se prueban contando, no opinando:

- **A**: con conocimiento y una pregunta real, el bucle hace **una** llamada al cliente, no dos, y el
  array de mensajes contiene el bloque de fragmentos **después** del historial. Con `hasKnowledge`
  falso, salida byte-idéntica a la de hoy.
- **B**: con distancias por encima del umbral, devuelve `[]` en vez de 5 fragmentos malos. Con un
  acierto claro, lo devuelve.
- **C**: con 40 mensajes de historial, el array enviado contiene los **16 últimos** (no los 16
  primeros) + sistema + usuario. Los datos de contacto siguen presentes vía `contextFacts`.
- **D**: `contextFacts` no aparece en el contenido del mensaje de sistema; aparece al final. El
  prefijo de sistema de dos mensajes consecutivos de la misma conversación es **idéntico carácter a
  carácter**.
- **E**: tabla de equivalencia de reglas + prueba de que la guía comprimida sigue conteniendo cada
  prohibición (assertions por palabra clave: emojis, listas, una pregunta, fórmulas prohibidas).
- **F**: con `cached_tokens` en la respuesta simulada, queda en `contexto`; sin él, no rompe.

Y una medición de cierre, no una prueba: reejecutar la instrumentación de `buildSystemPrompt` /
`buildAgentTools` sobre Wabiks y AiAs y publicar la tabla antes/después en `tasks.md`. Sin ese número
el cambio no se puede declarar hecho, porque el objetivo del cambio *es* ese número.
