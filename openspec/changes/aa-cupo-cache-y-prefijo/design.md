# Diseño — aa-cupo-cache-y-prefijo

## Decisión 1 — La ponderación vive dentro de `deductTokens`

`deductTokens` es el cuello por el que pasa TODO el consumo: `chatWithAgent`, `automations/engine`,
`lead-intent` y `crm_generate` acaban ahí. Ponderar en cada llamador sería repetir la regla cuatro
veces y garantizar que el quinto llamador la olvide — el mismo agujero que H1 encontró en
`automations/engine` con el gate.

Los datos ya están en la firma: `tokens` (bruto) y `contexto.cachedTokens`. No hace falta cambiar
ninguna llamada.

```ts
// back/src/lib/token-metering.ts
const brutos = tokens;
const imputados = chargeableTokens(brutos, contexto?.cachedTokens ?? null, model);
```

`chargeableTokens` es exportada y pura, para poder probarla sin BD:

```ts
export function chargeableTokens(
  total: number,
  cached: number | null | undefined,
  model: string,
): number {
  const ratio = CACHED_TOKEN_RATIO[model];
  if (ratio === undefined || cached == null || cached <= 0) return total;
  // Los cacheados son un SUBCONJUNTO del prompt, que a su vez es subconjunto del total.
  // Si un proveedor informara más cacheados que totales, el dato es incoherente: se ignora
  // en lugar de producir un cargo negativo.
  if (cached > total) return total;
  return Math.ceil(total - cached * (1 - ratio));
}
```

`Math.ceil` y no `round`: ante el redondeo, el medio token va contra el cliente y no contra el
propietario. Es la dirección conservadora — el error de un token no importa, pero la política de
en qué dirección se redondea sí, porque es la que se aplica millones de veces.

### Qué se guarda

| Campo | Antes | Después |
|---|---|---|
| `tenant.tokensUsed` / `tokensUsedPeriod` | bruto | **imputado** |
| `uso_tokens.tokens` | bruto | **imputado** |
| `uso_tokens.contexto.promptTokens` | prompt | prompt (sin cambio) |
| `uso_tokens.contexto.cachedTokens` | cacheados | cacheados (sin cambio) |
| `uso_tokens.contexto.tokensBrutos` | — | **nuevo**: el total sin ponderar |

`uso_tokens.tokens` pasa a imputado y no se queda en bruto porque `sumAgentPeriodUsage`
(`quota.ts:243`) suma esa columna para el tope POR AGENTE, mientras el tope del tenant se compara
contra `tokensUsedPeriod`. Si una guardase bruto y la otra imputado, los dos topes medirían cosas
distintas y el del agente cortaría antes que el del tenant sin motivo.

El bruto no se pierde: va a `contexto.tokensBrutos`. Es el dato con el que se reconstruye la
factura del propietario, y es justo la separación que el comentario de `deductTokens` ya
declaraba ("eso es lo que se le imputa al cliente, esto es lo que le costó al propietario") pero
que hasta ahora no se aplicaba.

### Tabla de ratios

```ts
// Ratio precio_cacheado / precio_input. Verificado contra la doc oficial de precios el
// 29/07/2026. Un modelo AUSENTE no se pondera: se imputa el bruto, que es lo de hoy.
const CACHED_TOKEN_RATIO: Record<string, number> = {
  "gpt-5.6-luna": 0.1, "gpt-5.5": 0.1, "gpt-5.4": 0.1,
  "gpt-5.4-mini": 0.1, "gpt-5.4-nano": 0.1,
  "gpt-4.1": 0.25, "gpt-4.1-mini": 0.25, "gpt-4.1-nano": 0.25,
  "gpt-4o": 0.5, "gpt-4o-mini": 0.5,
};
```

Vive en `model-capabilities.ts`, junto a `MODEL_CAPABILITIES`: es el mismo tipo de hecho (una
propiedad del modelo verificada contra la doc del proveedor) y tenerlo en dos ficheros
garantizaría que uno se actualice y el otro no.

**Gemini y Anthropic quedan fuera a propósito.** Sus ratios no se han verificado, y un ratio
inventado sería peor que ninguno: aflojaría el cupo con un número que nadie puede defender. Sin
entrada en la tabla se cobra el bruto, que es exactamente el comportamiento de hoy — fallar hacia
lo conocido.

### BYOK

La rama `credentialMode === "byok"` no toca contadores, sólo crea la fila. La fila lleva el
imputado igual que en `platform`, y `tokensBrutos` al lado. Cambiar sólo una de las dos ramas
haría que las filas de un mismo tenant significaran cosas distintas según el modo en que estaba
ese día.

## Decisión 2 — El bloque base de directrices, al PRINCIPIO del prompt

Módulo nuevo: `back/src/lib/agent/base-directives.ts`, exportando `BASE_DIRECTIVES`. Se inserta
como primer elemento del array de `buildSystemPrompt` (`engine.ts:445`), **antes** de `nameLine` y
de `agent.systemPrompt`.

Va primero y no al final por una razón concreta: la caché casa por prefijo, así que un bloque
idéntico y en cabecera es el ÚNICO que pueden compartir agentes distintos. Puesto al final, cada
agente necesita su propio tráfico para calentar su propia entrada de caché; puesto delante, un
agente recién publicado acierta desde su segundo turno.

Eso mueve `nameLine` y el prompt del operador detrás del bloque de plataforma, y ese orden hay que
sostenerlo explícitamente: `BASE_DIRECTIVES` termina con una línea de precedencia — las
instrucciones que siguen prevalecen sobre estas. Sin esa línea el cambio de orden sería un cambio
de comportamiento encubierto: hoy el prompt del operador es lo primero que el modelo lee.

### Tamaño

El bloque base debe superar **por sí solo** el mínimo cacheable de 1024 tokens, no en suma con el
prompt del agente. Si dependiera de la suma, un operador que escribe un prompt de dos líneas
volvería a caer por debajo del umbral y perdería la caché sin enterarse — el fallo sería
invisible y sólo se vería en la factura.

Objetivo: **≥ 1.100 tokens** de bloque base. El margen sobre 1024 no es decorativo: la caché de
OpenAI casa en incrementos de 128 tokens, así que quedarse a 30 tokens del mínimo es quedarse
fuera del primer incremento útil.

### Contenido

Directrices reales de comportamiento, no relleno. El bloque de `--pad` del script de medición sirvió
para probar el umbral, pero no puede ir a producción tal cual: alargar el prompt con texto inerte
gastaría 1.100 tokens en cada turno de cada agente a cambio de nada más que un acierto de caché.
El contenido son las normas que hoy están repartidas o implícitas: idioma, trato, no inventar datos
del negocio, límites (nada de consejo médico/legal/financiero, no pedir datos bancarios ni
documentos por el chat), escalado a persona, y cierre.

Riesgo aceptado y declarado: esto CAMBIA lo que responden los 11 agentes. No es un cambio de
metering, es un cambio de producto. Por eso lleva verificación conversacional propia (T4).

### Lo que NO se toca

`CONVERSATION_STYLE_GUIDE` se queda donde está y como está. T5.3 ya midió que su versión
comprimida no degrada la conversación; volver a alargarla desharía un trabajo ya verificado.

## Umbral verificable sin tokenizer

El back no tiene tokenizer (`tiktoken` no está en `package.json`, comprobado), y añadir uno para un
test sería meter una dependencia nativa por una aserción.

Se comprueba en dos niveles:

1. **Test unitario, barato y determinista**: `BASE_DIRECTIVES.length >= BASE_DIRECTIVES_MIN_CHARS`.
   El umbral en caracteres se deriva de una medición real (llamada con el prompt puesto, leyendo
   `usage.prompt_tokens`) y se elige con margen: ratio conservador de 4,0 chars/token para español
   ⇒ **4.400 caracteres**. Falla si alguien recorta el bloque.
2. **Verificación empírica, una vez, en la tarea**: una llamada real cuyo `prompt_tokens` debe
   salir > 1024 y cuyo `cached_tokens` debe ser > 0 en el segundo turno. Es lo único que prueba de
   verdad que la caché acierta; el test unitario sólo protege de la regresión.

El ratio chars/token no es una constante universal y no se pretende que lo sea: es un guardarraíl
con margen suficiente para que un error del 10% no baje del umbral.

## Efecto combinado esperado

Sobre la conversación medida (13 turnos, `gpt-5.4-mini`, ver `evidence.md`):

| | Factura propietario | Cupo cliente |
|---|---|---|
| Hoy | $0.01321 | 15.770 tok |
| Con ambos cambios | $0.00935 (−29%) | 9.842 tok (−38%) |

Los dos números bajan. Ese es el criterio de aceptación del change: si al medir el cupo sube,
el change está mal y se revierte.

## Lo que este diseño NO resuelve

- El cupo sigue midiéndose en tokens. Un cliente en `gpt-4o` consume el mismo cupo que uno en
  `gpt-4.1-nano` costando 25× más. La solución de raíz es medir en coste, y es un cambio de
  contrato con el cliente, no de implementación.
- Las filas históricas de `uso_tokens` NO se migran. Durante el periodo en curso, `tokensUsedPeriod`
  mezclará brutos anteriores al despliegue con imputados posteriores. Es aceptable: el efecto es que
  el cliente rinde algo menos de lo que rendirá el periodo siguiente, nunca al revés. Reescribir
  contadores de facturación hacia atrás sería peor que el desajuste.
- Los 11 agentes siguen en 4 modelos distintos.
