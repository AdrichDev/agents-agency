# Proposal — `aa-planes-y-cuotas`

Hijo **H4** del eje `aa-agentes-entrega-monetizacion`. **P1, pero bloquea vender de verdad.**
*Depende de:* H1 (`aa-metering-fail-closed`, commit `718d4e4`). *Bloquea:* H6 (Stripe).

## Intent

H1 puso el grifo: hoy todo consumo de LLM pasa por un gate y queda registrado. Pero el grifo
no tiene contador de periodo ni tarifa. Este change convierte el cupo en algo **vendible como
suscripción**: cuota por periodo que se renueva, estado de pago separado del estado de cupo, y
precio derivado de coste **medido**, no inventado.

## Por qué no se puede vender con lo que hay

Evidencia recogida sobre el código en `master` + H1 (`back/`):

### F1 — El cupo es acumulado histórico y nunca se reinicia

`Tenant.tokensUsed` (`schema.prisma:64`, "consumo acumulado") sólo se incrementa
(`token-metering.ts:93`), y `checkClientBalance` corta con `tokensUsed >= tokenBalance`
(`token-metering.ts:28`). No hay periodo en ninguna parte.

Consecuencia: **una suscripción mensual es imposible hoy.** El cliente agota su cupo una vez y
se queda agotado para siempre; la única "renovación" es que el propietario suba `tokenBalance`
a mano por `PATCH /api/clients/:id/credits` (`clients.ts:91-111`). Eso no es un plan, es una
recarga de prepago operada por una persona.

### F2 — `isActive` colapsa dos estados que deben ser independientes *(el grave)*

`isActive` es el kill switch administrativo (impago, suspensión manual). Pero
`deductTokens` lo apaga también al agotar cupo (`token-metering.ts:101-102`), y el endpoint de
créditos lo vuelve a encender por inferencia:

```ts
// back/src/routes/clients.ts:107
const active = isActive ?? tokenBalance > current.tokensUsed;
```

Dos estados distintos —"gastó su cuota del mes" y "no ha pagado"— comparten un booleano. Con
Stripe (H6) eso es un **agujero de cobro**: subir el crédito de un cliente moroso lo reactiva
sin que nadie haya decidido reactivarlo. Y al revés, bajar el saldo por debajo del consumo
suspende a un cliente que sí paga.

Además la desactivación de la línea 101 es **redundante para el bloqueo en `agents-agency/back`**:
`checkClientBalance` ya corta por la comparación de saldo. No aporta control ahí; sólo contamina el
estado de pago. (En `creador_CRM`, que lee `aa.tenant.activo` por SQL y no comprueba saldo, sí
aportaba un bloqueo accidental: ver Risks.)

Y lo contamina más lejos de lo que parecía. `isActive` es el filtro de "cliente vigente" en tres
sitios de `service-operator.ts`, así que agotar un cupo tenía **efectos visibles que nada tenían
que ver con el consumo**:

| Sitio | Efecto de agotar cupo |
|---|---|
| `listClientesHandler` (`:352`, `where: {isActive: true}`) | el cliente **desaparece** de la lista del operador, como si se le hubiera dado de baja |
| `estadoHandler` (`:55`, `count({where: {isActive: true}})`) | la métrica "clientes activos" baja: el panel miente |
| `bajaCliente` (`:482`, `updateMany({where: {id, isActive: true}})`) | **bug**: dar de baja a un cliente con cupo agotado devuelve `count = 0`, que el handler interpreta como "no existe o ya estaba dado de baja". La baja falla en silencio |

El tercero es un fallo real y no estaba cubierto por ningún test: no se podía dar de baja a un
cliente que hubiera agotado su cupo.

### F3 — No hay `Plan`, ni cupo por plan, ni coste conocido

No existe modelo `Plan` en el schema, ni tabla de precio por modelo, ni un solo lugar donde
`tokens` se convierta en dinero. Y mientras tanto:

```ts
// back/src/lib/agent/service.ts:24, usado en :140
export const DEFAULT_TOKEN_BALANCE = 10_000_000;
```

Cada cliente creado desde el wizard recibe **10 millones de tokens** por defecto, sin decisión
de negocio detrás. A tarifa mixta de `gpt-4o` eso son decenas de dólares regalados por cliente.
Es el único "plan" que existe hoy: uno, implícito, y probablemente a pérdida.

**Matiz añadido el 27/07/2026, tras decisión del propietario:** que no exista precio en el esquema
**no** es parte del defecto, y arreglar F3 no consiste en añadirlo. En AA no va ningún importe. El
defecto es que no hay `Plan` (y por tanto no hay cupo con decisión detrás) y que no se conoce el
coste. El precio se configura en Stripe (H6): AA expone el **recuento de agentes activos** y Stripe
aplica la tarifa. Ver `design.md §C.4`.

### F4 — La cuota es sólo por tenant

Un cliente con tres agentes no puede repartir ni limitar por agente: el primero que se dispare
consume el cupo de los otros dos. `uso_tokens` **sí** guarda `agente_id`, así que el dato para
hacerlo ya se está recogiendo; lo que falta es el límite.

## Approach

**Medir antes de tarifar.** Es la regla que el eje ya se fijó (`design.md §C`, H4) y se respeta
al pie de la letra: la primera entrega de este change **no fija ningún precio**. Y por decisión del
propietario (27/07/2026) **ninguna entrega posterior lo fijará tampoco**: los importes viven en
Stripe, no en el esquema de AA. Medir sigue siendo obligatorio —el propietario necesita el coste
para poner una tarifa defendible—, pero la tarifa se escribe en el cobrador. Fija el
instrumento para conocer el coste real por conversación desde `uso_tokens`, que es dato de
producción y sólo el propietario puede leerlo.

Orden deliberado, de lo que no depende de decisiones de negocio a lo que sí:

1. **F2 primero, y sin migración.** Separar los dos estados es un arreglo de defecto, no una
   decisión comercial: deja de apagarse `isActive` por agotamiento y deja de inferirse al
   asignar crédito. El bloqueo por cupo se mantiene intacto (ya lo hace la comparación de
   saldo). Se puede desplegar solo, y conviene: cierra el agujero antes de que exista Stripe.
2. **Medición.** Script de sólo lectura sobre `uso_tokens`: tokens y coste por conversación, por
   tenant, por agente, por modelo y por `operacion`, con la tarifa por modelo como entrada
   explícita y versionada. Salida: coste real por conversación. **Gate humano:** lo ejecuta el
   propietario, igual que el inventario de H1.
3. **Periodo.** Cuota por periodo en vez de acumulado histórico, calculada agregando
   `uso_tokens` sobre el índice que ya existe (`@@index([tenantId, createdAt])`) en lugar de
   confiar en un contador que nadie reinicia.
4. **`Plan`.** Modelo con precio y cupo por periodo, una vez el paso 2 diga qué precio tiene
   sentido. Sustituye a `DEFAULT_TOKEN_BALANCE`.
5. **Cuota por agente** (F4), sobre el `agente_id` que ya se registra.

Los pasos 3-5 llevan migración ⇒ **human gate obligatorio** antes de aplicarla en producción, y
se especifican aquí pero no se implementan hasta que el paso 2 tenga números.

## Scope

**Incluye:** separación de estados (F2); instrumento de medición de coste; especificación del
modelo `Plan`, del cupo por periodo y de la cuota por agente.

**Excluye:** Stripe y cualquier cobro real (H6); portal de cliente para ver su consumo (H5);
BYOK y su efecto en el coste (H2 — con key del cliente el coste de tokens es suyo, no nuestro,
y eso cambia la tarifa: este change debe dejar sitio para esa distinción, no resolverla);
tarifas por otros recursos (almacenamiento de conocimiento, minutos de voz).

## Risks

- **Cambiar el significado de `isActive` toca la ruta caliente del chat.** Mitigación: el
  bloqueo por cupo no se mueve de sitio, sólo se deja de duplicar en un booleano; test de
  regresión que verifique que un tenant agotado sigue recibiendo 402.
- **Un cliente hoy suspendido por agotamiento quedaría con `isActive = true`** tras el cambio si
  alguien lo reactivó a mano en el pasado. Mitigación: el corte por saldo es independiente de
  `isActive`, así que sigue bloqueado por cupo. **Dentro de `agents-agency/back` no hay ventana de
  servicio gratis; fuera sí** (siguiente punto).
- **Efecto cruzado en `creador_CRM`** *(hallazgo de `sdd-verify`, T6.3)*. `creador_CRM` no llama a
  `checkClientBalance`: consulta `aa.tenant` por SQL directo y usa `activo = true` como gate.
  `POST /api/projects` (`back/src/lib/projects/create-project-service.ts:78`) sólo comprueba que
  el tenant exista y esté activo, **sin mirar saldo**. Antes, agotar el cupo lo apagaba y el CRM
  devolvía 422; ahora un cliente al día con el cupo gastado puede volver a crear proyectos.
  Valoración: ese bloqueo era un **efecto colateral no diseñado** de F2, no una regla de negocio,
  y crear un proyecto no consume LLM (sólo aprovisiona filas). El camino del operador
  (`creador_CRM/back/src/routes/service-operator.ts:283`) sí comprueba saldo y **mejora**: pasa de
  un 422 "el tenant no existe" a un 402 "sin tokens", que es la verdad. Se acepta como deuda
  explícita (ver `tasks.md`), no se cierra aquí: gatear el CRM por saldo es la misma tarea que
  cubrir las vías sin LLM de AA, y ninguna de las dos es este change.
- **El motivo del 402 es ahora un oráculo público** *(T6, W5)*. Distinguir "sin cupo" de
  "suspendido" es AC5, pero esos mensajes llegan a canales anónimos (widget, WhatsApp, Telegram):
  un visitante puede saber que el negocio agotó su cupo de IA, y quien intente drenarlo obtiene
  confirmación de que funcionó. Tradeoff aceptado: el cliente legítimo necesita saber por qué su
  asistente no responde, y el detalle expuesto es de estado, no de datos. Mitigación pendiente si
  molesta: mensaje genérico en canales públicos y detallado en el panel del operador.
- **Tarifa por modelo desactualizada** ⇒ coste medido erróneo y precio mal puesto. Mitigación:
  la tarifa es entrada explícita del script, con fecha, no una constante enterrada.
- **Cupo por periodo mal anclado** (mes natural vs fecha de alta) da facturas que no cuadran con
  Stripe. Mitigación: decidir el ancla en `design.md` **antes** de la migración, no después.
- **Migración sobre datos de producción** (pasos 3-5): human gate, y `uso_tokens` es la fuente
  de verdad del consumo histórico ⇒ no se toca ni se recalcula.

## Dependencies

- H1 `aa-metering-fail-closed` (commit `718d4e4`, sin push): sin gate único no hay dato fiable
  que medir. Ya cerrado.
- `uso_tokens` con `agente_id`, `modelo`, `operacion` y `@@index([tenantId, createdAt])`
  (`schema.prisma:77-93`): el dato necesario ya se recoge.
- Lectura de producción: **sólo el propietario**. Supabase MCP responde
  `Unauthorized: falta SUPABASE_ACCESS_TOKEN`.
- H6 (Stripe) depende de este change. H2 (BYOK) es independiente pero afecta a la tarifa.
