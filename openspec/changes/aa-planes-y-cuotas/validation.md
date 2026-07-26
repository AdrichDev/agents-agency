# Validation — `aa-planes-y-cuotas`

## Historia de usuario

> Como propietario de la plataforma, quiero cobrar una suscripción mensual por cada agente que
> vendo, con un cupo que se renueve cada periodo y un precio que cubra el coste real, y quiero
> poder suspender a un cliente que no paga **sin** que una recarga de crédito lo reactive por
> accidente.

Y su contraparte, que es la que hoy falla:

> Como cliente que paga cada mes, quiero que mi cuota se reinicie al renovar sin que nadie tenga
> que tocar nada a mano.

## Criterios de aceptación

### Entregado en este change

- **AC1** — Agotar el cupo **no** modifica `isActive`. El cliente queda bloqueado por cupo, no
  marcado como suspendido.
- **AC2** — Asignar crédito no reactiva: un cliente con `isActive = false` sigue inactivo tras
  subirle el saldo, salvo que se pase `isActive` explícitamente.
- **AC3** — Bajar el saldo por debajo del consumo no suspende a un cliente activo.
- **AC4** — `isActive` sigue siendo un kill switch efectivo: un tenant suspendido con cupo de
  sobra recibe 402.
- **AC5** — El 402 por cuota agotada y el 402 por cuenta suspendida son distinguibles por el
  cliente, sin exponer detalle interno.
- **AC6** — Existe un instrumento de sólo lectura que devuelve tokens y coste por conversación
  desde `uso_tokens`, con la tarifa por modelo como entrada explícita y datable.
- **AC6b** *(T6.1)* — El instrumento es **fail-closed sobre la tarifa**: mientras haya tokens de
  modelos sin tarifar, no imprime coste agregado; imprime la cobertura, los modelos que faltan y
  sus tokens. Nunca presenta `$0.0000` como si servir fuera gratis.
- **AC6c** *(T6.2/T6.3)* — El informe no contiene dos aritméticas incompatibles: ningún corte
  extrapola la tarifa media a tokens no tarifados, y "conversaciones sin consumo" compara la misma
  población en las dos mitades de la resta.
- **AC6d** *(T6.4)* — El kill switch manual es operable desde el panel: `PATCH /credits` acepta
  `isActive` sin `tokenBalance`, y rechaza un body vacío.
- **AC7** — Este change no incluye migración de base de datos.
- **AC8** — Regresión cero sobre H1: el gate fail-closed, el cobro contra el tenant de BD y la
  exención acotada de la consola siguen funcionando igual.
- **AC8b** *(añadido al implementar)* — Agotar el cupo deja de tener efectos ajenos al consumo:
  el cliente sigue apareciendo en la lista del operador, el contador de clientes activos no
  miente, y **se puede dar de baja a un cliente con el cupo agotado** (antes `bajaCliente`
  reportaba "ya estaba dado de baja" y no hacía nada).

### Especificado, bloqueado por el gate humano (T2.2)

- **AC9** — El cupo se mide **por periodo**: el consumo de un periodo no cuenta contra el
  siguiente, y la renovación no requiere intervención manual ni un cron que pueda fallar tarde.
- **AC10** — El periodo va anclado a la suscripción del tenant, no al mes natural, para que
  cuadre con la facturación de Stripe (H6).
- **AC11** — Un tenant sin plan asignado tiene cupo cero (fail-closed), en vez de los 10M tokens
  que hoy regala `DEFAULT_TOKEN_BALANCE`.
- **AC12** — Un plan puede tener cupo de tokens nulo sin que eso signifique bloqueado (hueco
  reservado a BYOK, H2).
- **AC13** — `uso_tokens` sigue siendo la fuente de verdad del consumo: los contadores de periodo
  son caché reconciliable, nunca la única copia.

## Escenarios (Given-When-Then) — uno por tarea

### T1.1 — agotar cupo no suspende (AC1)

```
Dado un tenant activo con cupo de 100 tokens y 90 consumidos
Cuando una respuesta consume 20 tokens más
Entonces queda bloqueado por cupo y su isActive sigue siendo true
  y la siguiente petición recibe 402
```

### T1.2 — asignar crédito no reactiva (AC2, AC3)

```
Dado un tenant suspendido por impago (isActive = false)
Cuando el propietario le sube el saldo sin indicar isActive
Entonces el tenant sigue inactivo y su chat sigue devolviendo 402
```

```
Dado un tenant activo cuyo consumo supera el saldo que se le va a poner
Cuando el propietario baja su saldo sin indicar isActive
Entonces isActive no cambia: no se suspende a quien está al día
```

### T1.3 — motivos distinguibles (AC5)

```
Dado un tenant con la cuota del periodo agotada
Y otro tenant suspendido administrativamente
Cuando ambos intentan usar su asistente
Entonces cada uno recibe 402 con un motivo distinto
```

### T1.4 — regresión de H1 (AC8)

```
Dado el conjunto de tests de aa-metering-fail-closed
Cuando se ejecuta npm test
Entonces todos pasan, y la única expectativa que cambia es la del efecto
  sobre isActive al agotar el cupo
```

### T2.1 — instrumento de medición (AC6)

```
Dado el histórico de uso_tokens en producción
Cuando el propietario ejecuta npm run measure:cost
Entonces obtiene coste y tokens por conversación (media, mediana, p90)
  y los cortes por tenant, agente, modelo y operacion
  sin escribir nada en la base de datos
```

### T3.2 — renovación perezosa (AC9)

```
Dado un tenant cuyo periodo venció ayer y agotó su cuota
Cuando llega un mensaje nuevo
Entonces el periodo se renueva al comprobar el cupo, el contador vuelve a cero
  y el mensaje se atiende, sin que nadie haya intervenido
```

### T4.2 — sin plan, sin cupo (AC11)

```
Dado un tenant recién creado al que no se le ha asignado plan
Cuando su agente recibe un mensaje
Entonces recibe 402: sin plan no hay cupo, y lo que no es cobrable no es servible
```

### Escenarios de T6

```
Dado un histórico donde el 100% de los tokens es de modelos sin tarifa
Cuando se ejecuta npm run measure:cost
Entonces NO se imprime coste agregado, sino la cobertura (0%), la lista de modelos que faltan
  con sus tokens, y el aviso de que T2.2 no puede resolverse con ese informe
```

```
Dado el switch de activación del panel, que manda sólo { isActive: false }
Cuando se hace PATCH /api/clients/:id/credits
Entonces responde 200 y escribe únicamente isActive, sin tocar el cupo
  (antes respondía 400 y el kill switch manual no funcionaba)
```

```
Dado un tenant activo cuyo consumo ya supera su cupo
Cuando deductTokens registra más consumo
Entonces sigue habiendo una sola escritura sobre el tenant
  (este es el caso en que la implementación anterior escribía isActive = false:
   el guard sólo discrimina si el mock reproduce este estado)
```

## Verificación final

| Check | Cómo |
|---|---|
| V1 typecheck | `npx tsc --noEmit` en `back/` |
| V2 suite | `npm test` en `back/`, sin skips nuevos |
| V3 sin migración | `back/prisma/migrations/` sin ficheros nuevos |
| V4 revisión | `sdd-verify` antes de proponer commit |

## Gates humanos (no automatizables)

**T2.2 — decisión de precio.** El propietario ejecuta `npm run measure:cost` contra producción y
decide precio y cupo por plan con la salida delante. Gru no puede leer producción: Supabase MCP
responde `Unauthorized: falta SUPABASE_ACCESS_TOKEN`. **Bloquea T3, T4, T5 y H6.**

**Migración (T3.1, T4.1, T5.1).** Aplicar en producción requiere aprobación explícita. `uso_tokens`
no se toca ni se recalcula: es el histórico de consumo.
