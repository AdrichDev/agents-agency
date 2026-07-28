# Design — aa-metering-fail-closed

## §A. Principio

> **Lo que no es cobrable, no es servible.** Ante duda sobre el tenant, el cupo o la
> credencial: cortar. El estado por defecto de lo desconocido es 402, no "adelante".

Corolario de arquitectura: **un gate por canal es un gate roto**. Se coloca en el cuello
único por el que pasa todo consumo de LLM, de forma que añadir un canal nuevo herede el
control por construcción en vez de tener que recordarlo.

## §B. Punto de intercepción

```
routes/ai.ts:79 ─────────────┐
channels/telegram-webhook:113 ├──> chatWithAgent (engine.ts:600) ──> runAgent (engine.ts:513)
channels/whatsapp-webhook:119 ┘                                          │
                                                                        ├─ findUniqueOrThrow (524) ← agent.tenantId disponible
                                                                        ├─ ★ GATE AQUÍ
                                                                        ├─ buildAgentTools / buildSystemPrompt
                                                                        └─ runToolLoop (428) ← consumo real de tokens
```

**Por qué `runAgent` y no `chatWithAgent`:** `runAgent` ya hace el `findUniqueOrThrow` del
agente (línea 524) ⇒ `tenantId` sale gratis, sin query nueva. Y es el paso inmediatamente
anterior al gasto real de tokens, así que el gate corre lo más tarde posible sin llegar a
gastar — máxima precisión, mínimo coste.

**Por qué no en las rutas:** tres llamadores hoy, N mañana. El coste de olvidarlo una vez es
consumo invisible e ilimitado (exactamente lo que pasó con Telegram y WhatsApp).

## §C. Cambios

### C.1 `back/src/lib/token-metering.ts`

Nuevo export, decisión pura sin acceso a BD propio (delega en `checkClientBalance`):

```ts
export async function assertUsageAllowed(
  tenantId: string | null | undefined,
  opts: { isTest?: boolean } = {}
): Promise<string | null>
```

- `opts.isTest === true` → devuelve `tenantId ?? null` sin comprobar saldo (exención de
  consola, ver §D).
- `!tenantId` → **`HttpError(402)`**. Fail-closed: éste es el cambio de comportamiento.
- resto → `await checkClientBalance(tenantId)` y devuelve `tenantId`.

Se corrige el comentario de cabecera del módulo (línea 11), que hoy documenta como
intencional lo contrario: *"Agente sin clientId → sin metering (uso interno, ilimitado)"*.

### C.2 `back/src/lib/agent/engine.ts`

- `runAgent(...)`: parámetro `isTest = false` **al final** de la firma (aditivo,
  retrocompatible con los llamadores que no lo pasan).
- Tras el `findUniqueOrThrow` (524) y **antes** de `buildAgentTools`:
  `const meteredTenantId = await assertUsageAllowed(agent.tenantId, { isTest })`.
- `AgentReply` gana `meteredTenantId?: string | null` (aditivo, opcional).
- `chatWithAgent`: pasa `isTest` a `runAgent`, y el `deductTokens` de la línea 720 usa
  `reply.meteredTenantId` en lugar del parámetro `clientId` del llamador.
- El parámetro `clientId` de `chatWithAgent` se conserva por compatibilidad de firma pero
  queda **deprecado y sin efecto**: la fuente de verdad es la BD, no quien llama. Se
  documenta en el JSDoc.

### C.3 `back/src/routes/ai.ts`

- Se elimina el bloque `if (agent.tenantId) { checkClientBalance }` (líneas 69-76): pasa a
  ser redundante y era la fuente del fail-open. Una sola fuente de verdad.
- El `catch` (líneas 88-90) mapea el status: hoy responde **500 fijo**, lo que convertiría
  un 402 legítimo en error interno y el widget mostraría "Error" en vez del motivo.

### C.4 Webhooks

`telegram-webhook.ts:113-118` y `whatsapp-webhook.ts:119-124` ya capturan la excepción y
responden `200` (correcto: evita el bucle de reintentos del proveedor). Se añade únicamente
distinción del mensaje al usuario final cuando el status es 402 — "servicio temporalmente
no disponible" en vez de "ha ocurrido un error", que es falso y no accionable.

### C.5 `back/scripts/inventory-orphan-agents.ts` (nuevo, sólo lectura)

Inventario previo al despliegue: lista agentes con `tenantId = NULL` (id, nombre, canal,
`publicKey` presente, fecha de creación, si tiene conversaciones reales no-test). **No
escribe nada.** Es el gate operativo: si devuelve filas, se les asigna tenant antes de
desplegar.

### C.6 Segundo punto de gate: entrada de `chatWithAgent` *(hallazgo de implementación)*

`runAgent` **no era suficiente**, contra lo que asumía §B. Dos vías lo esquivaban:

1. **El flujo de captación de lead responde sin llegar a `runAgent`.** Si
   `nextLeadFlowStep` marca `flowResult.handled` (`engine.ts:638`), `chatWithAgent` contesta
   con el guion determinista y retorna. Coste LLM cero, cierto — pero un tenant con
   `isActive = false` seguía **atendiendo y creando leads**. El kill switch tiene que cortar
   el *servicio*, no sólo el gasto; si el cliente dejó de pagar, el agente no sigue
   trabajando gratis.
2. **La `Conversation` se creaba antes del corte** (`engine.ts:629`). Un agente bloqueado
   dejaba una fila por intento, desde una ruta pública y sin límite. Escritura sin gate.

Se añade el gate al entrar en `chatWithAgent`, antes de tocar la conversación, con una lectura
propia de `agent.tenantId` (`select` mínimo). Coste: una lectura por PK, despreciable frente a
una llamada LLM. El gate de `runAgent` **se mantiene** — cubre a cualquier llamador directo y
es el que resuelve `meteredTenantId`. Dos gates baratos e idempotentes valen más que uno solo
bien colocado que mañana alguien rodea.

### C.7 `isTest` era un bypass en la ruta pública *(hallazgo de seguridad)*

La exención de §D es correcta como decisión de producto y **habría sido un agujero** tal como
estaba planteada: `POST /api/chat` está en la allowlist pública (`public-routes.ts:21`). Con
`assertUsageAllowed` honrando el flag sin más, un tercero enviaría

```json
{ "publicKey": "<clave del widget, visible en el HTML del cliente>", "message": "…", "test": true }
```

y consumiría la cuenta LLM de la plataforma **sin cupo y sin kill switch**, usando una clave
que por diseño es pública. Peor que el fail-open que este change viene a cerrar.

Fix: `ai.ts` sólo honra el flag con sesión — `const isTest = Boolean(test) && Boolean(req.user)`.
El gate global de `/api` resuelve `req.user` también en rutas públicas cuando llega un Bearer
válido, así que la consola autenticada sigue funcionando sin cambios en el front.

**Lección para H2:** toda exención de un control de coste debe declarar *quién* puede
invocarla, no sólo *cuándo*. Una exención sin sujeto es un bypass.

### C.8 Cuarto llamador de `runAgent`: automatizaciones *(hallazgo de verificación)*

§B enumeraba tres llamadores (widget, Telegram, WhatsApp), todos vía `chatWithAgent`. Faltaba
uno: `src/lib/automations/engine.ts:114` llama a `runAgent` **directamente**, sin pasar por
`chatWithAgent` (no hay conversación: es un disparo por schedule o webhook).

Consecuencia de poner el gate en `runAgent` pero la contabilización en `chatWithAgent`:

| Camino | Gate de saldo | `deductTokens` |
|---|---|---|
| widget / Telegram / WhatsApp | sí | sí |
| automatizaciones y cron | sí (heredado) | **no** |

Es exactamente el fail-open que este change cierra, en su segundo eje: el consumo existía y no
se registraba. Un tenant que operara sólo con automatizaciones habría consumido sin tope real
—`tokensUsed` nunca subía, así que `checkClientBalance` nunca cortaba— y sin una sola fila en
`uso_tokens`. Además habría dado a **H4** datos de consumo falsos por defecto. Preexistente al
change, no regresión suya.

Fix: `deductTokens` tras `runAgent` en `runAutomation`, con `operacion: "automation"` para poder
separar después el gasto conversacional del automático. Requirió relajar la firma a
`conversationId: string | null` — la columna ya era opcional en el schema, la firma era más
estricta de lo necesario, y esa rigidez de más era justamente lo que impedía registrar este
consumo.

**Lección, y es la del change entero:** el "cuello único" hay que *verificarlo* enumerando
llamadores, no suponerlo. Dos veces se supuso mal (C.6 y aquí).

### C.9 `meteredTenantId` no puede salir del motor *(hallazgo de seguridad)*

`AgentReply.meteredTenantId` es un campo interno para que `deductTokens` no dependa del
`clientId` del llamador. Pero `chatWithAgent` devolvía `{...reply}` completo, y `POST /api/chat`
—ruta **pública**— reenvía esa respuesta tal cual al widget embebido en el sitio del cliente:
el id interno del tenant quedaba expuesto a cualquiera con la clave pública, que antes no salía.

Fix en el retorno de `chatWithAgent`, no en `ai.ts`: así queda cerrado para todos los
llamadores, presentes y futuros, en vez de depender de que cada ruta se acuerde de filtrar.

## §D. Decisión: exención de la consola de pruebas

`isTest` dispensa del requisito de **tener tenant asignado**, y sólo de eso. Si el agente tiene
tenant, cupo y kill switch se comprueban igual, probando o no: si no fuera así, la consola sería
una vía para seguir atendiendo a un tenant que dejó de pagar —y `deductTokens` le seguiría
cargando el consumo—. Es también el comportamiento previo de `ai.ts`, que llamaba a
`checkClientBalance` con o sin `test`; ampliar la exención habría sido una regresión.

Razonamiento de la exención, explícito para que no se lea como descuido:

1. El flujo de producto es crear → **probar** → asignar tenant → publicar. Un agente recién
   creado no tiene tenant todavía; con gate estricto la consola sería inusable justo cuando
   más se necesita.
2. El operador está autenticado (la consola vive detrás del panel), no es superficie pública.
3. `ChatTester.tsx:185` manda `test: true` en **cada** turno ⇒ el flag es fiable en toda la
   conversación, no sólo al crearla.

Contrapartida asumida y trazada: el consumo de la consola sigue sin descontar cupo. Es coste
de plataforma acotado por ser interno y autenticado. Su control corresponde a **H4** (cuota
de plataforma), donde se decide si la consola consume de una bolsa propia.

## §E. Estrategia de despliegue (dos fases)

| Fase | Contenido | Migración | Reversible |
|---|---|---|---|
| 1 (este change) | Fail-closed en runtime + inventario | **ninguna** | sí, revertir código |
| 2 (posterior) | `Agent.tenantId` → `NOT NULL` | sí | no trivial |

La fase 2 se separa a propósito: una migración `NOT NULL` con filas `NULL` **falla**, y
`Agent.tenantId` es nullable hoy. Primero saneas, luego constriñes. Fase 1 no toca el
esquema ⇒ el rollback es un `git revert`.

**Orden operativo obligatorio:** correr el inventario → asignar tenant a los huérfanos con
tráfico real → desplegar fase 1 → observar 402 en logs → planificar fase 2.

## §F. Estrategia de test

| Test | Qué prueba |
|---|---|
| `assertUsageAllowed` sin tenant | lanza 402 (fail-closed) |
| `assertUsageAllowed` sin tenant + `isTest` | no lanza (exención de consola) |
| `assertUsageAllowed` con tenant + `isTest`, tenant inactivo | **lanza 402**: la exención es acotada (§D) |
| `assertUsageAllowed` con tenant sin cupo | propaga el 402 de `checkClientBalance` |
| `assertUsageAllowed` con tenant y cupo | devuelve el tenantId |
| `chatWithAgent` canal telegram con tenant | **descuenta** aunque el llamador no pase `clientId` (regresión del bug P2) |
| `chatWithAgent` agente huérfano | 402 y **no** llama al LLM (no se gasta antes de cortar) |
| `chatWithAgent` `isTest` sin tenant | responde y no descuenta |
| `chatWithAgent` tenant desactivado | **no** crea `Conversation` (C.6) |
| `POST /api/chat` sin sesión con `test:true` | el flag se ignora, `isTest = false` (C.7) |
| `POST /api/chat` con sesión y `test:true` | el flag se honra |
| `POST /api/chat` con 402 del motor | responde 402, no 500 |
| `channelErrorMessage` | 402 → motivo real; resto → genérico sin filtrar internos |
| respuesta de `chatWithAgent` | **no** expone `meteredTenantId`, y el cobro sí se hace (C.9) |
| `runAutomation` con tenant | descuenta con `operacion: "automation"` (C.8) |
| `runAutomation` sin tenant / 0 tokens | no descuenta |
| `runAutomation` con 402 del gate | queda como `status: "error"` en el `AutomationRun` |
| Suites existentes | siguen verdes con el mock de `token-metering` actualizado |

Ficheros: `tests/metering-fail-closed.test.ts` (16), `tests/metering-chat-route.test.ts` (7) y
`tests/metering-automations.test.ts` (4).

**Aviso sobre el alcance de los mocks:** los 8 suites preexistentes mockean `token-metering`
entero, así que su `assertUsageAllowed` es un pass-through — prueban la **no regresión** del
camino feliz, no el gate. El gate real (con `prisma` mockeado, vía `importOriginal`) sólo se
ejercita en `metering-fail-closed.test.ts`. Quien añada un canal nuevo y copie el mock de un
suite existente **no** estará probando el gate.
