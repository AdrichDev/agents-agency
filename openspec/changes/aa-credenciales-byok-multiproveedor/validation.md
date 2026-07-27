# Validation — `aa-credenciales-byok-multiproveedor`

## Historia de usuario

> Como propietario de la plataforma, quiero poder vender dos modalidades —yo pongo la clave del LLM,
> o el cliente trae la suya— para no tener el margen atado al consumo de tokens de mis clientes, y
> quiero saber en cada llamada quién pagó esos tokens.

Y su contraparte, que es la que decide si el producto es honesto:

> Como cliente que trae su propia clave de OpenAI, quiero que la plataforma **use la mía** y no la
> suya a mis espaldas, que **no me racione** con un cupo que no tiene sentido cuando pago yo, y que
> mi clave **no aparezca nunca** en ninguna pantalla, respuesta ni log después de guardarla.

## Criterios de aceptación

- **AC1** — El modo vive en el **tenant** (`platform` | `byok`), por defecto `platform`. Ningún
  tenant existente cambia de comportamiento al aplicar la migración.
- **AC2** — En `byok`, la llamada al LLM se hace con la clave **del tenant**, resuelta por el
  proveedor del modelo elegido (`gpt*` → OpenAI, `gemini*` → Gemini, `claude*` → Anthropic).
- **AC3** — **Fail-closed**: en `byok` sin credencial válida para ese proveedor, la llamada se
  rechaza con 402 y un motivo distinguible. **No** se usa la clave de la plataforma. Nunca.
- **AC4** — `byok` exime del **cupo** (`tokensUsed` / `tokenBalance`) y **no** exime del kill switch
  de impago (`Tenant.isActive`). Traer tu clave no es dejar de ser cliente.
- **AC5** — En `byok` se registra el consumo en `uso_tokens` y **no** se incrementa
  `Tenant.tokensUsed`.
- **AC6** — `uso_tokens` guarda el modo de cada fila, de forma que el propietario puede separar los
  tokens que pagó él de los que pagó el cliente sin cruzar tablas ni fechas.
- **AC7** — La clave en claro **no sale nunca** de la base de datos hacia una respuesta HTTP, ni
  completa ni truncada, ni aparece en ningún log. Lo que se devuelve es proveedor, últimos 4,
  estado y fecha de verificación.
- **AC8** — Se guarda cifrada con el mismo `enc:v1:` (AES-256-GCM, `CHANNEL_ENCRYPTION_KEY`) que ya
  usan las integraciones OAuth. No hay cifrado nuevo en el repo.
- **AC9** — Guardar una clave la **verifica** sin gastar tokens. Una clave inválida se guarda
  marcada `invalid` con el motivo, y no se sirve con ella.
- **AC10** — "El proveedor rechazó tu clave" y "no puedo descifrar lo que guardé" son estados
  distintos: el primero se resuelve pidiéndole otra clave al cliente, el segundo revisando el
  despliegue.
- **AC11** — Existe el proveedor **Anthropic** y sus modelos son elegibles. Sus entradas de
  capacidades **no** declaran `reasoning_effort`, porque su capa compatible ignora en silencio los
  campos que no entiende y un effort mal enviado no daría error: daría otra respuesta.
- **AC12** — La gobernanza de `reasoning_effort` / `temperature` tiene **una** implementación,
  compartida por el cliente global y por los clientes por tenant.
- **AC13** — `runtime = "openclaw"` ignora el modo y las credenciales: es un gateway local y no hay
  clave de cliente que traer.
- **AC14** — Un agente **sin tenant** es `platform`. La consola de pruebas del operador sigue
  funcionando contra él exactamente como en H1.
- **AC15** — `credentialMode` **no** se filtra en la respuesta pública de `POST /api/chat`, que
  llega al widget alojado en el sitio del cliente.
- **AC16** — **Regresión cero sobre H1 y H3**: el gate fail-closed de saldo, el gate de publicación,
  el cobro contra el tenant de BD y la exención acotada por sesión de operador siguen funcionando
  igual.

## Escenarios (Given-When-Then) — uno por tarea

### T1.4 — la migración no cambia nada (AC1)

```
Dados los tenants actuales de producción
Cuando se aplica la migración
Entonces todos quedan en credentialMode = "platform"
  y la tabla de credenciales queda vacía
  y ninguno cambia de comportamiento respecto a ayer
```

### T2.1 — el routing por proveedor es una función, no un if anidado

```
Dados los ids "gpt-5.4-mini", "gemini-3.5-flash", "claude-opus-5", "algo-raro" y undefined
Cuando se resuelve el proveedor de cada uno
Entonces se obtiene openai, gemini, anthropic
  y para el desconocido y el ausente se obtiene el proveedor por defecto sin lanzar
```

### T2.2 — la gobernanza es una sola y es pura (AC12)

```
Dado un modelo razonador sin function tools
Cuando se gobierna el body
Entonces lleva reasoning_effort

Dado el mismo modelo CON function tools
Cuando se gobierna el body
Entonces NO lleva reasoning_effort
  porque los dos proveedores devuelven 400 con effort+tools

Dado un gpt-4* con temperature
Cuando se gobierna el body
Entonces conserva su temperature y no lleva effort
```

### T2.3 — el cliente por tenant gobierna igual que el global (AC12)

```
Dado el mismo body de chat
Cuando se manda por el cliente global y por un cliente creado con createGovernedClient
Entonces el body que llega al proveedor es el mismo en los dos casos
```

### T2.4 — Anthropic no recibe effort (AC11)

```
Dado un modelo claude*
Cuando se gobierna el body con un reasoning_effort pedido
Entonces el parámetro se elimina
  y la temperature se conserva
  porque Anthropic ignoraría el effort en silencio en vez de rechazarlo
```

### T3.3 — la clave no vuelve nunca (AC7)

```
Dada una clave guardada cuyo valor en claro es conocido
Cuando se leen todas las respuestas de lectura del cliente
Entonces esa cadena no aparece en el cuerpo de ninguna
  y sí aparecen proveedor, últimos 4, estado y fecha
```

### T3.4 — verificar no cuesta tokens (AC9)

```
Dada una clave válida de un proveedor
Cuando se guarda
Entonces queda connected con lastVerifiedAt
  y no se ha consumido ningún token del cliente

Dada una clave inválida
Cuando se guarda
Entonces queda invalid con el motivo del proveedor
  y se ha guardado igual, no se ha descartado lo que el humano tecleó
```

### T4.1 — en byok se usa la clave del cliente (AC2)

```
Dado un tenant en byok con credencial connected de OpenAI
Cuando su agente con modelo gpt* atiende un mensaje
Entonces la llamada sale con la clave del tenant
  y no con la de la plataforma
```

### T4.3 — sin clave no se sirve, y no hay fallback (AC3)

```
Dado un tenant en byok sin credencial para el proveedor del modelo de su agente
Cuando llega un mensaje
Entonces recibe 402 diciendo qué proveedor falta configurar
  y el cliente de la plataforma no se ha usado

Dado el mismo tenant con la credencial en estado invalid
Cuando llega un mensaje
Entonces recibe 402 y tampoco se usa el cliente de la plataforma

Dado el mismo tenant con una credencial que no se puede descifrar
Cuando llega un mensaje
Entonces recibe 402 con un motivo distinto del anterior (AC10)
```

### T4.4 — la caché no se puede quedar obsoleta

```
Dado un tenant en byok que ya ha atendido un mensaje
Cuando el propietario cambia su clave
Y llega un mensaje nuevo
Entonces se usa la clave nueva
  sin que nadie haya llamado a ninguna invalidación explícita
```

### T4.5 — el agente sin tenant sigue siendo de plataforma (AC14)

```
Dado un agente sin tenant asignado
Cuando el operador le escribe desde la consola de pruebas con su sesión
Entonces responde con el cliente de la plataforma
  igual que antes de este change
```

### T5.2 — byok exime del cupo, no del impago (AC4)

```
Dado un tenant en byok con tokensUsed por encima de su tokenBalance
Cuando llega un mensaje
Entonces el agente responde
  porque el cupo raciona el gasto del propietario y aquí no hay gasto del propietario

Dado el mismo tenant en byok con isActive = false
Cuando llega un mensaje
Entonces recibe 402
  porque eso es el impago de la suscripción, y traer tu clave no es dejar de ser cliente
```

### T5.5 — el registro sí, el descuento no (AC5, AC6)

```
Dado un tenant en byok que atiende un mensaje de 1000 tokens
Cuando termina la respuesta
Entonces uso_tokens tiene una fila nueva con modo byok
  y Tenant.tokensUsed no ha cambiado

Dado un tenant en platform en la misma situación
Entonces uso_tokens tiene una fila con modo platform
  y Tenant.tokensUsed ha subido 1000
```

### T5.4 — el modo no se filtra al widget (AC15)

```
Dada una respuesta de POST /api/chat
Cuando se inspecciona su cuerpo
Entonces no contiene credentialMode ni meteredTenantId
```

### T5.6 — las automatizaciones también respetan el modo

```
Dada una automatización de un tenant en byok que consume tokens
Cuando termina
Entonces se registra en uso_tokens con modo byok
  y no se descuenta de un cupo que no le aplica
```

### T6.1 — pasar a byok sin clave avisa, no bloquea

```
Dado un cliente en platform sin ninguna credencial guardada
Cuando el propietario lo cambia a byok
Entonces el cambio se guarda
  y se avisa de que sus agentes no responderán hasta que haya clave
  porque el orden natural es elegir el plan y luego pedirle la clave al cliente
```

### T6.3 — el campo de clave no se rellena de vuelta (AC7)

```
Dado un cliente con una credencial guardada
Cuando se abre su modal
Entonces el campo de clave está vacío y el hint (••••1234) se muestra al lado
  y guardar sin tocar el campo no sobrescribe la clave existente
```

## Verificación final

| Check | Cómo | Resultado medido (27/07/2026) |
|---|---|---|
| V1 typecheck back | `npx tsc --noEmit` **dentro** de `back/` | ✅ EXIT=0, sin salida |
| V2 suite back | `npm test` en `back/`, sin skips nuevos (base tras H3: 111 / 1156 / 3 / 0) | ✅ **116 ficheros / 1249 pasan / 3 skipped / 0 fallos**. Los +93 son los cinco ficheros nuevos (25+26+19+16+6) más una prueba añadida a `metering-automations.test.ts` en V5. Los 3 skipped son los mismos de la base: ninguno nuevo, ninguna prueba borrada ni debilitada |
| V3 front | typecheck + build | ⚠️ **parcial**: `npx tsc --noEmit` EXIT=0. `next build` **no ejecutado** para no escribir en el `.next` del usuario (norma del repo: no lanzar builds en su carpeta) |
| V4 migración | revisión manual: aditiva, sin `DROP`, **sin backfill** | ✅ leída línea a línea: 2 × `ALTER TABLE ADD COLUMN … NOT NULL DEFAULT 'platform'`, 1 × `CREATE TABLE`, 1 × `CREATE UNIQUE INDEX`, 1 × `ADD CONSTRAINT … FOREIGN KEY`. Cero `DROP`, cero `UPDATE`, cero `DELETE`, cero `ALTER COLUMN`. Ninguna sentencia toca una fila existente: las dos columnas nuevas se rellenan por DEFAULT y la tabla nace vacía |
| V5 revisión | `sdd-verify` antes de proponer commit | ✅ ejecutado **inline** (no delegado). Matriz AC↔código abajo. Encontró 1 defecto y 1 hueco de cobertura, los dos arreglados y con prueba |
| V6 post-deploy | `platform` responde igual; `byok` sin clave da 402 con motivo; `byok` con clave responde, `tokensUsed` **no** se mueve y `uso_tokens` **sí** registra | ⛔ no aplicable aún: nada desplegado, migración sin aplicar |

### Lo que las pruebas encontraron y la revisión no

Dos defectos **reales**, no fallos de las propias pruebas. Los dos estaban en código ya escrito y ya
revisado; salieron al escribir la prueba que los cubría.

1. **Fuga de la clave del cliente por `lastError` (AC7 roto).** La primera ejecución de T3.3 falló con
   `expected '{"provider":"openai","keyHint":"9999"…' not to contain 'sk-proj-CLAVE-SECRETA-…'`: OpenAI
   devuelve la clave **dentro del texto de su mensaje de error** (`Incorrect API key provided:
   sk-proj-…`) y yo lo guardaba literal en `lastError`, que es un campo **público**, y además lo
   escribía en los logs de Render. Peor: un comentario del propio fichero afirmaba *"lo que NO se
   registra en el log es la clave"*. Arreglado con `redactSecret()` (sustitución literal de la clave +
   patrón genérico `sk|sk-proj|sk-ant|AIza`), comentario reescrito, y la prueba reforzada con un
   segundo caso en el que el proveedor devuelve la clave con otra forma.
2. **El front marcaba `BLOQUEADO` en rojo a clientes BYOK que funcionan.** `ClientRow` calculaba
   `blocked = !isActive || remaining <= 0` sin mirar el modo, así que un cliente que paga su propio
   LLM aparecía bloqueado al agotar un cupo que no le aplica — y el operador le habría recargado
   tokens para arreglar algo que no estaba roto. Arreglado a `!isActive || (!byok && remaining <= 0)`,
   y la celda de tokens muestra `CLAVE PROPIA / sin cupo` en lugar de una cifra que invitaría a
   leerse como un límite.

Además, al diseñar la prueba de escritura-única se vio que `credentials.ts` se apoyaba **sólo** en el
`select` de Prisma, con cinco `as PublicCredential`. Un cast no filtra campos de sobra: un `include`
añadido más adelante arrastraría la columna sin que nadie escriba `apiKey`. Se añadió `toPublic()`,
proyección explícita campo a campo, como segunda barrera; la prueba mockea la fila **con la clave
dentro**, ignorando el `select`, para que la aserción tenga dientes.

### Cobertura de las pruebas nuevas

| Fichero | Pruebas | Tareas |
|---|---|---|
| `tests/llm-governance.test.ts` | 25 | T2.1 / T2.2 / T2.3 |
| `tests/llm-credentials.test.ts` | 26 | T3.3 / T3.4 / T3.5 |
| `tests/byok-resolver.test.ts` | 17 | T4.3 / T4.4 / T4.5 |
| `tests/byok-metering.test.ts` | 16 | T5.1 / T5.2 / T5.5 |
| `tests/byok-end-to-end.test.ts` | 6 | T4.2 / T5.3 / T5.4 |

Una corrección sobre una aserción **mía**: la prueba de T4.2 exigía al principio **una sola** lectura
del tenant, y falló con `expected "spy" to be called 1 times, but got 2 times`. Las dos lecturas son
deliberadas (el gate temprano de H1/H3 corta antes de crear la `Conversation`; `runAgent` vuelve a
pasar por el gate), así que la aserción medía un **recuento** en lugar de la invariante. Reescrita:
fuerza una discrepancia `platform` → `byok` entre las dos lecturas y comprueba que **el modo con el
que se sirve y el modo con el que se cobra son el mismo**. Eso es lo que importa; el número de
lecturas no.

## V5 — matriz de cumplimiento AC ↔ código

Comprobado sobre el **código**, no sobre los tests (un test verde prueba que el test pasa; la
matriz tiene que apuntar a la línea que cumple el criterio).

| AC | Dónde se cumple | Estado |
|---|---|---|
| AC1 | `migration.sql:30` (`ADD COLUMN … DEFAULT 'platform'`) | ✅ |
| AC2 | `openai.ts:202-204` — `providerForModel(agent.model)` → `getDecryptedApiKey(tenantId, provider)` | ✅ |
| AC3 | `openai.ts:205` — `throw new HttpError(402, …)`; el `return` del cliente global queda **fuera** de esa rama | ✅ |
| AC4 | `token-metering.ts:52` — el cupo se evalúa sólo si `credentialMode !== "byok"`; `isActive` se comprueba aparte y para los dos modos | ✅ |
| AC5 / AC6 | `token-metering.ts:146` (`credentialMode` en el `create`) y `:149` (la rama `byok` no toca `tokensUsed`) | ✅ |
| AC7 | `credentials.ts` — `select` sin `apiKey` + `toPublic()` campo a campo + `redactSecret()` en `lastError` | ✅ |
| AC8 | `credentials.ts` usa `encryptToken`/`decryptToken` de `lib/integrations/oauth`; cero cripto nueva | ✅ |
| AC9 | verificación por `models.list()` (cero tokens); la clave inválida se guarda con `status: "invalid"` | ✅ |
| AC10 | `invalid` y `undecryptable` son estados distintos con mensajes distintos | ✅ |
| AC11 | `model-capabilities.ts:50-52` y `front/lib/models.ts:61-63`: los tres `claude*` con `efforts: []` en **ambos** lados | ✅ |
| AC12 | `governChatBody` tiene **un** solo sitio (`lib/llm/governance.ts:80`) y dos llamadores: `openai.ts:108` (global) y `governance.ts:120` (per-tenant). El `isGeminiModel` booleano ya no existe: sólo queda su mención en un comentario | ✅ |
| AC13 | `openai.ts:190` — la rama `openclaw` retorna **antes** de la de byok | ✅ |
| AC14 | `token-metering.ts:92` — sin tenant y `isTest` ⇒ `{meteredTenantId: null, credentialMode: "platform"}` | ✅ |
| AC15 | `agent/engine.ts:813` — `const { meteredTenantId: _internal, credentialMode: _mode, ...publicReply }` | ✅ |
| AC16 | suite completa verde con los 111 ficheros previos intactos | ✅ |

### Lo que encontró V5

1. **La clave rotada seguía viva en memoria del proceso.** `byokClients` sólo hacía `set`. Al llevar
   `updatedAt` en la clave de caché, rotar una credencial dejaba la entrada anterior *inalcanzable*
   — pero **residente**, y dentro lleva la clave que el cliente acaba de revocar. Revocar no la
   sacaba de memoria hasta el siguiente despliegue, y el `Map` crecía una entrada por rotación sin
   techo. Arreglado purgando el prefijo `${tenantId}:${provider}:` antes de insertar
   (`openai.ts:207-217`), con dos pruebas: la instancia vieja no se devuelve al volver a presentar
   la credencial antigua, y la purga **no** tira los clientes de otros tenants.
2. **T5.6 estaba marcado sin prueba propia.** El código sí propaga el modo
   (`automations/engine.ts:133`), pero los fixtures de `metering-automations.test.ts` sólo usaban
   `credentialMode: "platform"`, así que el escenario de T5.6 —una automatización de un tenant byok
   no descuenta de un cupo que no le aplica— no estaba cubierto por nada. Bajo la regla del repo eso
   no es DONE. Añadida la prueba que exige `deductTokens(…, "automation", "byok")`.

### Desviación consciente respecto al harness

No hay `specs/[módulo]/spec.md` en esta carpeta. La convención de facto del repo es dejar los AC y
los Given-When-Then en `validation.md`: sólo 7 de los 51 changes de `openspec/changes` tienen carpeta
`specs/`, y **ninguno** de los hermanos de este eje (H1, H3, H4) la tiene. Se sigue el patrón de los
hermanos en lugar de inventar una estructura distinta para un change del mismo eje.

## Gates humanos (no automatizables)

**T1.5 — aplicar la migración en producción.** Va **después** del gate T1.3 de H3, en el mismo
despliegue que T2/T4/T5, y no se marca sin visto bueno explícito del propietario.

**Smoke de credenciales reales (T3.4).** Verificar `models.list()` contra los tres proveedores
exige claves reales de los tres. Es un gate humano porque nadie más que el propietario las tiene, y
porque el resultado decide si algún proveedor necesita el fallback a completion mínima.

**Cambiar un cliente a `byok`.** Es una acción manual, cliente a cliente, con la clave del cliente
en la mano. Ningún tenant se mueve de `platform` en el despliegue.

**Fuera de este change, pero condicionado por él:** H4/T4 necesita **dos precios**, uno por modo.
La cifra en € sigue siendo decisión del propietario y sigue siendo el bloqueo de H4.

## Lo que este documento NO promete

- Que los embeddings y la ingesta de conocimiento se carguen al cliente en `byok`. **No.** Siguen
  siendo coste de plataforma en los dos modos, por el motivo de `design.md §H`.
- Que se pueda pedir pensamiento extendido a Claude. **No.** Los `claude*` se declaran sin efforts
  a propósito (AC11).
- Que las claves roten o caduquen. **No.** Deuda anotada.
- Que el cliente pueda introducir su clave por sí mismo. **No.** En la v1 la introduce el
  propietario desde `/clientes`; el autoservicio es H5.
