# Validación — aa-agentes-economia-tokens

## Historia de usuario

> Como propietario de la plataforma, quiero que cada mensaje de un agente consuma los tokens
> mínimos necesarios, para que el cupo de un cliente dure una cantidad razonable de conversaciones
> y para que mi coste por conversación sea el que dicta el trabajo real, no el reenvío de mi propia
> plantilla — **sin que el agente pierda ni una capacidad ni empeore sus respuestas**.

## Criterios de aceptación

- **AC1** Un mensaje que necesita conocimiento del negocio se resuelve con **una** llamada al LLM, no
  dos. La herramienta `search_knowledge` sigue disponible para búsquedas adicionales.
- **AC2** La recuperación de conocimiento no devuelve fragmentos irrelevantes ni repetidos: no
  devuelve el mismo contenido dos veces, poda los vecinos mucho peores que el mejor, y por encima del
  techo absoluto devuelve vacío en lugar de los menos malos.
- **AC3** El historial enviado al modelo está acotado, y acotarlo **no** hace que el agente
  repregunte datos del contacto que ya conoce.
- **AC4** El bloque de sistema es idéntico carácter a carácter entre dos mensajes consecutivos de la
  misma conversación, incluso cuando el visitante revela su nombre a mitad de conversación.
- **AC5** La guía de estilo comprimida conserva **todas** las reglas de la versión larga.
- **AC6** El consumo imputado al tenant sigue siendo `total_tokens` (sin cambio de política), y
  además se registra `cached_tokens` para conocer el coste real.
- **AC7** Un agente sin conocimiento (`hasKnowledge === false`) produce un prompt **byte-idéntico** al
  de antes del cambio, salvo el reordenado de AC4.
- **AC8** Medición de cierre publicada: tabla antes/después de tokens por mensaje para Wabiks y AiAs.

## Escenarios

### E1 — Búsqueda anticipada: una sola iteración (AC1)

- **Given** un agente con fragmentos de conocimiento y una pregunta sobre el negocio
- **When** se procesa el mensaje
- **Then** el cliente del LLM se invoca **una** vez, y el array de mensajes incluye un bloque con los
  fragmentos recuperados situado **después** del historial y **antes** del mensaje del usuario

### E2 — La herramienta sigue viva (AC1)

- **Given** el mismo agente
- **When** se construyen las herramientas
- **Then** `search_knowledge` sigue presente en el array de `tools`

### E3 — Saludo corto no gasta embedding (AC1)

- **Given** un agente con conocimiento
- **When** el visitante escribe `"Hola"` (menos de 4 palabras, sin `?`)
- **Then** no se llama a la recuperación, y el prompt no lleva bloque de fragmentos

### E4 — Techo absoluto de relevancia (AC2)

- **Given** una consulta cuyo vecino más próximo está por encima del techo absoluto (0.85)
- **When** se llama a `searchKnowledge`
- **Then** devuelve `[]`, no los menos malos

### E5 — Acierto claro se conserva (AC2)

- **Given** una consulta con un fragmento claramente relevante (distancia por debajo del techo)
- **When** se llama a `searchKnowledge`
- **Then** ese fragmento viene devuelto, con su `source` y su `distance`

### E5b — Poda relativa (AC2)

- **Given** tres vecinos a distancias 0.40, 0.45 y 0.60
- **When** se llama a `searchKnowledge`
- **Then** devuelve los de 0.40 y 0.45, y descarta el de 0.60 (margen +0.08 sobre el mejor)

### E5c — Sin contenido repetido (AC2)

- **Given** un corpus con fragmentos de contenido literalmente idéntico (boilerplate de navegación
  repetido en varias páginas del sitio)
- **When** se llama a `searchKnowledge`
- **Then** la consulta deduplica por contenido, y el `LIMIT` se aplica **fuera** de la subconsulta de
  deduplicación — dentro cogería los primeros por orden alfabético, no los más cercanos

### E6 — Ventana de historial coge la cola, no la cabeza (AC3)

- **Given** una conversación con 40 mensajes persistidos, numerados 1..40
- **When** se construye el array de mensajes
- **Then** contiene el bloque de sistema + los mensajes **25..40** (los 16 **últimos**) + el mensaje
  del usuario — y **no** los mensajes 1..16, que es lo que devuelve el `orderBy: "asc"` actual

### E7 — Truncar el historial no pierde al contacto (AC3)

- **Given** un historial de 40 mensajes y un contacto conocido con nombre y email
- **When** se construye el array de mensajes
- **Then** el nombre y el email siguen presentes vía `contextFacts`, pese al truncado

### E8 — Prefijo estable con dato variable (AC4)

- **Given** dos mensajes consecutivos de la misma conversación, y en el segundo ya se conoce el nombre
  del visitante
- **When** se construyen ambos prompts
- **Then** el contenido del mensaje de sistema es idéntico en los dos, y `contextFacts` aparece en un
  mensaje del final, no dentro del bloque de sistema

### E9 — Guía de estilo comprimida completa (AC5)

- **Given** la guía comprimida
- **When** se comprueban las reglas de la versión larga una a una
- **Then** todas están presentes: mensajes cortos, una sola pregunta, adaptación de tono, fórmulas
  prohibidas, máximo un emoji, nada de emojis en temas delicados, no resaludar, no repetir el nombre,
  no cerrar con "¿algo más?", sin Markdown pesado, negrita puntual

### E10 — `cached_tokens` registrado (AC6)

- **Given** una respuesta del LLM con `usage.prompt_tokens_details.cached_tokens`
- **When** se registra el consumo
- **Then** el valor queda en `TokenUsage.contexto`, y lo imputado sigue siendo `total_tokens`

### E11 — Respuesta sin `cached_tokens` no rompe (AC6)

- **Given** una respuesta sin `prompt_tokens_details`
- **When** se registra el consumo
- **Then** no lanza, y el consumo se registra igual

### E12 — Agente sin conocimiento, sin cambios (AC7)

- **Given** un agente con `hasKnowledge === false` y 0 skills
- **When** se construye su prompt
- **Then** es byte-idéntico al de antes del cambio salvo la posición de `contextFacts`

## Mapa tarea → prueba

| Tarea | Escenarios |
|---|---|
| T1.1 recuperación anticipada | E1, E3 |
| T1.2 instrucción y herramienta conservada | E2 |
| T2.1 calibrar umbral | (medición, documentada en `tasks.md`) |
| T2.2 dedup + `k=3` + poda + techo | E4, E5, E5b, E5c |
| T3.1 ventana de historial | E6, E7 |
| T4.1 reordenar prompt, `contextFacts` al final | E8, E12 |
| T5.1 guía de estilo comprimida | E9 |
| T5.2 prosa de herramientas comprimida | E9 (tabla de equivalencia) |
| T6.1 `cached_tokens` | E10, E11 |
| T7.1 medición de cierre | AC8 |

Una tarea está hecha sólo cuando su prueba está verde. El cambio no está hecho hasta que AC8 esté
publicado con números reales.
