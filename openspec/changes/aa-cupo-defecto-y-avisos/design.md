# Diseño — aa-cupo-defecto-y-avisos (H7)

## A. La constante

```ts
// back/src/lib/quota.ts
/**
 * Cupo por defecto: tokens por agente activo y periodo cuando el tenant no tiene ni override ni
 * plan. Es la política de la plataforma, no un dato de ningún cliente.
 *
 * Medido el 27/07/2026: toda la plataforma consumió 111.561 tokens en un mes (~3.100 por
 * interacción). 10M ≈ 3.200 interacciones/mes ≈ 107/día. Techo alcanzable por un negocio con
 * tráfico real, inalcanzable por accidente.
 *
 * Debe coincidir con `PLAN_TOKENS` (front/components/presupuestos/types.ts), que es el que se
 * ENSEÑA en /tarifas. Hay un test que compara los dos ficheros para que no deriven.
 */
export const DEFAULT_TOKEN_QUOTA_PER_AGENT = 10_000_000;
```

## B. Resolución del cupo — el antes y el después

### B.1 Tenant (`resolveTokenQuota`)

| Caso | Hoy | Con este change |
|---|---|---|
| `tokenBalance` con valor | `{limit: ese, source: "override"}` | **igual** |
| `tokenBalance = 0` | `{limit: 0, source: "override"}` → bloqueado | **igual** (el kill switch no se toca) |
| Plan con `tokenQuotaPerAgent` | `× max(1, agentes)`, `source: "plan"` | **igual** |
| Plan con `tokenQuotaPerAgent = null` | `{limit: null, source: "plan"}` → sin tope | **igual** |
| **Sin override y sin plan** | `{limit: 0, source: "none"}` → **402 "sin plan"** | `{limit: 10M × max(1, agentes), source: "default"}` |

El orden sigue siendo override → plan → defecto, y por el mismo motivo de H4: el override es un acto
explícito sobre un cliente concreto; si la regla general ganara, cualquier ajuste manual se desharía
solo y sin dejar rastro.

**`"none"` desaparece del tipo.** Era alcanzable por un único camino —sin override y sin plan— y ese
camino ahora devuelve `"default"`. Dejarlo en la unión sería una rama que ningún dato produce, y las
ramas que no se pueden alcanzar se leen como si sí, que es peor que no tenerlas. Consecuencia
directa: **`MSG_SIN_PLAN` y su `throw` se retiran** de `token-metering.ts:112`.

### B.2 Agente (`resolveAgentQuota`)

| Caso | Hoy | Con este change |
|---|---|---|
| Override del agente | ese valor | **igual** |
| **Sin plan** | `{limit: null, source: "none"}` → **sin tope propio** | `{limit: 10M, source: "default"}` |
| Plan con `tokenQuotaPerAgent = null` | sin tope | **igual** |
| Plan con valor | ese valor | **igual** |

Aquí está la parte que importa del modelo de negocio. Si el cupo del tenant es 10M × agentes y el
agente no tiene tope propio, **un agente charlatán se come el cupo de los otros dos que el cliente ya
está pagando**. Con el defecto por agente, 3 agentes son 30M en total y 10M cada uno.

Con **un** agente los dos topes coinciden en el mismo número y el corte cae en el mismo punto: no
sobra, es el mismo límite mirado desde los dos lados.

Ojo con la distinción que ya fijó H4 T5 y que **no** cambia: un plan con `tokenQuotaPerAgent = null`
significa *sin tope*, deliberadamente. "Sin plan" y "plan que no pone tope" son cosas distintas y
sólo la primera cae al defecto.

### B.3 `quotaNeedsAgentCount`

Ahora el caso "sin plan" también multiplica, así que también necesita el recuento:

```ts
export function quotaNeedsAgentCount(tenant: QuotaInput): boolean {
  if (tenant.tokenBalance !== null && tenant.tokenBalance !== undefined) return false;
  if (!tenant.plan) return true;                       // defecto: multiplica ⇒ hay que contar
  return tenant.plan.tokenQuotaPerAgent !== null;
}
```

Coste: hoy los 15 tenants tienen override ⇒ sigue devolviendo `false` y no se paga nada. Los tenants
nuevos pagarán un `count` indexado por mensaje. Es la factura de la decisión de §A del proposal y se
paga a sabiendas.

## C. Umbrales

```ts
export type QuotaWarning = "ok" | "warn75" | "warn90" | "exhausted";

/**
 * Nivel de aviso del consumo contra el cupo. Puro: el gate corta, esto sólo informa.
 * Sin tope (`null`) es "ok": no hay nada de lo que avisar.
 * Cupo 0 es "exhausted" sin dividir — es un bloqueo, no un 0/0.
 */
export function quotaWarningLevel(used: number, limit: number | null): QuotaWarning {
  if (limit === null) return "ok";
  if (limit <= 0) return "exhausted";
  const ratio = used / limit;
  if (ratio >= 1) return "exhausted";
  if (ratio >= 0.9) return "warn90";
  if (ratio >= 0.75) return "warn75";
  return "ok";
}
```

Decisiones:

- **`>=`, igual que el corte del gate** (`tokensUsedPeriod >= limit`, `token-metering.ts:115`). Si
  el aviso usara `>` y el corte `>=`, existiría un consumo exacto en el que el agente está cortado y
  el panel dice "ok". Un número que contradice a la máquina es peor que ningún número.
- **`limit <= 0` ⇒ `exhausted` sin dividir.** Cubre el `0` del kill switch y cualquier negativo que
  entre por un override mal puesto, sin producir `NaN` ni `Infinity`.
- **`limit === null` ⇒ `ok`.** Sin tope no hay porcentaje. No es "todo bien" por optimismo: es que la
  pregunta no aplica.
- Se calcula, **no se guarda**. Guardarlo obligaría a recalcularlo en cada consumo y a resetearlo en
  cada renovación: el mismo argumento por el que H4 T5 decidió derivar el consumo por agente en vez
  de cachearlo.

## D. Superficie

### D.1 Back

- `back/src/routes/clients.ts:33` — `withQuota()` añade `quotaWarning` al objeto que ya devuelve
  (`tokenQuota`, `quotaSource`, `billableAgents`). Un campo más en el mismo sitio: el panel ya lee de
  ahí y no hay que tocar el contrato de nadie más.
- `back/src/lib/token-metering.ts` — se retira el bloque `if (source === "none") throw` y la
  constante `MSG_SIN_PLAN`. Los otros tres motivos de 402 (`MSG_SUSPENDIDO`, `MSG_CUOTA`,
  `MSG_CUOTA_AGENTE`) se quedan como están.

### D.2 Front

- `front/components/clientes/types.ts:27` — `quotaSource` pasa de `"override" | "plan" | "none"` a
  `"override" | "plan" | "default"`. Nuevo campo `quotaWarning`.
- `front/components/clientes/ClientRow.tsx:46,94` — desaparece `noPlan` y la etiqueta **`SIN PLAN`**;
  entra el aviso: 75% ámbar, 90% rojo, 100% el `BLOQUEADO` que ya existe. `SIN TOPE` (línea 75) se
  queda: sigue siendo un estado real (plan con cupo nulo).

El detalle que importa de la UI: `SIN PLAN` no se sustituye por `10M` a secas. Se enseña de dónde
viene el número, porque "10M porque es lo que damos por defecto" y "10M porque alguien se lo puso a
mano" se arreglan de formas distintas cuando hay que arreglarlos.

## E. Test que evita la tercera copia de 10M

`PLAN_TOKENS = 10_000_000` ya existe en `front/components/presupuestos/types.ts:13` y es el que
alimenta `/tarifas`. Si el back aplica 10M y el front anuncia otra cosa, el cliente lee una promesa
que la máquina no cumple.

Un test del back lee el fichero del front **desde disco** y compara con la constante. Es el mismo
recurso que usó H4 T4.1 para probar que `Plan` no tiene importes: front y back son paquetes
separados, no se pueden importar entre sí, pero el fichero se puede leer.

No unifica los catálogos —eso es otro change— pero cierra la puerta a que este número derive.
