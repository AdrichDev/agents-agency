# Design — `aa-planes-y-cuotas`

## §A. Principio

> **Un cupo que no se renueva no es una suscripción, y un booleano que significa dos cosas no
> es un estado.** Cobrar mes a mes exige que el consumo se mida por periodo y que "sin cuota" y
> "sin pagar" sean hechos distintos.

Corolario, heredado de H1: el precio se deriva del coste **medido**. Fijar tarifa sin conocer el
coste por conversación es vender a ciegas, y con márgenes de LLM es vender a pérdida.

## §B. Estado actual (evidencia)

| Hecho | Dónde | Consecuencia |
|---|---|---|
| `tokensUsed` sólo incrementa, sin periodo | `token-metering.ts:93`, `schema.prisma:64` | no hay renovación posible (F1) |
| corte por `tokensUsed >= tokenBalance` | `token-metering.ts:28` | cupo = saldo de prepago, no cuota |
| `isActive = false` al agotar cupo | `token-metering.ts:101-102` | mezcla cupo con impago (F2) |
| `active = isActive ?? tokenBalance > tokensUsed` | `clients.ts:107` | subir crédito reactiva a un moroso (F2) |
| sin modelo `Plan`, sin precio, sin tarifa | schema completo | no hay producto que vender (F3) |
| `DEFAULT_TOKEN_BALANCE = 10_000_000` | `service.ts:24,140` | 10M tokens regalados por cliente (F3) |
| cuota sólo por tenant | `token-metering.ts:22-31` | un agente agota el cupo de sus hermanos (F4) |
| `isActive` es el filtro de "cliente vigente" | `service-operator.ts:55,352,482` | agotar cupo ocultaba al cliente de la lista, falseaba el panel y **rompía la baja** (F2) |
| `uso_tokens` ya guarda `agente_id`, `modelo`, `operacion` | `schema.prisma:77-93` | el dato para medir y para F4 **ya existe** |
| `@@index([tenantId, createdAt])` | `schema.prisma:91` | agregación por periodo sin migración de datos |

### B.1 Límite de precisión heredado: sólo se guarda `total_tokens`

`runToolLoop` acumula `response.usage?.total_tokens` (`engine.ts:466`) y nada más. Los tokens de
entrada y de salida **no se distinguen**, y en todos los proveedores cuestan distinto (en
`gpt-4o`, la salida ~4× la entrada).

Efecto sobre este change: el coste sólo puede calcularse con una **tarifa mixta estimada** por
modelo, no exacta. Sirve para decidir precio con margen; no sirve para reconciliar contra la
factura del proveedor al centavo. Guardar `prompt_tokens`/`completion_tokens` por separado es un
change aparte (requiere migración de `uso_tokens`) y se anota como deuda, no se hace aquí: la
decisión de precio no necesita esa exactitud, sólo el orden de magnitud y un margen.

## §C. Cambios

### C.1 Separar estado de pago de estado de cupo *(F2, sin migración)*

Dos ediciones quirúrgicas:

**`token-metering.ts` — dejar de apagar `isActive` al agotar cupo.** Se eliminan las líneas
101-102. Dentro de `agents-agency/back` no debilita nada: `checkClientBalance` ya corta por
`tokensUsed >= tokenBalance`, así que esa escritura no aportaba control, sólo efecto colateral
sobre el estado administrativo. **Fuera sí tenía un efecto**: `creador_CRM` lee `aa.tenant.activo`
por SQL y lo usa como único gate en el alta de proyecto, sin comprobar saldo, así que el
apagado automático le daba un bloqueo accidental. Es un efecto no diseñado y no consume LLM; se
registra como deuda (`proposal.md` Risks + `tasks.md`) en lugar de conservarlo, porque conservarlo
significaría mantener el estado contaminado precisamente por su efecto colateral. Tras el cambio:

- `isActive = false` ⇒ **decisión humana o de cobro** (impago, suspensión). Nunca automática.
- cupo agotado ⇒ bloqueado por comparación de saldo, con `isActive` intacto.

**`clients.ts:107` — no inferir `isActive` al asignar crédito.** `isActive` sólo cambia si viene
explícito en el body. Asignar crédito deja de reactivar, y bajar el saldo deja de suspender.

Los dos motivos de corte deben además **distinguirse en el mensaje**: hoy ambos devuelven el
mismo 402 ("Límite de uso… Contacta con el administrador"), y para el cliente no es lo mismo
"has agotado tu cuota del mes" que "tu cuenta está suspendida". El motivo se separa sin exponer
detalle interno.

### C.2 Medición de coste real *(gate humano)*

`back/scripts/measure-token-cost.ts`, **sólo lectura**, mismo patrón que
`inventory-orphan-agents.ts` de H1 (lo ejecuta el propietario; Gru no tiene credenciales de
producción).

Tarifa como entrada **explícita y datable**, no constante enterrada: mapa
`modelo → USD por millón de tokens (mixto)` con la fecha de consulta al proveedor en el propio
fichero, para que quede evidente cuándo caduca.

**Fail-closed sobre la tarifa** *(añadido tras `sdd-verify`, T6.1)*. El mapa replica el catálogo de
modelos del selector, con `null` en lo que no está tarifado, y el script se niega a derivar coste
agregado mientras la cobertura no sea del 100%: imprime el porcentaje, los modelos que faltan y sus
tokens. Razón: la primera versión tarifaba cinco modelos `gpt-4*` y el default de la plataforma es
`gpt-5.4-mini`, así que el informe habría dicho `$0.0000` en todas las columnas de coste. Un
instrumento que ante la falta de datos devuelve cero no es conservador: miente en la dirección más
peligrosa, la que hace creer que servir es gratis. Es el mismo principio que H1 aplicó al cobro
—lo que no se puede medir no se puede vender— aplicado al medidor.

Salidas, todas desde `uso_tokens`:

| Corte | Para qué |
|---|---|
| coste y tokens **por conversación** (media, mediana, p90) | es la unidad de precio del producto |
| por tenant y periodo | ver si algún cliente ya está fuera de márgenes |
| por agente | insumo de F4 y detección del agente que se dispara |
| por modelo | ver si el routing de modelo está costando de más |
| por `operacion` | separar chat de `automation`: una automatización horaria puede pesar más que todo el chat |
| conversaciones sin tokens | detectar consumo mal registrado |

**Sin la salida de este script no se fija ningún precio ni se crea ningún `Plan`.** Es el gate.

### C.3 Cuota por periodo *(con migración — bloqueado por C.2)*

Decisión de ancla: **el periodo va anclado a la fecha de suscripción del tenant, no al mes
natural.** Razón: Stripe factura por aniversario de suscripción (`current_period_start`), y si el
cupo se reinicia el día 1 pero la factura va del 17 al 17, el consumo cobrado nunca cuadra con el
consumo mostrado. El mes natural es más simple hoy y garantiza una discrepancia en H6.

Campos nuevos en `Tenant`:

| Campo | Para qué |
|---|---|
| `periodStart` | ancla del periodo vigente; avanza al renovar |
| `tokensUsedPeriod` | consumo del periodo vigente (el que compara el gate) |

`tokensUsed` **se conserva** con su significado actual (acumulado de por vida): es dato útil y
recalcularlo sería destruir historia.

**Por qué un contador y no una agregación en cada mensaje:** `SUM(tokens)` sobre `uso_tokens` en
la ruta caliente del chat crece con el histórico del tenant. El contador es el camino rápido;
`uso_tokens` sigue siendo la **fuente de verdad** y permite reconciliar el contador cuando haga
falta (y detectar deriva). Los dos se escriben ya en la misma transacción de `deductTokens`.

**Renovación perezosa, no cron.** Al comprobar el cupo: si `now > periodStart + 1 periodo`, se
avanza `periodStart` y se pone `tokensUsedPeriod = 0` antes de decidir. Es idempotente, no
necesita planificador, no acumula deriva si el proceso estuvo caído, y no depende de que un job
se ejecute a tiempo para que un cliente que paga pueda usar su servicio. Un cron que falla el
día 1 es una incidencia de facturación; una renovación perezosa no puede fallar tarde.

### C.4 Modelo `Plan` *(con migración — bloqueado por C.2)*

```
Plan: código, nombre, precio por periodo, cupo de tokens por periodo,
      límite de agentes, activo
Tenant.planId → Plan (opcional)
```

Sustituye a `DEFAULT_TOKEN_BALANCE`: un tenant nuevo recibe el cupo de su plan, y sin plan
asignado recibe **cero** (fail-closed, coherente con H1: lo que no tiene plan no es cobrable, y
lo que no es cobrable no es servible).

**Hueco reservado para H2 (BYOK), sin implementarlo:** cuando el cliente pone su propia key, los
tokens los paga él y el cupo de tokens deja de ser el límite relevante —el plan pasa a cobrar la
plataforma, no el consumo—. El modelo debe admitir un plan con cupo de tokens nulo sin que eso
signifique "bloqueado". Se especifica el hueco; la semántica la cierra H2.

### C.5 Cuota por agente *(F4, con migración — el último)*

Límite opcional por agente sobre el `agente_id` que `uso_tokens` ya registra. Va al final a
propósito: sin datos de C.2 no se sabe si el problema existe en la práctica, y añadir un segundo
límite antes de que el primero funcione por periodo es complejidad sin evidencia.

## §D. Orden y gates

```
C.1 (sin migración, desplegable solo)
     ↓
C.2 medición  →  [GATE HUMANO: el propietario ejecuta y decide precio]
     ↓
C.3 periodo + C.4 Plan  →  [GATE HUMANO: migración en producción]
     ↓
C.5 cuota por agente
     ↓
H6 (Stripe)
```

C.1 y C.2 se entregan en este change. C.3-C.5 quedan especificados y **no se implementan** hasta
que el gate de C.2 devuelva números: escribir el modelo `Plan` con precios inventados sería
exactamente el error que §A prohíbe.

## §E. Estrategia de test

| Caso | Esperado |
|---|---|
| tenant con cupo agotado | 402, y `isActive` **sigue true** (C.1) |
| `deductTokens` que agota el cupo | no escribe `isActive` |
| `PATCH /credits` subiendo saldo, sin `isActive` en el body | `isActive` no cambia: un suspendido sigue suspendido |
| `PATCH /credits` bajando saldo por debajo del consumo | `isActive` no cambia: un cliente al día no se suspende |
| `PATCH /credits` con `isActive` explícito | se respeta (sigue siendo el kill switch manual) |
| tenant suspendido con cupo de sobra | 402 (kill switch intacto) |
| motivo del 402 | distingue cuota agotada de cuenta suspendida |
| `PATCH /credits` con sólo `isActive` | 200, escribe sólo `isActive` (T6.4: el switch del panel) |
| `PATCH /credits` con body vacío | 400: un update sin campos no es una operación |
| script de medición | no automatizable sin BD; typecheck y ejecución del propietario |
| script con tarifa incompleta | no imprime coste agregado; imprime cobertura y modelos que faltan |

Regresión obligatoria: los suites de H1 (`metering-fail-closed`, `metering-chat-route`,
`metering-automations`) deben seguir verdes sin cambios de expectativa, salvo la del efecto sobre
`isActive`, que es justo lo que este change corrige.
