# aa-cupo-cache-y-prefijo

## Intención

Que el cupo del cliente refleje lo que su uso cuesta de verdad, y que el prefijo del prompt
supere el mínimo cacheable del proveedor. Son dos cambios y van juntos a propósito: por separado,
cada uno mueve dinero en una sola dirección y la dirección no es la que queremos.

## El problema, medido

Tres runs de 14 turnos encadenados contra CaressIA (`gpt-5.4-mini`, 0 skills), tokens leídos de
`uso_tokens` — no del retorno del motor, porque el cupo se descuenta de esa columna. Evidencia
completa en `evidence.md`.

**1. La caché de prefijo casi no acierta.** El prefijo estable de un agente sin skills son **946
tokens**. El mínimo cacheable de OpenAI son **1024**. Por debajo del umbral, `cached_tokens` es 0
siempre. Resultado: acertaba 2 veces de 13, y sólo entre las dos iteraciones de un mismo turno
(prefijo idéntico, milisegundos aparte). Entre turnos, nunca.

Alargando el system prompt a ~1.250 tokens: **12 aciertos de 13, 67% del prompt cacheado**.

**2. Los tokens cacheados se imputan al cupo a precio completo.** `deductTokens` ya recibe
`cachedTokens` en `contexto` — su propio comentario dice que `tokens` es «lo que se le imputa al
cliente» y el desglose «lo que le costó al propietario» — pero al descontar del cupo se usa el
total. El proveedor los cobra entre 2× y 10× más baratos según modelo.

## Por qué juntos

| | Factura del propietario | Cupo del cliente |
|---|---|---|
| Prefijo largo, sin descontar caché | **−29%** | **+39%** ❌ |
| Descontar caché, sin prefijo largo | — | −12% |
| **Ambos** | **−29%** | **−38%** ✅ |

Sólo el prefijo: el propietario paga menos y el cliente consume más cupo para la misma
conversación. Es un error sistemático a favor de quien cobra, y no es lo que se quiere vender.

## Alcance

- Ponderar los tokens cacheados al descontar del cupo, con el ratio real de cada modelo.
- Garantizar que el prefijo estable de cualquier agente supera el mínimo cacheable.
- Registrar en `uso_tokens` lo imputado y lo bruto, sin perder ninguno de los dos.

## Fuera de alcance

- **Cambiar el modelo por defecto.** Se evaluó (`gpt-4.1-mini`, `gpt-4.1-nano`: 1,6× y 4× más
  baratos por token) y se aparca: los datos disponibles apuntan a que gastan más tokens por turno
  (1,47× y 2,13×), lo que acorta el cupo del cliente, y esa señal viene de 3–14 filas sin variables
  controladas. Decidirlo exige una comparativa con n≥5 por modelo. Change aparte.
- Unificar el modelo de los 11 agentes (hoy hay 4 modelos distintos por deriva, no por decisión).
- Cambiar la unidad del cupo de tokens a coste. Es la solución de raíz y es un cambio de producto
  y de contrato con el cliente, no de implementación.

## Riesgos

- **Ponderar el cupo lo afloja.** Un cliente rinde ~38% más con el mismo número. Es intencionado,
  pero si el 10M se fijó pensando en el consumo bruto, hay que revisar que el guardarraíl siga
  sirviendo. No se toca el valor en este change.
- **Ratio de caché desconocido para modelos nuevos.** Si no se conoce el ratio de un modelo, no se
  pondera: se imputa el bruto, que es el comportamiento de hoy. Fallar hacia lo conocido.
- **Alargar el prompt base afecta a todos los agentes.** El contenido añadido son directrices de
  comportamiento reales, no relleno: cambia lo que el bot responde. Requiere revisar que no
  contradiga los prompts por agente.
- **BYOK.** En `credentialMode: "byok"` no hay cupo que descontar; la ponderación no debe alterar
  la fila que se registra para observabilidad.

## Dependencias

- `back/src/lib/token-metering.ts` (`deductTokens`, `assertUsageAllowed`)
- `back/src/lib/agent/engine.ts` (construcción del prompt, `runToolLoop`)
- `back/src/lib/model-capabilities.ts` (tabla por modelo — mantener en sync con `front/lib/models.ts`)
