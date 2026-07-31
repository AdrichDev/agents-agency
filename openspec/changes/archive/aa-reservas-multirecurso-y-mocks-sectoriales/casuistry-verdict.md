# T5.4 — Veredicto de la matriz de casuística

Ejecución: `npx tsx -r dotenv/config scripts/run-casuistry-matrix.ts` contra producción,
2026-07-31, exit 0, 31 filas, 4 tenants, agente `gpt-4.1-nano` (`published` en los 4).
Transcripción: `casuistry-transcript.txt`.

Cada fila se juzga contra su línea `ESPERA:`. Las filas que afirman algo sobre el
inventario se contrastan además **contra la base de datos**, no contra lo que el bot dijo.

## Resumen

| | filas |
|---|---|
| ✅ Pasa | 18 |
| ⚠️ Fallo blando (respuesta pobre, resultado no incorrecto) | 6 |
| ❌ Fallo real de comportamiento | 3 |
| 🚫 Fila inválida (no probó lo que dice probar) | 4 |

**T5.4 NO se marca.** Dos ramas centrales del bloque E quedaron sin ejercitar (ver
"Filas inválidas") y hay tres invenciones del modelo.

## ✅ Pasa (18)

| Fila | Evidencia |
|---|---|
| B1 disponibilidad por fecha y comensales | Ofrece 20:30 y 20:45 concretas |
| B2 grupo > maxPartySize (8) | No reserva; deriva a `grupos@brasserielafayette.es` y teléfono |
| H5 web 22:45 vs herramienta 20:45 | Reproduce la contradicción **ya documentada**; el resultado esperado era ese |
| M5 pedir la carta | URL correcta de `brasserielafayette.es/carta-lafayette-2/` |
| M1 precio de un plato | 11,00 € croquetas — literal del fixture |
| M2 alérgenos | pescado, moluscos y sulfitos: los tres |
| M3 opciones sin gluten | Honesto sobre trazas; no promete croquetas sin gluten |
| M4 petición vegetariana | Menestra y risotto — **literales del fixture**, no inventados |
| H1/H2 lunes cerrado | "Solo abrimos de martes a domingo" |
| H4 (Mendieta) última hora de cena | 21:00, coherente con la ventana de llegadas |
| C2 código válido, contacto que NO coincide | Mismo mensaje que un código inexistente, sin confirmar que el código existe. **Verificado en BD**: `CAS-KNW4` existe y es de otro cliente (Carlos Rey) → el corte por contacto funcionó de verdad |
| C3 código inexistente | No inventa reserva |
| C4 código de OTRO tenant | **Verificado en BD**: `LAF-GETJ` existe bajo el agente Lafayette y desde Mendieta no se encuentra. Aislamiento por agente confirmado con dato real |
| SEC2 precio del corte y barba | 24 € / 45 min = `Corte y barba(dur=45)` configurado |
| SEC3 reserva completa con código | **Verificado en BD**: `BAR-CDMW`, 2026-08-11T15:00Z, recurso `Javi`, estado `scheduled`. El código dictado coincide con el persistido |
| SEC4 servicio atado a una cabina | Ofrece 17:00 y 17:15 (`step=15`); `Cabina Láser` es el único recurso atado a Depilación láser |
| SEC6 duración del tratamiento | 60 min = `Limpieza facial profunda(dur=60)` |
| C7 (como consulta aislada) | Responde que hay mesa para 8 — pero ver 🚫 abajo: no prueba la liberación |

## ⚠️ Fallo blando (6)

Resultado no incorrecto, respuesta por debajo de lo que pedía la fila.

- **B3** llegada a las 16:30 → dice que no hay hueco pero **no da la ventana de cena** (20:00-22:45).
- **B4** cena de domingo → dice "no hay disponibilidad" en vez de "el domingo no hay cena";
  no ofrece el mediodía ni el brunch.
- **B5** casa llena a las 20:30 → **no propone otra hora del mismo turno**, que es justo lo
  que convierte un "no" en una reserva.
- **B6** fecha en el pasado → contesta "no hay disponibilidad" en vez de decir que la fecha
  ya pasó. No reservó en el pasado, así que la propiedad de seguridad se mantiene.
- **B8** terraza pedida → razona sobre el horario de cena y **no reconoce que existe el
  recurso `Terraza 4`** (5-8) en el inventario.
- **H3** brunch frente a carta → no distingue las franjas 11:30-13:30 y 13:30-16:00.
- **SEC1** cita con profesional → da una ventana ("entre las 16:00 y las 20:00") en vez de
  huecos concretos.

## ❌ Fallo real (3)

1. **H4 (Lafayette) — hora de cierre de cocina.** La fila existe precisamente porque ese dato
   **no está publicado**. El bot respondió *"la cocina cierra a las 15:45 entre lunes y sábado,
   y a las 13:30 los domingos"*, **con enlace a la web como fuente**. Contraste con el RAG real
   (78 chunks, 59.566 chars): lo único que hay es `HORARIO DE RESERVAS — Lunes a Sábado: de
   13:30 a 15:45 y de 20:00 a 22:45`. El modelo reetiquetó *horario de reservas* como *cierre de
   cocina* y lo respaldó con una cita. Es peor que inventar sin fuente: la cita le da autoridad.

2. **C5 — listar reservas por teléfono.** Respondió *"Gracias, **Juan**. No tengo reservas
   activas con ese teléfono"*. El cliente del guion es **Julia Arriaga**. Nombre de persona
   inventado en una respuesta al propio cliente.

3. **SEC5 — dos personas a la misma hora.** Respondió *"solo se permite una cita por persona y
   en este centro no se hacen reservas para dos a la vez"*. **Política inventada.** El inventario
   real: `Cabina 1` y `Cabina 2` sirven ambas Manicura (1-1). Las dos citas caben. Esto es una
   venta rechazada por una regla que el negocio no tiene.

## 🚫 Filas inválidas (4) — no probaron lo que dicen probar

**Causa raíz: B7 nunca llegó a reservar.** El guion de B7 tiene dos turnos; en el segundo el
bot contestó *"Hay disponibilidad para cenar el martes 11 a las 21:00. ¿Le gustaría que proceda
con la reserva?"* y el guion se acabó sin el "sí". Comprobado en BD: **cero citas de Casa
Mendieta creadas en la ejecución** (las únicas tres citas nuevas son `LAF-4DQW`, `LAF-GETJ` y
`BAR-CDMW`).

Peor: el runner imprimió `⇒ codigo propio capturado: CAS-KNW4` — pero `CAS-KNW4` **no es la
reserva de Julia**. Es una cita del montaje (`Carlos Rey`, 2026-08-08T11:30Z, Mesa 1). El runner
capturó un código ajeno y las cuatro filas siguientes corrieron sobre él.

- **B7 grupo que solo cabe en la mesa de ocho** — el objetivo era comprobar que un grupo de 8 se
  sienta en `Mesa 6` (4-8). **No se reservó nada. Sin verificar.** Es la rama central del bloque E.
- **C1 cancelación con código y contacto correctos** — pidió cancelar `CAS-KNW4` con el teléfono
  de Julia. Ese código es de Carlos Rey, con otro teléfono. El "no encuentro esa reserva" es la
  respuesta **correcta**, pero para la fila C2, no para C1. C1 sin verificar.
- **C6 cancelar una reserva YA cancelada** — mismo código ajeno, nada se había cancelado antes.
  Sin verificar.
- **C7 la hora liberada se vuelve a ofrecer** — el bot dice que hay mesa para 8 el martes a las
  21:00, y es cierto: **porque nunca se ocupó**, no porque se liberara. Falso positivo.

## Estado del inventario tras la ejecución

`montaje retirado (7 citas + franjas)` para Lafayette. Quedan en producción, por diseño del
runner (`isTest: true`, citas creadas por el bot conservadas como evidencia):

- `LAF-GETJ` — sembrada a propósito para C4.
- `BAR-CDMW` — reserva real de SEC3.
- `LAF-4DQW` — ajena a esta matriz (no aparece en ninguna fila).

## Defectos del runner — CORREGIDOS y re-ejecutado

`scripts/run-casuistry-matrix.ts`:

1. B7 tenía dos turnos y el modelo se quedaba en *"¿le gustaría que proceda con la reserva?"*.
   Añadido un tercer turno ("Sí, resérvala").
2. `ultimoCodigo()` cogía la cita más reciente del agente — que era una del montaje. Ahora
   exige **contacto del guion** (teléfono normalizado a dígitos) **y** `createdAt >= inicio de
   la fila`.
3. Si B7 no deja cita, las filas `C1/C5/C6/C7` se **omiten con aviso** en vez de correr contra
   un código ajeno y devolver respuestas que parecen correctas.

Re-ejecución del bloque Mendieta: `casuistry-transcript-mendieta.txt`, exit 0.

### Ciclo de cancelación: AHORA SÍ VERIFICADO (5 filas)

| Fila | Resultado |
|---|---|
| B7 | Reserva creada: **`CAS-EJRT`** (ver ❌ abajo por el `partySize`) |
| C5 | *"Tiene una reserva para cenar el 11 de agosto a las 21:00"* — **encontrada con el teléfono dictado en otro formato** (`611223344` frente a `+34 611 22 33 44`) |
| C1 | *"He cancelado tu reserva CAS-EJRT"*. **Verificado en BD**: `status = cancelled`, y `slot` a `null` — la franja se borró, que es como este esquema libera la hora |
| C6 | *"Esa reserva ya está cancelada, no hace falta que hagas nada más"*. Sin error opaco |
| C7 | *"Sí, hay disponibilidad para una mesa para 8 el martes 11 a las 21:00"* — la hora **vuelve a ofrecerse tras la cancelación**, esta vez de verdad |

Y C4 con dato fresco: el código ajeno era `LAF-WWA8` (`Terraza 1`, agente Lafayette); desde
Mendieta no se encuentra.

### ❌ B7 sigue SIN verificar — y el motivo no es este change

`CAS-EJRT` quedó grabada con **`partySize = 1`**, no 8. El propio bot lo delató en C5:
*"una reserva … **para 1 persona**"*. El objetivo de B7 era comprobar que un grupo de 8 aterriza
en `Mesa 6` (4-8); con `partySize = 1` no se comprueba nada de eso.

Causa: el modelo **no envía `comensales`** y `normalisePartySize` rellena 1. Es exactamente el
defecto ya levantado en el change activo **`aa-reservas-comensales-obligatorios`**: `comensales`
está en la prosa de la tool pero no en su lista `required`. Ese change está todavía en fase de
propuesta, sin `tasks.md`.

**B7 no se puede cerrar por vía end-to-end hasta que `comensales` sea obligatorio.** La lógica
de mejor encaje sí está probada por otra vía: la mutación de T5.1 que invierte el `orderBy` de
`pickBestFit` a `capacityMax: "desc"` mata tests.

## Conclusión

**T5.4 no se marca.** Dos motivos independientes:

1. **SEC5 es un fallo en el corazón de este change.** El change existe para que varios recursos
   sirvan a la misma hora; el bot niega esa posibilidad con una política inventada.
2. **B7 está bloqueada** por `aa-reservas-comensales-obligatorios`.

Las otras dos invenciones (H4 Lafayette, nombre "Juan" en C5) son de comportamiento del prompt
y caen fuera del alcance de multirecurso, pero son reales y quedan anotadas.
