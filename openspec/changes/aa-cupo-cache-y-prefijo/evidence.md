# Evidencia — medición de caché de prefijo y cupo

Instrumento: `back/scripts/measure-history-cache.ts`.
Agente: CaressIA (`cmq9n8hqe0001t0fx5isqdf4d`), `gpt-5.4-mini`, 0 skills.
Método: una conversación, 14 turnos encadenados, guion fijo de mensajes cortos — lo que debe
crecer es el historial, no el mensaje del usuario. Tokens leídos de `uso_tokens`, no del retorno
del motor: el cupo se descuenta de esa columna y medir otra cosa contestaría una pregunta que
nadie ha hecho.

Precios usados (doc oficial de OpenAI, consultada el 29/07/2026, USD por 1M tokens):

| Modelo | Input | Cached | Output | Ratio cached/input |
|---|---|---|---|---|
| gpt-5.4-mini | $0.75 | $0.075 | $4.50 | 0,10 |
| gpt-4.1-mini | $0.40 | $0.10 | $1.60 | 0,25 |
| gpt-4.1-nano | $0.10 | $0.025 | $0.40 | 0,25 |
| gpt-4o-mini | $0.15 | $0.075 | $0.60 | 0,50 |
| gpt-4o | $2.50 | $1.25 | $10.00 | 0,50 |

## Run 1 y 2 — prompt real (system = 946 tokens)

Run 2 (caché ya caliente del run 1):

```
turno │  total │ prompt │ cached │  %cach │ iter │ ventana
    1 │    982 │    946 │      0 │     0% │    1 │ 0
    2 │   1014 │    996 │      0 │     0% │    1 │ 2
    3 │   1044 │   1027 │      0 │     0% │    1 │ 4
    4 │   1074 │   1056 │      0 │     0% │    1 │ 6
    5 │   1105 │   1086 │      0 │     0% │    1 │ 8
    6 │   1159 │   1144 │      0 │     0% │    1 │ 10
    7 │   1188 │   1174 │      0 │     0% │    1 │ 12
    8 │   1229 │   1200 │      0 │     0% │    1 │ 14
    9 │   1257 │   1235 │      0 │     0% │    1 │ 16
   10 │   1246 │   1216 │      0 │     0% │    1 │ 16 ← desborda
   11 │   2594 │   2525 │   1152 │    46% │    2 │ 16 ← desborda
   12 │   1290 │   1261 │      0 │     0% │    1 │ 16 ← desborda
   13 │   2662 │   2609 │   1152 │    44% │    2 │ 16 ← desborda
```

Cruzando los dos runs (25 turnos): 5 aciertos, **4 de los 5 con `iter = 2`**. El turno 12
(prompt 1.261, `iter=1`) da 0 y el turno 11 (prompt 1.262 por iteración, `iter=2`) da 1.152.
Prompts equivalentes, resultado opuesto: la única variable es la iteración.

## Run 3 — mismo agente, system alargado a ~1.250 tokens

```
turno │  total │ prompt │ cached │  %cach │ iter │ ventana
    1 │   1273 │   1250 │      0 │     0% │    1 │ 0
    2 │   1310 │   1287 │   1152 │    90% │    1 │ 2
    3 │   1343 │   1323 │   1152 │    87% │    1 │ 4
    4 │   1378 │   1355 │   1152 │    85% │    1 │ 6
    5 │   1425 │   1390 │      0 │     0% │    1 │ 8
    6 │   1491 │   1458 │   1152 │    79% │    1 │ 10
    7 │   1529 │   1500 │   1152 │    77% │    1 │ 12
    8 │   1571 │   1541 │   1152 │    75% │    1 │ 14
    9 │   1610 │   1583 │   1152 │    73% │    1 │ 16
   10 │   3304 │   3231 │   2304 │    71% │    2 │ 16 ← desborda
   11 │   3369 │   3290 │   2304 │    70% │    2 │ 16 ← desborda
   12 │   1692 │   1658 │   1152 │    69% │    1 │ 16 ← desborda
   13 │   3523 │   3427 │   2816 │    82% │    2 │ 16 ← desborda
```

## Resultado

| | Tokens | Cacheados | % | Factura (13 turnos) |
|---|---|---|---|---|
| System 946 tok | 17.844 | 2.304 | 12,9% | $0.01321 |
| System 1.250 tok | 24.818 | 16.640 | 67,0% | **$0.00935** |

**Los tokens suben 39% y la factura baja 29%.** Y el cupo del cliente, medido en tokens brutos,
sube ese mismo 39% — de ahí que los dos cambios tengan que ir juntos.

Con los cacheados ponderados al 0,10 de `gpt-5.4-mini`, el cupo efectivo de esos 13 turnos pasa
de 15.770 a 9.842 tokens: **−38% de consumo de cupo** para la misma conversación.

## Lo que esta medición NO cubre

- Un solo agente, un solo modelo, un solo guion de conversación, 0 skills instaladas.
- La anomalía del turno 5 del run 3 (prompt 1.390 y `cached` 0) no está explicada. La caché del
  proveedor no es determinista; con n=1 no se puede afirmar por qué.
- No se ha probado que ponderar el cupo no rompa `assertUsageAllowed` en el borde (cliente justo
  al límite). Es tarea del change.
- El reparto input/output se ha derivado de `total − prompt`. Es exacto para el coste porque
  ambos vienen de `usage`, pero no separa reasoning tokens dentro del output.
- Los ratios de caché de Gemini y Anthropic no se han consultado. Sin ratio conocido no se pondera.

## Verificación posterior al cambio (T4)

Mismo agente, mismo guion, mismo script — con `BASE_DIRECTIVES` y la ponderación ya en el código.
Sin `--pad`: el prefijo largo ahora es real.

### Primer intento — FALLÓ el criterio, y por una causa que nadie había previsto

```
turno │  bruto │ imputa │ prompt │ cached │  %cach │ iter │ ventana
    1 │   2004 │   2004 │   1987 │      0 │     0% │    1 │ 0
    2 │   4185 │   1190 │   4106 │   3328 │    81% │    2 │ 2
    3 │   4361 │   1366 │   4261 │   3328 │    78% │    2 │ 4
    4 │   4473 │   1478 │   4397 │   3328 │    76% │    2 │ 6
    5 │   4627 │   1171 │   4531 │   3840 │    85% │    2 │ 8
    6 │   2370 │    412 │   2336 │   2176 │    93% │    1 │ 10
    7 │   2446 │    488 │   2405 │   2176 │    90% │    1 │ 12
```

La caché acertaba (6 de 7), pero **cuatro turnos pasaron a dos iteraciones** donde antes tenían una.
Factura de los 7 turnos: **$0.007742 frente a $0.006189 — un 25% MÁS CARA**. AC9 falla.

La longitud no era la causa: el run 3 con relleno sintético, del mismo tamaño, mantuvo `iter=1` en
todos los turnos. Era el CONTENIDO. Tres frases del bloque mencionaban "herramienta" como fuente de
verdad ("que no te haya devuelto una herramienta", "que no puedas ejecutar tú con una herramienta"),
y el modelo respondía llamando a herramientas antes de contestar. Una directriz de veracidad
redactada de forma inocente duplicó el coste del turno.

Reformuladas las tres a "que no conste" / "que no puedas dejar hecho tú mismo en esta conversación".

### Segundo intento — criterio cumplido (con una redacción que T5.2 destapó como rota)

> Los números de abajo son válidos para la caché, pero esta redacción del bloque bloqueaba la
> captación de leads. Ver "Revisión de los prompts de producción (T5.2)" y la re-medición posterior.


```
turno │  bruto │ imputa │ prompt │ cached │  %cach │ iter │ ventana
    1 │   2000 │   2000 │   1975 │      0 │     0% │    1 │ 0
    2 │   2028 │    531 │   2014 │   1664 │    83% │    1 │ 2
    3 │   2064 │    567 │   2041 │   1664 │    82% │    1 │ 4
    4 │   2106 │    609 │   2076 │   1664 │    80% │    1 │ 6
    5 │   2137 │    640 │   2112 │   1664 │    79% │    1 │ 8
    6 │   2220 │    723 │   2176 │   1664 │    76% │    1 │ 10
    7 │   2268 │    771 │   2235 │   1664 │    74% │    1 │ 12
    8 │   2319 │    822 │   2280 │   1664 │    73% │    1 │ 14

Bruto 17142 · imputado al cupo 6663 (61% menos)
Aciertos de caché en turnos de UNA iteración: 7 de 8
```

- **AC8 cumplido**: 7 de 8 turnos con una sola iteración aciertan la caché. Antes eran 0 — todos los
  aciertos venían de la segunda iteración de un mismo turno.
- Prefijo del turno 1: **1.975 tokens**, muy por encima del mínimo de 1024.

Comparación limpia contra el estado anterior, turnos 1–7 y todos con `iter=1` en ambos lados:

| | Antes (system 946) | Ahora | |
|---|---|---|---|
| Prompt total | 7.429 | 14.629 | +97% |
| De ellos cacheados | 0 | 9.984 | |
| Salida | 137 | 194 | |
| **Factura del propietario** | $0.006188 | **$0.005106** | **−17,5%** |
| **Cupo imputado al cliente** | 7.566 | **5.841** | **−22,8%** |

**AC9 cumplido: los dos bajan.** Menos que el −29%/−38% que proyectaba `proposal.md`, y la
diferencia importa: aquella cifra salía del run con relleno, cuyo reparto entre prompt y salida no
era el del bloque real. La proyección era optimista; estos son los números del código que se
despliega.

El efecto mejora con la longitud de la conversación: el turno 1 paga el prefijo entero sin caché
(2.000 imputados) y a partir del turno 2 se estabiliza en 500–800. Una conversación de 20 turnos
diluye ese arranque; una de 2 turnos apenas.

## Efecto en la conversación (T5.1)

Mismo agente, mismo guion, mismos primeros 8 turnos. Izquierda sin bloque base, derecha con él.

| # | Sin bloque | Con bloque |
|---|---|---|
| 1 | "Hola, soy CaressIA, ¿en qué puedo ayudarte hoy? 😊 Para reservarte la cita…" | "Hola, soy CaressIA. Para ayudarte a reservarla, dime por favor qué tratamiento…" |
| 4 | "**Sí, sobre las cinco puede encajar.** ¿Qué tratamiento quieres reservar?" | "**Puedo tener en cuenta la franja de las cinco, pero antes necesito saber** qué tratamiento…" |
| 7 | "Gracias, Adrián. ¿Qué tratamiento quieres reservar?" | "**No necesito el teléfono para seguir por ahora**, Adrián. Me falta solo saber…" |
| 8 | (no llegó) | "**No lo tengo confirmado** sin saber qué tratamiento es, porque la duración cambia según el servicio." |

Tres directrices actuando de forma visible, y las tres corrigen un fallo real del comportamiento anterior:

- **Turno 4** — sin el bloque el agente confirma disponibilidad ("puede encajar") que no ha
  consultado en ningún calendario. Es exactamente la promesa que el negocio no ha hecho.
- **Turno 7** — sin el bloque acepta y agradece un teléfono que no hacía falta todavía. Con él,
  lo rechaza explicando por qué.
- **Turno 8** — "no lo tengo confirmado" en lugar de un plazo plausible inventado.

Contrapartidas observadas, sin maquillar:

- **Desaparece el emoji.** El prompt de CaressIA no pide emojis; los ponía el modelo por su cuenta y
  el bloque, más formal, lo desincentiva. No hay ninguna regla de emojis en `BASE_DIRECTIVES` — el
  test de no-invasión lo comprueba —, así que esto es influencia de tono, no una prohibición. Con
  n=1 no se puede separar de la varianza del modelo.
- **Las respuestas se alargan.** 194 tokens de salida en 7 turnos frente a 137 (+42%). El agente
  explica por qué no hace algo en vez de callárselo. Ese coste ya está dentro del −17,5% de la
  tabla de arriba; no es un extra oculto.
- **Repetición más insistente.** Ambas versiones repiten la pregunta del tratamiento ocho veces
  seguidas. El bloque no lo arregla, y no es su trabajo: es el prompt del operador el que no cierra
  ese bucle.

## Revisión de los prompts de producción (T5.2)

11 agentes revisados. **Una contradicción real, y grave, en 7 de ellos.**

Seis prompts (Agente Caress, EDM San Blas, JorjotasBarber, Wabiks, VitalIA, Wabicks Agent) terminan
con la misma frase: *"pregunta si quiere que una persona del equipo se ponga en contacto. Si acepta,
solicita email y teléfono"*. SanBlasIA pide lo mismo con más detalle: *"solicita en este orden:
nombre, email y teléfono"*.

La primera redacción de la directriz decía *"pide únicamente los datos que necesitas para lo que el
usuario está intentando hacer, nunca por adelantado"* — y captar un lead **no es lo que el usuario
está intentando hacer**, es lo que el negocio quiere. Peor: la línea de precedencia blindaba la
categoría "datos personales" entera contra el prompt del operador, así que en el conflicto ganaba la
base. Siete de once agentes habrían dejado de captar leads.

No es una hipótesis. Se vio en el turno 7 de la conversación de T5.1: el usuario da su teléfono y el
agente responde **"No necesito el teléfono para seguir por ahora"**. El agente rechazando el dato que
el operador le mandó recoger.

Corregido en dos sitios:

1. `DATOS PERSONALES` autoriza ahora explícitamente recoger nombre, email y teléfono cuando las
   instrucciones del negocio lo pidan, de uno en uno y aceptando un no.
2. La precedencia blinda el **subconjunto duro** —datos bancarios, de identidad y de salud— en lugar
   de la categoría completa. Eso era lo que se quería proteger; blindar "datos personales" enteros
   fue un error de redacción con efecto directo sobre el producto.

Fijado en `back/tests/base-directives.test.ts` con dos tests nuevos, para que nadie vuelva a
estrechar la excepción sin darse cuenta de lo que rompe.

Los otros 10 puntos revisados no chocan: `CaressIA` y los cuatro prompts de clínica ya prohíben
diagnóstico y coinciden con LÍMITES; `AiAs` y `SanBlasIA` ya prohíben inventar y coinciden con
VERACIDAD; `CoderAI` (149 chars) y `DorsIA` (133 chars) no tienen ninguna regla propia y son
justamente los que más gana el bloque.

### Re-medición tras la corrección (la redacción cambió, la medición anterior caducó)

Dos corridas, mismo agente y mismo guion:

```
CORRIDA A                                  CORRIDA B
turno │  bruto │ imputa │ cached │ iter    turno │  bruto │ imputa │ cached │ iter
    1 │   4232 │   2735 │   1664 │    2        1 │   4219 │   1224 │   3328 │    2
    2 │   2144 │    647 │   1664 │    1        2 │   2131 │    634 │   1664 │    1
    3 │   2187 │    690 │   1664 │    1        3 │   2170 │    673 │   1664 │    1
    4 │   2228 │    731 │   1664 │    1        4 │   2217 │    720 │   1664 │    1
    5 │   4644 │    728 │   4352 │    2        5 │   2266 │    308 │   2176 │    1
    6 │   2380 │    422 │   2176 │    1        6 │   2319 │    361 │   2176 │    1
    7 │   2468 │    510 │   2176 │    1        7 │   4846 │    930 │   4352 │    2
Bruto 20283 · imputado 6463 (−68%)         Bruto 20168 · imputado 4850 (−76%)
```

| | Baseline | Corrida A | Corrida B |
|---|---|---|---|
| Factura por turno | $0.000884 | $0.000764 (**−14%**) | $0.000591 (**−33%**) |
| Cupo por turno | 1.081 tok | 808 tok (**−25%**) | 606 tok (**−44%**) |

**AC9 se sostiene en las dos**: factura y cupo bajan siempre. El rango es ancho y no se estrecha con
n=2 — los turnos con `iter=2` aparecen en posiciones distintas en cada corrida (1 y 5 / 1 y 7), lo
que descarta que los provoque una frase concreta del prompt y los deja en varianza del proveedor.

Dos observaciones de la re-medición, ninguna es un fallo:

- **7 filas de `uso_tokens` para 8 turnos, en ambas corridas.** No es cupo perdido. Cruzados los
  timestamps, el turno sin fila respondió en **274 ms** —el resto tarda entre 1,5 y 4 s—: es el flujo
  de captación pidiendo el email con plantilla, sin llamar al modelo. Cero tokens gastados, cero
  fila. Correcto.
- Ese turno **sólo aparece desde la corrección**. Con la redacción anterior salían 8 filas de 8
  porque el agente rechazaba el teléfono y todos los turnos iban al LLM. El recuento de filas era el
  síntoma de la captación rota.

## Hipótesis descartadas por medición

- **La ventana deslizante rompe la caché.** Falso: ya fallaba en los turnos 1–7, antes de desbordar.
- **El historial se desboca en conversaciones largas.** Falso: el prompt crece de 946 a ~1.280 y se
  estabiliza. `HISTORY_WINDOW_MESSAGES = 16` lo corta.
- **Traer el historial por tool call en vez de reenviarlo abarataría.** Falso: añade una iteración
  (×3,29 medido en `aa-skills-propias-tenant`) y acaba enviando el historial igual.
