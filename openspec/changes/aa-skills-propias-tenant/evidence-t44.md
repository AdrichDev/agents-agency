# T4.4 — Evidencia: instalar la skill se nota en la conversación

Ejecutado el 29/07/2026 con `back/scripts/verify-builtin-skill.ts --run cmq9n8hqe0001t0fx5isqdf4d`
contra la base y el LLM reales. Agente **CaressIA** (`draft`, `gpt-5.4-mini`, el mismo modelo
que corre en producción). Conversaciones creadas con `isTest: true`, así que no cuentan como
uso de cliente. La instalación se deshace al terminar: el agente queda como estaba.

Mismo agente, misma pregunta, dos veces. La pregunta es genérica a propósito — no menciona la
skill ni pide ningún protocolo:

> «Hola, quería pedir cita para la semana que viene. ¿Cómo lo hacemos?»

## Sin la skill instalada

> Hola, soy CaressIA 😊 Podemos gestionarlo fácil: dime qué tratamiento quieres reservar y, si
> ya lo tienes claro, también el día u horario que te viene mejor para la semana que viene.

`toolCalls: []` · 994 tokens · 1 iteración · 2716 ms

## Con `3a/reserva-de-cita` instalada

> Hola, soy CaressIA 😊 Para reservarla, necesito saber qué tratamiento quieres y, si ya lo
> tienes claro, también **tu nombre** y una franja de horario que te venga bien la semana que
> viene. ¿Qué cita te gustaría pedir?

`toolCalls: [usar_skill { skillName: "3a/reserva-de-cita" }]` → `curated: true`,
`truncated: false` · 3288 tokens (1152 cacheados) · 2 iteraciones · 3350 ms

## Qué demuestra, y qué no

**AC2 cumplido.** El agente pidió la skill **por su cuenta**: nadie se la nombró en la
pregunta. `usar_skill` devolvió `curated: true` con el protocolo entero dentro del bloque
`[SKILL-19d90677ed2e1d60]`, con el marco anti-inyección delante. Y la respuesta cambió: pide
el **nombre**, que es uno de los cuatro datos que exige el protocolo y que sin la skill no
pedía. Eso es la regla del catálogo apareciendo en la conversación, no una casualidad de
redacción.

**Lo que NO demuestra.** El cambio visible es modesto: un dato más. Este caso prueba que el
mecanismo llega hasta la boca del agente, no que las diez skills estén bien escritas. Cada una
necesitaría su propia conversación para saberlo, y no se han hecho.

## Hallazgo que no estaba previsto: el coste

El turno pasó de **994 a 3288 tokens, 3,3 veces más**. Dos causas, las dos estructurales:
una iteración extra (el modelo pide la skill y vuelve a llamar) y ~1,7 KB de protocolo
inyectados en el contexto.

Esto choca de frente con `aa-agentes-economia-tokens`, donde se peleó por bajar de 2581 a 960
tokens por turno. Una skill instalada se come ese recorte entero y más. No invalida ninguna de
las dos cosas, pero sí obliga a decidir algo que hoy nadie ha decidido: **si el cupo por
agente se calculó sin contar con que las skills tripliquen el turno, el cupo está mal
calculado.** Queda anotado aquí porque lo midió esta prueba, no porque lo pidiera el change.

---

# El coste, medido en serio (n=5) y qué significa para el cupo

Lo de arriba es **n=1**: una pasada por rama. Sirve para decir «la skill llega a la boca del
agente», que era la pregunta de T4.4, pero **no para poner un número en una política de cupo**.
`gpt-5.4-mini` rechaza el parámetro `temperature`, así que la varianza entre pasadas es
estructural: en `aa-agentes-economia-tokens` T5.3 una comparación a n=2 dio una señal limpia,
convincente y **falsa**, que se invirtió al subir a n=5.

Repetido el 29/07/2026 con `--repeats 5` por rama, mismo agente, misma pregunta:

```
npx tsx -r dotenv/config scripts/verify-builtin-skill.ts --run cmq9n8hqe0001t0fx5isqdf4d --repeats 5
```

| Rama | n | Tokens facturados por pasada | Media | Iteraciones |
|---|---|---|---|---|
| SIN la skill | 5 | 994 · 992 · 986 · 983 · 995 | **990** | 1,00 |
| CON `3a/reserva-de-cita` | 5 | 3264 · 3254 · 3254 · 3270 · 3261 | **3261** | 2,00 |

Factor **×3,29**. La dispersión es mínima (±6 y ±7 tokens), así que aquí el n=1 anterior no
mentía: 994 → 3288 estaba dentro del rango. Esta vez está demostrado en vez de supuesto.

**De dónde salen los números.** No del valor que devuelve el motor, sino de la tabla
`uso_tokens`, leída después de cada rama. Es deliberado: el gate de cupo descuenta de esa
columna, así que lo que decide si un agente se queda sin servicio es ella y no otra cosa. Medir
el retorno del motor contestaría a una pregunta que nadie ha hecho.

## La cuenta del cupo

`DEFAULT_TOKEN_QUOTA_PER_AGENT = 10.000.000` (`back/src/lib/quota.ts`). Con ese cupo:

| Supuesto | Tokens/turno | Turnos/mes | Turnos/día |
|---|---|---|---|
| El que se usó para fijar el cupo (27/07, antes del recorte, sin skills) | ~3.100 | ~3.225 | ~107 |
| Real hoy, agente **sin** skills | 990 | **10.101** | ~336 |
| Real hoy, agente **con una** skill | 3.261 | **3.066** | ~102 |

**El cupo no está mal calculado — pero por un motivo distinto del que hay escrito.** El
comentario de `quota.ts` justifica los 10M con «~3.100 tokens por interacción ≈ 3.200
interacciones/mes». Ese 3.100 se midió antes del recorte de tokens y sin ninguna skill
instalada, y hoy es un número muerto: el agente pelado consume 990. Lo que ha pasado es que el
recorte (−68%) y el coste de una skill (×3,29) casi se cancelan, y el agente CON skill vuelve a
caer en ~3.261 — a un 5% del supuesto original. La política aguanta por coincidencia numérica,
no porque nadie contara con las skills.

Consecuencia práctica: **10M sigue siendo un techo alcanzable sólo con tráfico real** (102
conversaciones al día con skill, 336 sin ella) e inalcanzable por accidente, que es
exactamente lo que H7 quería. No hay que tocar el número. Sí hay que arreglar la justificación,
porque una política sostenida por una cifra obsoleta se rompe la próxima vez que alguien
optimice tokens y crea que ha ganado margen.

## Lo que esta medición NO cubre

- **Una skill, un turno, una conversación nueva.** Cada pasada abre conversación limpia y mide
  el **primer** turno. Un agente con tres skills instaladas, o una conversación de diez turnos
  arrastrando el protocolo en el historial, cuesta más — cuánto más, no se ha medido.
- **Un agente, un modelo, una pregunta.** CaressIA con `gpt-5.4-mini`. Otro sector con otro
  protocolo puede inyectar un cuerpo mayor o menor: el de `3a/reserva-de-cita` son ~2,0 KB.
- **Los 1.152 tokens cacheados de la rama CON no se descuentan.** `usageBreakdown.cachedTokens`
  los declara, pero `uso_tokens` imputa el total. El proveedor los factura más baratos, así que
  el cupo de la plataforma es **más estricto** que la factura real. Es una decisión conservadora
  y defendible, pero conviene saber que está tomada: cortar por 3.261 cuando el coste real es
  menor deja margen sin usar.
- **El precio en euros no sale de aquí.** Esto dice cuántos turnos caben en el cupo, no cuánto
  vale un turno. El importe vive en Stripe y lo decide Adrián.
