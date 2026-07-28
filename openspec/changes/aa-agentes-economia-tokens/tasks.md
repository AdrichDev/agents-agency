# Tareas — aa-agentes-economia-tokens

Nivel 3. Cuatro ficheros de código en el camino caliente del chat, sin migración y sin cambio de API.
El riesgo está concentrado en T5 (comprimir el prompt), que va aislada al final y en commit propio.
Una tarea está hecha sólo cuando su prueba está verde.

## T1 — Búsqueda anticipada: dos iteraciones se convierten en una

- [x] **T1.1** Recuperar los fragmentos antes del bucle e inyectarlos como mensaje propio **al final**
      de `messages` (después del historial, antes del mensaje del usuario). Guardado: no buscar con
      menos de 4 palabras y sin `?`. Ver §D1.
      *Test:* E1, E3.
      **Hecho.** `engine.ts`: `shouldPrefetchKnowledge` + `buildKnowledgeBlock` (exportadas, puras) +
      `prefetchKnowledge` (privada, fail-open: si el embedding o pgvector fallan se responde igual
      sin fragmentos, porque `search_knowledge` sigue en `tools`). `ToolLoopParams.knowledgeBlock`
      se inyecta como mensaje `system` entre historial y mensaje del usuario.
      El guardado dispara búsqueda si hay `?`/`¿` **o** ≥4 palabras: una pregunta corta
      ("¿precios?") sí merece búsqueda.
- [x] **T1.2** Cambiar la instrucción: fuera `"Usa search_knowledge antes de responder..."`
      (`engine.ts:399`), y en el bloque de fragmentos indicar que la herramienta se use **sólo** para
      información distinta. `search_knowledge` **no** se retira del array de `tools`.
      *Test:* E2.
      **Hecho.** La orden se retira **sólo** con `hasKnowledge === true`; sin conocimiento indexado
      se conserva byte-idéntica (AC7). El bloque RAG del prompt se reescribe para describir
      fragmentos ya entregados en vez de ordenar la búsqueda, conservando las reglas de citación.
      **Decisión de diseño:** el bloque depende de `hasKnowledge` (estable por agente) y **no** de
      si este mensaje concreto disparó la búsqueda. Si variara por mensaje rompería el prefijo
      cacheado que persigue la palanca D.
      *Verificado:* `npx tsc --noEmit` EXIT=0; suite completa **142 ficheros, 1644 pruebas verdes**,
      3 skipped (partida: 1627). 17 pruebas nuevas.

## T2 — Relevancia de la recuperación

- [x] **T2.1** **Calibrar el umbral con datos, no a ojo.** Medir las distancias reales de 10 consultas
      representativas (5 aciertos claros, 5 fallos claros) contra corpus reales de producción.
      *Verificación:* tabla de distancias en esta sección antes de tocar `embeddings.ts`.

      **Hecho el 28/07/2026**, sobre tres agentes (no uno: un solo corpus habría sobreajustado el
      valor). Distancia del **mejor** vecino de cada consulta:

      | Agente | fragmentos | peor acierto | mejor fallo | margen |
      |---|---|---|---|---|
      | DorsIA | 252 | 0.6680 | 0.7248 | +0.0568 |
      | Agente EDM San Blas | 67 | 0.7499 | 0.7546 | +0.0047 |
      | SanBlasIA | 71 | 0.7487 | 0.7521 | +0.0034 |

      **Conclusión: el umbral absoluto NO sirve como instrumento principal — los rangos se cruzan
      entre agentes.** 0.70 deja a DorsIA perfecto pero enmudece 2 de 5 preguntas legítimas de EDM
      ("¿cuánto cuesta?" a 0.7499); 0.75 salva a EDM pero deja pasar el ruido de DorsIA ("quién ganó
      el mundial de 1986" a 0.7248). Se documenta y se elige permisivo, como preveía la spec.

      **Hallazgo no contemplado, y mayor que el umbral: un tercio del conocimiento son duplicados
      literales.**

      | Agente | fragmentos | de contenido distinto | duplicado |
      |---|---|---|---|
      | DorsIA | 252 | 197 | 22% |
      | Agente EDM San Blas | 67 | 41 | **39%** |
      | SanBlasIA | 71 | 45 | **37%** |

      Boilerplate de navegación repetido en cada página scrapeada. Texto idéntico ⇒ embedding
      idéntico ⇒ se agrupa en cabeza del ranking: DorsIA respondía a "¿qué servicios ofrecéis?" con
      **el mismo fragmento cinco veces** (0.5290 ×5). Se pagaba cinco veces por un texto.

      **Poda relativa medida** (conservar el mejor vecino, descartar los que estén a más de `+margen`
      de él): con margen 0.08, **cero preguntas legítimas se quedan sin ningún fragmento** en los
      tres agentes, y el ruido baja de 25 a 11-12 fragmentos. Se elige la relativa sobre la absoluta
      porque es autoajustable al corpus de cada agente.

- [x] **T2.2** Aplicar en `searchKnowledge` (`embeddings.ts`): dedup por contenido, `k` de 5 a 3,
      poda relativa `+0.08` y techo absoluto permisivo `0.85`. Contrato de retorno intacto
      (`{source, content, distance}[]`), así que `executor.ts:159` no cambia.
      *Test:* E4, E5, E5b, E5c.

      **Hecho.** Gotcha que me comí y corregí: `DISTINCT ON ("contenido")` obliga a `ORDER BY
      "contenido"` primero, así que el `LIMIT` **no puede ir dentro** de esa consulta — cogería los
      fragmentos primeros por orden alfabético en vez de los más cercanos. La deduplicación va en una
      subconsulta y el orden por distancia se aplica fuera. Hay un test que fija esa forma del SQL.

      **Medición real contra los tres agentes, antes → después** (5 preguntas legítimas por agente):

      | Agente | fragmentos entregados | chars entregados | preguntas legítimas sin respuesta |
      |---|---|---|---|
      | DorsIA | 25 → **15** | ~25 000 → **12 594** (−50%) | 0/5 |
      | Agente EDM San Blas | 25 → **15** | ~25 000 → **10 223** (−59%) | 0/5 |
      | SanBlasIA | 25 → **15** | ~25 000 → **9 568** (−62%) | 0/5 |

      Cero fragmentos repetidos en las 30 consultas (antes, hasta 5 copias del mismo texto). El techo
      absoluto mata la basura evidente en 2 de los 3 agentes ("¿cuánto pesa un elefante?" → `[]`); en
      DorsIA, con corpus grande y diverso, la basura se queda por debajo de 0.85 y el bloque RAG del
      prompt es quien manda no inventar.

      **Efecto colateral aceptado:** el panel de inspección del propietario
      (`POST /api/knowledge/:agentId/search`, que pasa `k=5` explícito) también ve los resultados
      filtrados. Es deseable: enseña lo que el agente recibe de verdad, que es el objetivo declarado
      de "RAG visible" (F5). Un test fija que el `k` explícito se respeta.

      *Verificado:* `npx tsc --noEmit` EXIT=0; suite completa **143 ficheros, 1653 pruebas verdes**,
      3 skipped, 0 fallos.

## T3 — Ventana de historial: arreglar el extremo (fallo funcional)

- [x] **T3.1** `engine.ts:686` carga `orderBy: { createdAt: "asc" }, take: 20` — los 20 mensajes
      **más antiguos**. Pasar a `desc` + revertir, con `HISTORY_WINDOW_MESSAGES` (por defecto 16).
      `contextFacts` sigue llevando los datos durables del contacto.
      **Esta tarea no se justifica por el ahorro (marginal: 20 → 16), sino porque hoy el agente deja
      de ver los últimos turnos en cuanto la conversación pasa de 20 mensajes.**
      *Test:* E6, E7.

      **Hecho.** `HISTORY_WINDOW_MESSAGES = 16` exportada; consulta a `desc` + `.slice().reverse()`
      al construir `history`. Cubierto en `tests/engine-context-window.test.ts` (40 mensajes
      persistidos ⇒ el modelo recibe del 25 al 40, y `m1` no aparece).

      **Riesgo encontrado al implementar, y cerrado:** pasar a `desc` deja el orden a merced de los
      empates de `createdAt`. `Message.createdAt` es `@default(now())` y la persistencia va por
      `createMany` (`engine.ts:818`, `871`), así que Postgres sella el par user/assistant de un mismo
      turno con el **mismo** timestamp; sin segundo criterio puede devolver la respuesta antes de la
      pregunta. Desempate añadido por `id` (cuid = timestamp + contador, luego su orden lexicográfico
      dentro de un `createMany` coincide con el de inserción), y fijado en el test sobre `orderBy[1]`.

## T4 — Prefijo estable para el caché del proveedor

- [x] **T4.1** Sacar `contextFacts` del bloque de sistema (`engine.ts:384`) a un mensaje propio al
      final de `messages`. Orden del prompt de sistema según la tabla de §D4: nada variable dentro.
      *Test:* E8, E12.

      **Hecho.** `buildSystemPrompt` pierde el parámetro `contextFacts`; nuevo helper exportado
      `buildContextFactsBlock`, que viaja en `ToolLoopParams.contextFactsBlock` y se inserta entre
      historial y mensaje del usuario, delante del bloque de conocimiento. E8 fija lo que importa:
      el mensaje de sistema es **idéntico** entre dos mensajes consecutivos cuando el email aparece
      sólo en el segundo. Antes ese email cambiaba el prefijo y tiraba el caché de todo lo demás.

      **Efecto colateral que hubo que arreglar:** tres bloques de prosa apuntaban a los datos de
      contacto por posición ("ver datos del contacto **abajo**", `engine.ts:320`, `331`, `345`).
      Tras mover el bloque, el puntero señalaba a la nada. Retirados.

## T5 — Comprimir el prompt (aislada, commit propio, va última)

- [x] **T5.1** Guía de estilo de 1893 a ~800 chars conservando las 15 reglas.
      **Requisito de aceptación: tabla de equivalencia regla-a-regla en esta sección.** Sin ella no
      se acepta el cambio.
      *Test:* E9.

      **Hecho, pero el objetivo de ~800 chars NO se cumple: quedó en 1202 (−36,5%).** El suelo no es
      pereza, es un límite con causa: 800 sólo se alcanza borrando los literales, y los literales
      **son** la regla. A un modelo al que se le dice "no uses fórmulas artificiales" sin enseñarle
      cuáles, las produce igual; lo mismo con la lista de emojis permitidos. Cambiar 691 chars por
      degradar la voz del agente contradice el encargo ("economizar no es que no funcionen"), así que
      se corta donde deja de haber grasa. Lo que se fue: los cuatro encabezados de sección, las
      justificaciones ("en un chat nadie lee párrafos largos", "como haría una persona") y las
      perífrasis. Lo que se quedó: las 15 reglas y todos los ejemplos literales.

      **Tabla de equivalencia (las 15, una a una).** No es prosa: cada fila está fijada por un caso
      de `tests/style-guide-compression.test.ts`, que cae si la regla desaparece.

      | # | Regla (versión larga) | Sección original | Marca en la versión comprimida |
      |---|---|---|---|
      | 1 | Persona real del equipo, nunca robot ni manual corporativo | CÓMO SONAR | `persona del equipo` |
      | 2 | Mensajes CORTOS, 1-3 frases | CÓMO SONAR | `1-3 frases` |
      | 3 | UNA sola pregunta por mensaje | CÓMO SONAR | `UNA sola pregunta` |
      | 4 | Adaptar el tono al del usuario | CÓMO SONAR | `Adapta el tono` |
      | 5 | Español de España, con muletillas | CÓMO SONAR | `"vale", "perfecto", "genial", "sin problema"` |
      | 6 | Cinco fórmulas prohibidas | CÓMO SONAR | `PROHIBIDO:` + las 5 literales |
      | 7 | Máximo UN emoji por mensaje, y no en todos | EMOJIS | `máximo UNO por mensaje y no en todos (1 de cada 2-3)` |
      | 8 | Siete emojis permitidos, al saludar/confirmar/despedir | EMOJIS | `😊 👍 ✅ 📅 📍 ⏰ ✨` |
      | 9 | NUNCA emojis en temas delicados | EMOJIS | `NUNCA en quejas, incidencias, reclamaciones ni pagos fallidos` |
      | 10 | No resaludar ni presentarse a mitad de conversación | RITMO | `No vuelvas a saludar ni a presentarte` |
      | 11 | No repetir el nombre del usuario en cada mensaje | RITMO | `No repitas el nombre del usuario` |
      | 12 | No cerrar con "¿Hay algo más...?" salvo cierre real | RITMO | `¿Hay algo más...` + `salvo cierre real` |
      | 13 | Confirmar acciones breve y humano (con contraejemplo) | RITMO | `Confirma breve y humano:` + ambos ejemplos |
      | 14 | Si no sabes algo, decirlo y ofrecer siguiente paso | RITMO | `Si no sabes algo` |
      | 15 | Sin Markdown pesado; como mucho negrita puntual | FORMATO | `Sin listas, títulos, tablas` + `**negrita**` |

      El test añade además dos guardas que la tabla sola no da: el techo de 1300 chars (sin él la guía
      vuelve a engordar sin que nadie lo note) y la presencia de `OBLIGATORIO` (sin esa línea la guía
      es una sugerencia y el modelo la pisa con su formato de fábrica).

- [x] **T5.2** Comprimir la prosa de las 4 herramientas de backend un ~35%. **Comprimir, no
      eliminar**: el flujo numerado (orden de llamadas, no inventar slots, no repreguntar datos) no
      está en el JSON de la herramienta y borrarlo degradaría al agente. Ver §D5b.
      *Test:* E9 (tabla de equivalencia).

      **Hecho.** Cinco bloques tocados — los cuatro de backend más la rama de calendar crudo, que es
      el hermano gemelo del de reservas y arrastraba el mismo puntero muerto de T4.1:

      | Bloque | Qué se conserva entero, y por qué |
      |---|---|
      | `reservas` (`consultar_disponibilidad` + `crear_reserva`) | Los 7 pasos. Ninguno está en el JSON: ni el orden de llamada, ni "ofrece SOLO slots devueltos", ni el camino de slot ya ocupado |
      | calendar crudo (rama alternativa) | Los 5 pasos, por lo mismo |
      | `guardar_lead` | Las tres prohibiciones: guardar de verdad, no inventar datos, no repreguntar |
      | `calificar_lead` | Los tres criterios **con sus ejemplos**: sin ellos `hot`/`warm`/`cold` quedan a interpretación del modelo, y la rúbrica es justo lo que no debe interpretarse |
      | `consultar_pedido` | El fallback honesto: no aparece o falla ⇒ decirlo y escalar, nunca inventar un estado |

      Medido sobre agentes reales: el prompt de sistema de Wabiks baja de 6352 a **5222** chars
      (−17,8%) y el de DorsIA de 3829 a **3081** (−19,5%). El porcentaje total es menor que el 35% de
      la prosa porque el bloque de sistema es mucho más que estos cinco trozos.

- [ ] **T5.3** Comparación manual de respuestas antes/después sobre el mismo guion de conversación
      (saludo → pregunta de catálogo → petición de cita → escalado). Pegar ambas respuestas aquí.

      **BLOQUEADA, no omitida.** Requiere dos conversaciones reales contra el LLM y la cuenta OpenAI
      de la plataforma responde `429 quota exceeded`; sin cuota no hay respuesta que comparar. Es el
      mismo bloqueo de facturación registrado en `aa-openai-sin-cuota-bloquea-venta`, y no se arregla
      desde el código. **Consecuencia: la verificación de que la compresión no degrada el
      comportamiento queda pendiente y no debe darse por hecha.** Lo que sí está cubierto sin cuota
      es que no se ha perdido ninguna regla (T5.1/T5.2 + E9, 19 casos verdes); lo que falta es la
      comprobación de que el modelo las sigue igual de bien dichas más corto.

## T6 — Medir el coste real

- [x] **T6.1** Acumular `usage.prompt_tokens_details.cached_tokens` en el bucle y persistirlo en
      `TokenUsage.contexto` (ya es `Json?` — sin migración). Lo imputado al tenant no cambia.
      *Test:* E10, E11.

      **Hecho.** `AgentReply.usageBreakdown = { promptTokens, cachedTokens, iterations }`, acumulado
      en el bucle y escrito por `deductTokens` (8º parámetro, opcional) en `TokenUsage.contexto`. Sin
      migración. Lo imputado al cupo sigue siendo `tokensUsed`, intacto.

      Esta es la tarea que **acaba con las estimaciones**: todo lo de T7.1 son chars/4, una
      aproximación. `cachedTokens` es lo único que demuestra que T4.1 funciona en vez de suponerlo, e
      `iterations` es la comprobación en producción de AC1 (un mensaje = una llamada). Todo con `?? 0`
      porque `prompt_tokens_details` es opcional y no lo manda todo proveedor (el camino openclaw, por
      ejemplo); si no viene, no se rompe nada.

## T7 — Verificación

- [ ] **T7.1** **Medición de cierre (AC8).** Reejecutar la instrumentación sobre Wabiks y AiAs y
      publicar aquí la tabla antes/después. Punto de partida medido el 27/07/2026:

      | Agente | system prompt | tools | base/iteración | mensaje típico observado |
      |---|---|---|---|---|
      | Agente Wabiks | 6365 chars (~1591 tok) | 8 tools, 4381 chars (~1252 tok) | ~2250 tok | **6054** |
      | AiAs | 3911 chars (~978 tok) | 3 tools, 1253 chars (~358 tok) | ~1336 tok | **1257** |

      Objetivo: mensaje típico de Wabiks por debajo de **2500**.

      **Medición de cierre, 28/07/2026.** Mismo instrumento, mismos agentes, mismas preguntas.

      | Agente | system | tools | base/iteración | turno típico | antes |
      |---|---|---|---|---|---|
      | Wabiks (33 frag) | 5222 chars (~1306 tok) | 8 tools, 4381 chars (~1095 tok) | ~2401 tok | **3078 - 3243** | 6054 |
      | AiAs (0 frag) | 3163 chars (~791 tok) | 3 tools, 1253 chars (~313 tok) | ~1104 tok | **1110** | 1257 |
      | DorsIA (252 frag) | 3081 chars (~770 tok) | 3 tools, 1253 chars (~313 tok) | ~1084 tok | **1602 - 1875** | — |

      **Wabiks: 6054 → ~3150. −48%.** El grueso no lo puso la compresión de T5 (−18% del bloque de
      sistema) sino T1: antes el turno típico gastaba **dos** llamadas al LLM y ahora gasta una, así
      que la base dejó de pagarse dos veces.

      **AC8 NO se cumple: 3150 no está por debajo de 2500.** El objetivo era mío y era optimista, y
      conviene decir por qué falla en vez de moverlo. Del turno de Wabiks quedan tres piezas:

      | Pieza | Tokens | ¿Queda margen aquí? |
      |---|---|---|
      | JSON de las 8 tools | ~1095 | **Sí, y es el mayor.** Pero se recorta eligiendo qué herramientas recibe cada agente, no reescribiendo descripciones: es `allowed_tools`, deuda ya anotada |
      | Prompt de sistema | ~1306 | Poco. Ya comprimido; el resto es identidad del negocio, que es lo que hace útil al agente |
      | 3 fragmentos de conocimiento | ~670 - 836 | Sí, ~200: entre el 22% y el 39% de lo indexado es menú de navegación duplicado. Es la deuda de dedup en ingesta |

      Es decir: el hueco de 650 tok que falta está **entero** en dos deudas registradas y fuera del
      alcance de este cambio, no en más compresión. Bajar de 2500 es un cambio aparte, y decidirlo es
      del propietario. Lo que este cambio entrega es la mitad del consumo, medida.

      Con el cupo de 10M por agente: **1650 → ~3170 mensajes** por agente. Con `allowed_tools` y el
      dedup de ingesta rondaría los 4000.

- [x] **T7.2** `npx tsc --noEmit` EXIT=0 y suite completa verde (partida: 142 ficheros, 1627 pruebas).

      **Verde. `npx tsc --noEmit` EXIT=0.** Suite tras A-E: **144 ficheros, 1668 pruebas, 0 fallos**
      (3 omitidas, ya omitidas antes). Nuevos: `engine-context-window.test.ts` (12, T3/T4/T6),
      `knowledge-search-relevance.test.ts` (T2) y `style-guide-compression.test.ts` (19, E9).

      Nota de la ejecución: 9 aserciones de `deductTokens` en cuatro ficheros existentes fallaron al
      añadir el 8º parámetro, porque `toHaveBeenCalledWith` compara la aridad completa. Cerradas con
      `expect.anything()` en la última posición: esas pruebas verifican el hilo tenant→cargo, y el
      desglose de T6 se afirma donde le toca, en `engine-context-window.test.ts`.
- [x] **T7.3** Revisión antes de commitear (`sdd-verify` o `/code-review`), con hallazgos anotados
      aquí.

      Revisión del diff completo (5 ficheros de `src`, 9 de `tests`). Cuatro comprobaciones que podían
      haber salido mal y no salieron, y un aviso de escala:

      1. **El filtro de T2.2 no puede empujar al agente a inventarse el catálogo.** `searchKnowledge`
         ahora devuelve `[]` cuando el vecino más próximo pasa de `MAX_DISTANCE`, y eso deja al agente
         con `hasKnowledge = true` y cero fragmentos. Sería un caso perfecto para alucinar, pero el
         bloque ya lo cubría explícitamente (`engine.ts:302-303`: "Si no se te entrega ningún
         fragmento relevante, responde con tus instrucciones base. NO inventes productos"). Sin esa
         línea, T2.2 habría sido peligroso.
      2. **Los dos puntos de retorno de `runToolLoop` llevan `usageBreakdown`** (`engine.ts:618` y
         `650`): el de salida sin tool-calls y el del límite de iteraciones. Si faltara uno, el desglose
         desaparecería justo en los turnos raros, que son los que interesa observar.
      3. **Los productores de `AgentReply` que no miden no se rompen.** `usageBreakdown` es opcional y
         `deductTokens` lo esparce condicionalmente, así que un camino sin `usage` (openclaw) escribe la
         fila igual que antes, sin `contexto`.
      4. **`DISTINCT ON` no se lleva ninguna fuente por delante en la práctica**: agrupa por contenido
         idéntico, y el duplicado literal es precisamente boilerplate de navegación. Si dos páginas
         distintas comparten un párrafo, se cita una de las dos: aceptable frente a repetir el mismo
         párrafo cinco veces.

      **Aviso de escala (no bloquea).** No existe índice ANN (`ivfflat`/`hnsw`) sobre `embedding`;
      verificado, no hay ninguno en las migraciones. La consulta ya recorría todos los fragmentos del
      agente; la subconsulta de dedup añade una segunda ordenación (por `contenido`). Con los corpus
      actuales (máximo 252 fragmentos, DorsIA) es ruido. Si un cliente llega a decenas de miles pasa a
      ser latencia, y entonces toca índice ANN — que además haría el `DISTINCT ON` incompatible con el
      escaneo por índice, así que el dedup tendría que subir a la ingesta. Que es, precisamente, la
      deuda ya anotada abajo.

      **Sobre el coste de la revisión:** 9 aserciones de `deductTokens` pasaron a llevar
      `expect.anything()` en la última posición, lo que las hace un pelo menos estrictas sobre la
      aridad. Es a propósito: esas pruebas afirman el hilo tenant→cargo, y el desglose se afirma con
      valores exactos en `engine-context-window.test.ts` (E10/E11).

## Orden crítico

```
T1.1 → T1.2 → T2.1 (calibrar) → T2.2 → T3.1 → T4.1 → T6.1 → T7.2 → [commit]
   → T5.1 → T5.2 → T5.3 → T7.2 → T7.1 (medición) → T7.3 → [commit propio]
```

**Desvío del orden, declarado.** Se ha hecho **un solo commit**, no dos. El motivo del corte era poder
revertir T5 sin arrastrar el resto, y eso se sigue pudiendo: la superficie de T5 es exactamente
`style.ts`, `tests/style-guide-compression.test.ts` y cinco bloques de texto en `engine.ts`, cada uno
marcado con `T5.2` en su comentario. Partir `tasks.md` en dos commits para conservar la frontera
habría significado escribir una versión intermedia del documento que nunca fue verdad. No se hace.

T5 va después de un commit verde de A-D a propósito: si la compresión degrada el comportamiento, se
revierte sola sin arrastrar los cambios estructurales, que son los que traen el 80% del ahorro.

## Gates humanos

- [ ] **G1** Aprobación del alcance (esta spec) antes de escribir código.
- [x] **G2** Aprobación para desplegar, con la medición de T7.1 sobre la mesa.

      Concedida el 28/07/2026 ("sirve para desplegar") con AC8 sin cumplir y T5.3 bloqueada sobre la
      mesa. Merge fast-forward a `master` y push: **2304bf6**. Sin migraciones, así que sin gate de BD.
      Puntero del repo raíz bumpeado (`d82bb11`, local: la raíz no tiene remoto).

      **Deploy confirmado, y no por el uptime:** la respuesta de prod trae el campo `usageBreakdown`,
      que sólo existe a partir de este commit.

### Smoke en producción — los primeros tokens REALES

Todo T7.1 era `chars/4`. Esto no: son `usage` del proveedor, vía T6.1. Agente **AiAs**
(`cmq9m0o4k0001n8fxmave9sr4`, `published`, `gpt-5.4-mini`), dos mensajes, `test: true`.

| # | mensaje | tokensUsed | promptTokens | cachedTokens | iterations | tool |
|---|---|---|---|---|---|---|
| 1 | "Hola, ¿qué servicios ofrecéis?" | 2242 | 2169 | 0 | **2** | `search_knowledge` → `[]` |
| 2 | "me interesa una web para mi negocio" | 2369 | 2310 | 0 | **2** | `record_lead_intent` |

La estimación de T7.1 daba ~1110 tok/turno para AiAs **asumiendo una iteración**. Con dos, 2×1104 =
2208, contra 2242 medidos. El modelo de estimación era correcto; el supuesto de una iteración, no.

**Hallazgo 1 — AC1 no se cumple en prod, y para los agentes sin conocimiento es desperdicio puro.**
`engine.ts:433`: cuando `hasKnowledge` es false, el prompt ordena "Usa search_knowledge antes de
responder preguntas sobre el negocio del cliente" — y `search_knowledge` se ofrece en el array de
herramientas sin condicionar al número de fragmentos. AiAs tiene **cero** fragmentos indexados, así que
esa orden garantiza una llamada al LLM de más cuyo resultado sólo puede ser `[]`. Medido: mensaje 1
gastó 2242 tok donde una iteración habría gastado ~1100. **Es la mitad del coste del mensaje, tirada,
en cada mensaje.** T1.2 lo dejó "byte-idéntico" a propósito para respetar AC7, pero AC7 protegía el
comportamiento, no una orden que no puede tener efecto. Las dos iteraciones del mensaje 2 son
legítimas: `record_lead_intent` escribe de verdad.

**Hallazgo 2 — el instrumento de T6.1 no distingue "sin acierto de caché" de "el proveedor no reporta
el campo".** Ambos casos escriben `cachedTokens: 0`, porque el acumulador usa `?? 0`. Con
`promptTokens` de 2169 y 2310 (por encima del mínimo de 1024) cabría esperar acierto en la segunda
iteración de cada mensaje, cuyo prefijo es el prompt entero de la primera. Que salga 0 puede significar
que `gpt-5.4-mini` no devuelve `prompt_tokens_details`, o que el caché no acierta. **Con lo que hay
registrado no se puede decidir**, y era justo lo que T6.1 venía a resolver. Hace falta distinguir
ausencia de cero.

## T8 — Arreglos de los dos hallazgos del smoke

- [x] **T8.1** `search_knowledge` sólo se ofrece si el agente tiene ≥1 fragmento indexado, y la orden
      de usarla desaparece del prompt en todos los casos. → **E13**
      - `buildAgentTools` recibe un séptimo parámetro `hasKnowledge = true` y filtra `KNOWLEDGE_TOOL`
        cuando es false. El defecto es `true` para que los call-sites que no saben del conocimiento
        (y los tests que ya existían) vean el output previo sin tocarlos.
      - `chatWithAgent` calcula `knowledgeCount` **antes** de construir las herramientas, porque ahora
        decide dos cosas y no una.
      - `engine.ts` deja de emitir "Usa search_knowledge antes de responder" también con
        `hasKnowledge === false`: sin herramienta, la orden sólo podía costar una iteración para
        obtener `[]`.
      - **AC7 enmendado en `validation.md`**, no reinterpretado en silencio: el criterio original
        exigía prompt byte-idéntico sin conocimiento, y eso era exactamente lo que blindaba el
        defecto. E12 queda marcado como superado por E13, con el motivo escrito.
      - Dos tests preexistentes fijaban la orden retirada (`engine.test.ts`, "base: nombre, líneas
        fijas siempre" y "incluye la línea fija … incluso con hasKnowledge=false"). Se han cambiado
        para fijar lo contrario, con el motivo en el comentario.
      - **Ahorro medido contra la BD de producción, no estimado.** `Message.toolCalls` persiste lo
        que se llamó de verdad. Los 7 últimos mensajes de asistente de AiAs (único agente
        `published`, con `_count.knowledge === 0`):

        | Herramientas del mensaje | Mensajes | ¿T8.1 lo arregla? |
        |---|---|---|
        | `["search_knowledge"]`, `output` = `[]` en las 4 | 4 | **Sí** — la iteración entera sobraba |
        | `["record_lead_intent"]` | 2 | **No** — lo cierra T8.6 |
        | `[]` | 1 | No aplica: ya costaba 1 iteración |

        Es decir ~1100 tok menos en **4 de 7** mensajes (~57%), no en todos. La redacción anterior
        —"la mitad del coste del mensaje medido en AiAs"— generalizaba un mensaje a todos y hacía
        parecer T8.1 el arreglo completo del `iterations: 2`. Lo es sólo para esta clase. Sin efecto
        en agentes con conocimiento.

- [x] **T8.3** `POST /api/chat` deja de devolver campos internos al visitante anónimo. → **§D1**
      - **Cómo se encontró:** petición **anónima y cross-origin** contra
        `aa-back-jmyo.onrender.com/api/chat` con la `publicKey` de AiAs. El cuerpo devuelto traía
        `toolCalls` (con el `input` y el `output` crudos de la herramienta), `tokensUsed`, `model`,
        `usageBreakdown` y `latencyMs`.
      - **Por qué existía:** `chatWithAgent` desestructura `meteredTenantId` y `credentialMode` con
        el razonamiento correcto escrito al lado ("esta respuesta la recibe el visitante del widget").
        Pero es una **denylist**: cada campo nuevo del `AgentReply` sale a la calle por defecto.
        `usageBreakdown` lo añadió T6.1 de este mismo change.
      - **Arreglo:** allowlist en el borde HTTP (`ai.ts`), no en el motor — el motor no sabe quién
        lee. Sin sesión ⇒ `{ conversationId, text }` y nada más; con sesión ⇒ reply completo, porque
        `ChatTester` pinta tool calls, modelo, tokens y latencia. Es la misma regla que
        `responderFallo` ya aplicaba a los errores y que el camino de éxito no aplicaba.
      - **Alcance de la fuga:** `toolCalls.output` es lo que devolvió la herramienta —
        `search_knowledge` entrega los fragmentos con sus fuentes, un backend `managed_db` entrega
        filas del cliente, `consultar_pedido` datos de pedido, `list_emails` asuntos de correo.
      - **Verificado por lectura de código, no supuesto:** los únicos dos llamadores de la ruta son
        `back/public/widget.js` (usa `conversationId`, `text`, `error`) y `ChatTester` vía `api()`
        (siempre con sesión, y ya manda `test:true`, que el back sólo honra con `req.user`).

- [x] **T8.2** `cachedTokens` pasa a `number | null`: `null` = el proveedor no informó del campo,
      `0` = informó y el caché no acertó. → **E14**
      - El acumulador sólo suma si `prompt_tokens_details.cached_tokens` es un número; si ningún
        proveedor informa en ninguna iteración, queda `null`.
      - `AgentReply.usageBreakdown.cachedTokens` y el parámetro `contexto` de `deductTokens`
        (`Record<string, number | null> | null`) se ensanchan en consecuencia. Guardar 0 en lugar de
        null convertiría un dato ausente en un dato falso.
      - E11 en `engine-context-window.test.ts` esperaba `0` para una respuesta sin
        `prompt_tokens_details`. Ese valor esperado ERA el defecto; ahora espera `null`.
      - Esto **no** responde todavía si el caché de OpenAI acierta con `gpt-5.4-mini`. Lo que hace es
        que el próximo smoke pueda responderlo en vez de dejarlo a suposición.

- [~] **T8.4** Cierre en la misma vuelta con herramientas de acuse. **IMPLEMENTADO, MEDIDO Y
      REVERTIDO.** → E15 retirado
      - **Idea:** si el modelo ya escribió `content` y sólo llamó a herramientas cuyo output es un
        eco (`record_lead_intent`), ejecutar la herramienta y cerrar sin dar la segunda vuelta.
      - **Objeción del usuario, correcta:** "la segunda vuelta reenvía todo el prompt para reescribir
        lo que ya existe". Es decir: el ahorro dependía por completo de que hubiera `content` que
        reutilizar, y eso no se había medido.
      - **Medición directa contra la API** (3 ejecuciones, `gpt-5.4-mini`, prompt de sistema
        ordenándole explícitamente responder en el mismo turno): `content: null` en **3 de 3**, con
        `finish_reason: "tool_calls"`. No hay texto que reutilizar. La condición de cierre **nunca**
        se cumple con este modelo.
      - **Veredicto:** código muerto. Revertido entero: bloque de cierre en `runToolLoop`, export
        `ACK_ONLY_TOOLS` en `tools.ts` y los 5 tests que lo cubrían. Se deja escrito aquí, y no
        borrado, porque el error de método importa: se envió una optimización condicionada a un
        comportamiento del modelo **sin medirlo**, dentro de un change cuya premisa es medir.
      - Sustituido por T8.6, que ataca el mismo coste por el otro lado.

- [x] **T8.6** `record_lead_intent` retirada; `leadIntent` se deriva fuera del bucle agéntico.
      → **E16**, **E17**
      - **El coste que cierra:** los 2 de 7 mensajes de la tabla de T8.1 que T8.1 no cubría. Una
        herramienta cuyo `output` es un eco de su propio argumento (`{recorded, intent}`) no aporta
        nada al modelo, y sin embargo el bucle ignora `msg.content` cuando hay `tool_calls`, así que
        el turno costaba **dos** llamadas al LLM: ~1100 tok de los ~2225 medidos en prod.
      - **Decisión del usuario** entre quitar la tool o conservarla: quitarla y derivar el dato al
        crear el lead.
      - **Retirado**: `INTENT_TOOL` (`tools.ts`), su handler (`executor.ts`), su presencia en el
        array de tools y la orden de llamarla en el prompt (`engine.ts`). Lo que **se conserva** es
        la conducta que sí afecta la conversación: pedir el nombre ante interés real. Registrar el
        dato es trabajo nuestro, no del modelo.
      - **Nuevo `agent/lead-intent.ts`**: una llamada de ~300 tok, `max_completion_tokens: 32`, con
        los últimos 10 mensajes delante en orden cronológico. Se invoca sin esperar (`void` +
        `.catch`) desde los dos puntos de retorno de `chatWithAgent`, así que no añade latencia.
      - **Cortes que evitan gasto**, en este orden: `leadIntent` ya presente (idempotencia — el lead
        se actualiza varias veces por conversación y esto se paga una), no hay Lead en la
        conversación, no hay ningún mensaje del visitante.
      - **Cubre los cuatro sitios que crean leads** sin acoplarse a ninguno (flujo de captación,
        `request_human_handoff`, `calificar_lead`, `crear_lead` del backend): se invoca por mensaje y
        corta solo. Un lead creado por una herramienta se deriva en el mensaje siguiente.
      - **H1 respetado**: pasa por `deductTokens` con `operacion: "lead_intent"`, y **antes** de
        decidir si el resultado sirve — no registrar lo gastado por haber salido `NINGUNA` sería
        consumo invisible. **H2 respetado**: `getClientForAgent` con el `credentialMode` que resolvió
        el gate, no uno releído.
      - **Tests preexistentes invertidos, con el motivo escrito**: 5 aserciones fijaban que
        `record_lead_intent` estuviera SIEMPRE en las tools y en el prompt (`engine.test.ts`), y 2
        fijaban su nombre, su esquema y su handler (`ecommerce-flow.test.ts`). Protegían el defecto.
      - **Contrapartida asumida**: el dato deja de ser inmediato al turno donde se expresa la
        intención, y se calcula con el hilo completo en vez de con un turno aislado. La columna
        "intent" del panel de leads (`service.ts:877`) sigue siendo su único consumidor.

- [x] **T8.5** `POST /api/chat` valida el mensaje antes de gastar cupo. → **§D2**
      - `!message` no comprobaba el tipo: `{"message":{}}` y `{"message":["hola"]}` pasaban el guard
        y llegaban al motor, que los pone tal cual en `content`. Ahora exige `string` no vacía.
      - Tope de longitud `MAX_CHAT_MESSAGE_CHARS` (4000 por defecto, ~1000 tokens, configurable).
        Antes el único techo era `express.json({ limit: "2mb" })` (`index.ts:97`): en una ruta
        pública y cross-origin donde cada petición descuenta del cupo del tenant, el coste por
        petición lo elegía quien la enviaba.
      - Esto era **deuda anotada** en este mismo documento. Se cierra aquí porque el arreglo es un
        guard de dos líneas y el hueco está en la ruta que sostiene el producto.

- [x] **T8.7** El `leadIntent` de T8.6 gastaba cupo y no guardaba nada. Fallo propio, desplegado.
      - Síntoma en producción: fila en `uso_tokens` con `operacion: "lead_intent"` y 159 tokens, y
        `Conversation.metadata` SIN `leadIntent`. Reproducido dos veces con el mismo número exacto.
      - Causa, medida contra la API con el cliente **gobernado** (que es el de producción):
        `governChatBody` inyecta el `reasoning_effort` global (`low` por defecto,
        `openai.ts:58`) a todo body **sin `tools`**, y en un modelo razonador
        `max_completion_tokens` **incluye los tokens de razonamiento**. Con el tope en 32 —elegido
        pensando que era "el tamaño de la etiqueta"— el razonamiento se lo comía entero:

        | body | finish_reason | content | total | reasoning |
        |---|---|---|---|---|
        | como estaba en prod | `length` | `""` | 159 | 32 |
        | `reasoning_effort: "none"` | `stop` | `"web básica"` | 132 | 0 |
        | `reasoning_effort: "none"` (repite) | `stop` | `"web para mi negocio"` | 140 | 0 |

      - Arreglo: pedir `none` (lo admiten los `gpt-5*` según `model-capabilities.ts`) y subir el tope
        a 256. El tope holgado no es un descuido: si un modelo del catálogo no admite `none`, la
        gobernanza cae a SU default y el razonamiento vuelve a consumir presupuesto. Se factura lo
        generado, no el tope, y la etiqueta se acota por caracteres (`MAX_INTENT_CHARS`).
      - Verificado ejecutando `inferLeadIntent` real contra la fila de producción: metadata pasa de
        `{"leadFlow":{...}}` a `{"leadFlow":{...},"leadIntent":"web básica"}`, y una segunda pasada no
        gasta nada (idempotencia).
      - Aviso sobre los números: el 159 de antes y el 138 de después **no son una comparación de
        ahorro**, y el 138 no es "lo que cuesta la llamada" — el coste depende de la transcripción que
        se le pase (hasta 10 mensajes). El dato es cualitativo y no depende del prompt: con el tope a
        32 el razonamiento se lo come **siempre**, así que los 159 compraban `content: ""`, y los 138
        compran la etiqueta. La prueba del defecto es `finish_reason: "length"`, no la cifra.
      - **La lección de método es la misma que dejó T8.4**: el tope de 32 se eligió razonando sobre
        el tamaño de la salida, sin mirar que el parámetro cuenta también el razonamiento. Se
        desplegó sin medir el efecto real, en un change cuya premisa es medir.

- [x] **T8.8** `chatWithAgent` borraba lo que las herramientas escribían en `metadata`.
      - Encontrado al investigar T8.7, no buscado. `engine.ts` leía `Conversation.metadata` al ABRIR
        el turno y al cerrarlo escribía `{ ...ese snapshot, leadFlow }`. Entre las dos cosas corre
        `runAgent`, así que cualquier clave que una herramienta hubiera guardado por el camino
        desaparecía.
      - Víctima medida: `handoff: true`, que pone `executor.ts:197` al atender
        `request_human_handoff`. Censo en la BD de producción: **35 conversaciones, 1 ejecutó la
        herramienta, 0 conservan el flag**. Y ese flag es justo el que `service.ts:878` publica en el
        listado de leads — el panel del cliente nunca marcaba como escalado un lead escalado.
      - Arreglo: las dos escrituras pasan por `mergeConversationMetadata`, que relee la fila y mezcla
        sólo el parche. Dos pruebas de regresión en `engine-context-window.test.ts`.
      - Efecto de arrastre en el arnés: la lectura nueva obligó a añadir `conversation.findUnique` al
        mock de `prisma` en 6 ficheros de test. Son mocks incompletos, no código roto.

**Verificación T8.** `tsc --noEmit` EXIT=0 y los tests nuevos verdes, pero eso **no es la
evidencia**: dos de los tests que había que cambiar eran tests que *protegían* el defecto (la
aserción de prompt byte-idéntico de AC7 y `expect(cachedTokens).toBe(0)`). Una suite verde puede
codificar el fallo. La evidencia de T8 es de producción:

| Afirmación | Evidencia |
|---|---|
| AiAs no tiene conocimiento | BD prod: `_count.knowledge === 0` |
| `search_knowledge` devolvía `[]` | BD prod: `Message.toolCalls[].output === []` en 4 de 4 |
| Reparto de clases de mensaje | BD prod: tabla de T8.1, 7 mensajes |
| La fuga de §D1 era real | HTTP anónimo cross-origin contra prod, cuerpo capturado |
| El cierre de T8.4 nunca saltaba | API directa, `content: null` en 3 de 3 con `gpt-5.4-mini` |

Sin migraciones.

**T8.3 y T8.5 verificados en producción tras el deploy de `a9fdf3a`:**

- T8.5 — una petición con `message` de más de 4000 caracteres y sin `publicKey` pasó de `404
  AGENT_NOT_FOUND` a `400 BAD_REQUEST` con el texto saneado para el visitante. La guarda corre antes
  de buscar el agente, así que la comprobación no consume nada de cupo.
- T8.3 — la misma petición anónima cross-origin que antes filtraba devuelve ahora exactamente dos
  claves, `['conversationId', 'text']`. Antes salían además `toolCalls` (con `input` y `output`
  crudos), `tokensUsed`, `model`, `usageBreakdown` y `latencyMs`.

## AC8 — medición de cierre, en producción

Un total de tokens no significa nada por sí solo: depende del texto del visitante, del historial y
del bloque de sistema. Así que la comparación se acota a lo único comparable — **todas las filas de
`uso_tokens` de este agente que tienen desglose (`contexto`)**, que son cinco, con el historial
previo contado en la propia tabla `Message`:

| momento | tokens | prompt | vueltas | mensajes previos | texto del visitante |
|---|---|---|---|---|---|
| antes, 27/07 23:31 | 2242 | 2169 | 2 | 2 | `"Hola, que servicios ofreceis?"` |
| antes, 27/07 23:32 | 2369 | 2310 | 2 | 4 | (misma conversación, 2º turno) |
| antes, 27/07 23:55 | 2225 | 2180 | 2 | 2 | `"me interesa una web para mi negocio"` |
| antes, 28/07 00:51 | 1979 | 1893 | 2 | 2 | `"...cuanto cuesta?"` |
| **después, 28/07 01:10** | **960** | **905** | **1** | **2** | `"Hola, que servicios ofreceis?"` |

El par limpio son la primera fila y la última: **mismo agente, mismo texto exacto, mismo historial
previo (2 mensajes)** ⇒ **2242 → 960, −57 %**. Contra el conjunto entero de las cuatro anteriores
(rango 1979–2369) el ahorro es −56 %. Lo que cambia entre ambas es exactamente lo que ataca el
change: `vueltas` pasa de 2 a 1 en las cinco filas medidas, y el prompt cae de 2169 a 905 porque
además de la vuelta desaparecen las instrucciones de la herramienta del bloque de sistema.

Limitaciones que esta medición **no** salva, y que hay que decir:

- **La fila "después" es n = 1.** No se ha caracterizado la varianza; no se afirma que 960 sea el
  coste típico de un mensaje, sólo que en el par controlado cuesta un 57 % menos.
- Las dos filas de 27/07 20:02 (2638) y 20:23 (2605) que aparecían en una versión anterior de esta
  tabla **no tienen `contexto`** (son previas a T6.1). Se retiran: sus totales existen, pero
  presentarlas como leídas del desglose era falso, y sin `vueltas` ni `promptTokens` no se pueden
  comparar con nada.
- El −57 % es el efecto **acumulado del change** (T8.1 + T8.6 + ventana + prefijo), no de una tarea
  concreta.

La vuelta que se ahorra costaba ~1300 tokens, y eso cuadra con el mensaje de 27/07 21:40 que no llamó
a ninguna herramienta y costó 1257.

Atribución de la segunda vuelta en los 8 mensajes de AiAs, leída de `Message.toolCalls`: 5
`search_knowledge` (los cierra T8.1), 2 `record_lead_intent` (los cierra T8.6), 1 `request_human_handoff`.

Lo que **no** se ha medido y no se afirma:

- El único mensaje post-deploy con 2 vueltas (28/07 00:51, 1979 tok) las gastó en
  `request_human_handoff`, que es una llamada **legítima**: su `output` decide la respuesta. Con un
  agente de 0 fragmentos, escalar a un humano ante una pregunta de precio es la conducta correcta,
  no un desperdicio. Ese caso seguirá pagando dos vueltas a propósito.
- `cachedTokens` sale **0** en las cuatro filas con desglose, con prompts de 900 a 2300 tokens. No se
  ha averiguado por qué. Queda abierto: puede ser que el proveedor no informe, o que el prefijo no
  llegue al mínimo de caché, o que la ventana deslizante lo rompa. Afirmar cualquiera de las tres sin
  medirla sería repetir el error de T8.4.

Suite completa tras T8.6–T8.8: **1721 casos, 1718 pasando, 0 fallando, 3 saltados** (baseline antes
de T8: 1704 / 3). `tsc --noEmit` sin salida. De nuevo, y es lo importante: eso acredita que no se
rompió nada, **no** que se ahorre. El ahorro lo acredita la tabla de arriba.

## Fuera de alcance, anotado como deuda

- **Subir `DEFAULT_TOKEN_QUOTA_PER_AGENT`** (`quota.ts:33`, hoy 10M) o escalarlo por plan. Los tres
  planes de `service-catalog.ts:23-25` llevan el mismo cupo cobrando 39 €, 99 € y 149 €.
- **Límite de turnos por conversación** como freno anti-abuso: `aiLimiter` permite 20 mensajes por
  minuto y por IP (`limiters.ts:28`), con lo que una sola IP puede fundir un cupo de 10M en ~3,6 h.
  Es seguridad, no economía.
  Con T8.5 el coste por petición ya está acotado (4000 caracteres), así que ese cálculo es el
  techo real y no el suelo. Lo que sigue abierto es el número de turnos, que es seguridad.
- **Qué se le imputa al tenant**: hoy `total_tokens`, incluida la plantilla que reenviamos nosotros y
  que el proveedor nos cobra con descuento por caché. Es política comercial.
- **`allowed_tools`** para restringir herramientas por llamada sin romper el prefijo cacheado (existe
  en la API de OpenAI). Interesante si algún agente acumula muchas herramientas; hoy el máximo son 8.
- **Resumen de los turnos antiguos** en lugar de truncado seco, si aparece un caso real que lo pida.
- **Deduplicar en la INGESTA, no solo en la consulta** (deuda abierta por T2.1). `knowledge-duplicates.ts:16`
  busca duplicados por `{ agentId, source, content }`: la clave incluye `source`, así que el mismo
  boilerplate de navegación scrapeado desde 9 URLs distintas entra 9 veces. Hoy se paga
  almacenamiento y embeddings de 55 fragmentos redundantes solo en DorsIA. T2.2 lo tapa en la lectura,
  no en el origen. Relacionado: quitar menús de navegación al trocear (`chunkText`), que es lo que
  hunde la calidad de las distancias y lo que hace inviable un umbral absoluto limpio.
