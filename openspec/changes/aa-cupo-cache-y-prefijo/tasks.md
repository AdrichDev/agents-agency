# Tareas — aa-cupo-cache-y-prefijo

Orden crítico: **T1 → T2 antes que T3**. Si el bloque base entra primero, el prefijo largo sube el
consumo de cupo de todos los agentes sin que la ponderación lo compense todavía — exactamente el
escenario que este change existe para evitar.

## T1 — Ratio de caché por modelo y cálculo de lo imputable

- [x] T1.1 Añadir `CACHED_TOKEN_RATIO` a `back/src/lib/model-capabilities.ts`, con los 10 modelos
      OpenAI verificados y comentario de fecha y fuente. Gemini y Anthropic NO entran.
- [x] T1.2 Exportar `chargeableTokens(total, cached, model)` desde `token-metering.ts`. Pura, sin BD.
      Devuelve el bruto si: modelo desconocido, `cached` null/≤0, o `cached > total`.
- [x] T1.3 `back/tests/chargeable-tokens.test.ts` — AC1, AC2, AC3 (ver `validation.md` T1). **15 verdes.**

## T2 — Aplicar la ponderación al descontar

- [x] T2.1 En `deductTokens`, calcular el imputado y usarlo para `tokensUsed`, `tokensUsedPeriod` y
      `uso_tokens.tokens`. Añadir `tokensBrutos` a `contexto`.
- [x] T2.2 Misma fila (imputado + bruto) en la rama `byok`, sin tocar contadores.
- [x] T2.3 Revisar que la guarda `if (tokens <= 0) return` sigue operando sobre el BRUTO: un turno
      con 0 tokens no registra nada, pero uno cuyo imputado quedara en 0 sí debe dejar fila.
- [x] T2.4 `back/tests/deduct-tokens-cached.test.ts` — AC4, AC5, AC6 (ver `validation.md` T2).
      **11 verdes**, y los 37 de metering previos siguen verdes.
- [x] T2.5 Lectores de `uso_tokens.tokens` revisados: `sumAgentPeriodUsage` (`quota.ts:243`) y
      `reconcile-quota.ts:70` siguen coherentes porque comparan contra `tokensUsedPeriod`, que ahora
      también es imputado. El único afectado es `scripts/measure-token-cost.ts`, script de
      diagnóstico: documentada la limitación en su cabecera. No hay panel de consumo en el front.

## T3 — Bloque base de directrices por encima del mínimo cacheable

- [x] T3.1 Crear `back/src/lib/agent/base-directives.ts` con `BASE_DIRECTIVES` (directrices reales,
      **4.661 caracteres**) y `BASE_DIRECTIVES_MIN_CHARS = 4400`. Última línea: precedencia del
      prompt del operador, con los tres límites que NO se pueden levantar desde él.
- [x] T3.2 Insertarlo como primer elemento del array de `buildSystemPrompt`, antes de `nameLine`.
- [x] T3.3 `back/tests/base-directives.test.ts` — AC7, posición, AC10 y no-invasión de
      `CONVERSATION_STYLE_GUIDE`. **10 verdes.** La precedencia va en este mismo fichero y no en uno
      aparte: son cuatro aserciones sobre la misma constante, y un segundo fichero sólo repetiría los
      mocks.

## T4 — Verificación empírica contra el proveedor real

- [x] T4.1 Prefijo real del turno 1 con el bloque puesto: **1.975 tokens**. Por encima del mínimo de
      1024 y del primer incremento útil de 128. `BASE_DIRECTIVES_MIN_CHARS` se queda en 4400.
- [x] T4.2 AC8 cumplido: **7 de 8** turnos con `iterations === 1` reportan `cachedTokens > 0`. Antes
      del cambio eran 0 de 25 — todos los aciertos venían de la segunda iteración de un turno.
- [x] T4.3 AC9 cumplido. Re-medido tras la corrección de T5.2 (n=2): factura por turno
      **−14% / −33%**, cupo por turno **−25% / −44%**. Los dos bajan en las dos corridas. El rango
      es ancho por varianza del proveedor en el nº de iteraciones; el signo no.
- [x] T4.4 Salidas en `evidence.md` → "Verificación posterior al cambio", incluido el primer intento
      FALLIDO (+25% de factura) y su causa, que es la razón de que la redacción sea la que es.

## T5 — Conversación

- [x] T5.1 Comparación registrada en `evidence.md`. Tres directrices actuando y corrigiendo fallos
      reales (disponibilidad no confirmada, dato pedido antes de tiempo, plazo inventado). Dos
      contrapartidas anotadas sin maquillar: salida +42% y desaparición del emoji (n=1).
- [x] T5.2 **Encontrada una contradicción real en 7 de los 11.** La directriz de minimización de
      datos bloqueaba la captación de leads, y la precedencia blindaba la categoría entera contra el
      prompt del operador. Corregidos el texto y el blindaje (ahora sólo bancarios/identidad/salud),
      +2 tests, y re-medido. Detalle en `evidence.md`.

## Verificaciones finales

- [x] `npm test` en `back`: **159 ficheros, 1.868 verdes, 3 skipped**. Los tres ficheros nombrados
      arriba existen en disco (`ls` comprobado) y aparecen en la salida de vitest.
- [x] `npx tsc --noEmit` en `back` contra el disco: exit 0.
- [x] AC9 demostrado con números medidos contra el proveedor real, no estimados. n=2.
- [x] `--pad` no se usó en esta verificación, así que ningún `systemPrompt` real se tocó. CaressIA
      sigue con sus 1.175 caracteres originales, comprobado en la BD.

## Gates

- **Antes de T3**: T1 y T2 desplegados o al menos verdes. Prefijo largo sin ponderación = cupo del
  cliente +39%.
- **Antes de cerrar**: T4.3. El change se define por AC9; sin ese número medido no está hecho.
