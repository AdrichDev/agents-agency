# Design — `aa-credenciales-byok-multiproveedor`

## §A — ¿Dónde vive el modo? En el tenant, no en el agente

**Decisión: `Tenant.credentialMode`.**

BYOK es un **acuerdo comercial con el cliente**, no una propiedad de un asistente. Ponerlo por
agente rompe dos cosas:

1. **La factura de H4.** El cobro es por agente activo (`aa-cobro-por-agente-activo`), y el precio
   depende del modo, porque en `byok` el propietario no paga tokens. Con el modo por agente, un
   mismo tenant tendría líneas de factura de dos precios distintos y el cliente no sabría por qué.
2. **El cupo.** `Tenant.tokenBalance` / `tokensUsed` son del tenant. Con modo por agente, un tenant
   en `platform` podría pasar su agente más caro a `byok` para dejar de consumir cupo y seguir
   gastando el resto — o al contrario, el propietario tendría que llevar dos contabilidades sobre
   el mismo saldo. El estado y la unidad que lo consume tienen que estar al mismo nivel.

Corolario que hay que respetar: **un agente sin tenant es siempre `platform`.** No hay a quién
preguntarle el modo. Eso sólo ocurre en la consola de pruebas del operador (H1: `isTest` exime del
requisito de tener tenant), y su coste es de plataforma por definición.

`runtime = "openclaw"` **ignora el modo**: el gateway es local, no hay clave de cliente que traer.
Se decide antes de mirar credenciales, en la misma rama que ya existe hoy
(`openai.ts:146`).

## §B — Almacén de credenciales: copiar `Integration`, no inventar

**Modelo nuevo `TenantLlmCredential`**, calcado del `Integration` que ya funciona:

```prisma
model TenantLlmCredential {
  id             String    @id @default(cuid())
  tenant         Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  tenantId       String    @map("tenant_id")
  provider       String    @map("proveedor")     // openai | gemini | anthropic
  apiKey         String    @map("api_key")       // cifrado enc:v1:<base64> — NUNCA en claro
  keyHint        String    @map("pista_clave")   // últimos 4 caracteres, para que el humano
                                                 // reconozca la clave sin poder usarla
  status         String    @default("connected") @map("estado") // connected | invalid | undecryptable
  lastVerifiedAt DateTime? @map("verificado_en")
  lastError      String?   @map("ultimo_error")  // motivo del rechazo del proveedor
  createdAt      DateTime  @default(now()) @map("creado_en")
  updatedAt      DateTime  @updatedAt @map("actualizado_en")

  @@unique([tenantId, provider])
  @@map("credencial_llm_tenant")
}
```

Por qué así y no de otra forma:

- **`@@unique([tenantId, provider])`**, igual que `@@unique([agentId, provider])` en `Integration`.
  Una clave por proveedor y tenant. Varias claves del mismo proveedor es una función de rotación
  que nadie ha pedido y que multiplica los estados por dos.
- **Cifrado con `encryptToken()` / `decryptToken()`** de `back/src/lib/integrations/oauth.ts:52`
  (prefijo `enc:v1:`, AES-256-GCM sobre `@/lib/crypto` con `CHANNEL_ENCRYPTION_KEY`). No se
  escribe un cifrado nuevo: el que hay está en producción guardando tokens OAuth de Google, Slack,
  Notion y Jira.
- **`keyHint` es un campo, no un cálculo sobre el cifrado.** Se guarda en el `create` porque el
  claro sólo existe en ese instante. Calcularlo al leer exigiría descifrar para pintar una lista.
- **`status = "undecryptable"`** existe a propósito, separado de `invalid`: "el proveedor rechazó
  tu clave" y "no puedo leer lo que guardé" son dos incidentes con dos soluciones distintas
  (volver a pedirla al cliente vs. revisar `CHANNEL_ENCRYPTION_KEY` en el despliegue). Fundirlos
  haría que un error de configuración del propietario se le presentara al cliente como culpa suya.

### §B.1 — Sólo escritura: la regla y cómo se hace cumplir

`apiKey` **no sale nunca** de la base de datos hacia fuera. En concreto:

- Ningún handler de `routes/clients.ts` incluye `apiKey` en un `select`. Las lecturas usan un
  `select` **explícito** con `{ provider, keyHint, status, lastVerifiedAt, lastError }`. No se
  usa `include: { llmCredentials: true }` en ninguna parte, porque un `include` trae la columna y
  el leak se produce sin que nadie escriba la palabra `apiKey`.
- El único punto que llama a `decryptToken` es el resolutor de cliente LLM (`§C.3`), en el back.
- **No hay log de la clave, ni truncada.** Los errores registran `{ tenantId, provider, status }`.
- **Prueba que lo sostiene**: se guarda una clave conocida y se afirma que la cadena en claro
  **no** aparece en el cuerpo de ninguna de las respuestas de lectura del tenant. Una aserción
  sobre "no está en el JSON" es la que sobrevive a un `include` añadido por descuido dentro de
  seis meses; una aserción sobre "el campo se llama keyHint" no.

## §C — El nudo: la gobernanza de `chat.completions` está parcheada sobre un singleton

Esto es lo que hace que el change sea nivel 4 y no un CRUD.

### §C.1 — Qué hay hoy

`back/src/lib/openai.ts:72-97` sobrescribe `openai.chat.completions.create` **una vez, al cargar
el módulo**, y ese wrapper hace **dos** trabajos distintos:

1. **Routing por proveedor**: mira el prefijo del `model` y despacha al `create` RAW de OpenAI o
   al de Gemini (enlazados antes de sobrescribir, para no recursar).
2. **Gobernanza de parámetros**: inyecta / borra `reasoning_effort` según
   `MODEL_CAPABILITIES` (sólo si el modelo lo soporta y sólo sin function tools, porque los dos
   proveedores devuelven 400 con effort+tools) y borra `temperature` en modelos razonadores.

BYOK necesita **el trabajo 2 idéntico** sobre un cliente que no es ese singleton. Y necesita el
trabajo 1 **antes** y en otro sitio: para saber qué credencial del tenant buscar hay que resolver
el proveedor a partir del modelo *antes* de construir el cliente.

### §C.2 — Decisión: partir el wrapper en dos piezas puras y reutilizarlas

```
providerForModel(model): "openai" | "gemini" | "anthropic"
    ↑ única fuente del routing por prefijo. Hoy es `isGeminiModel()` (openai.ts:25),
      un booleano que no puede crecer a tres proveedores sin volverse un if anidado.

governChatBody(body): body
    ↑ la lógica de reasoning_effort / temperature, SIN cliente y SIN red. Función pura,
      testeable por tabla de entradas y salidas, que es como hay que probar una regla
      que hoy sólo se puede observar mirando qué llega al proveedor.

createGovernedClient({ provider, apiKey }): OpenAI
    ↑ construye una instancia OpenAI-compatible para ese proveedor y envuelve su
      `chat.completions.create` con `governChatBody`.
```

Y el parche global de `openai.ts` **pasa a llamar a `governChatBody`** en vez de tener su copia.
Una sola implementación, dos caminos de llamada.

**Lo que NO se hace: reescribir el cliente global.** Los dos singletons RAW, el `export const
openai`, el routing entre ellos y el guard de "sin ninguna key no hay nada que parchear" se quedan
como están. H2 no es "refactorizar la capa LLM": es añadir un camino nuevo reutilizando la regla.
Cambiar el camino que hoy atiende producción para que el nuevo quede más bonito es cómo se rompe
lo que funciona.

**El motivo de no duplicar, dicho claro**: si `governChatBody` viviera dos veces, el día que se
añada un modelo con reglas propias se actualizaría una copia. El síntoma no sería un test rojo;
sería un 400 del proveedor **sólo para los clientes en BYOK**, es decir, sólo para los que pagan
por traer su clave. Un fallo que se manifiesta únicamente en el camino menos recorrido es el peor
de los dos.

### §C.3 — `getClientForAgent` pasa a `async`

Firma actual (`openai.ts:145`):

```ts
export function getClientForAgent(agent: AgentRuntimeSelector): AgentClientResolution
```

Pasa a:

```ts
export async function getClientForAgent(agent: {
  runtime?: string | null;
  agentId?: string;
  model?: string;          // NUEVO: decide el proveedor, y por tanto qué credencial buscar
  tenantId?: string | null;// NUEVO
  credentialMode?: string; // NUEVO: "platform" | "byok"; ausente ⇒ platform
}): Promise<AgentClientResolution>
```

Orden de resolución, y el orden importa:

1. `runtime === "openclaw"` → como hoy. No mira modo ni credenciales.
2. `credentialMode !== "byok"` (o sin tenant) → cliente global, comportamiento idéntico a hoy.
3. `byok` → `provider = providerForModel(model)`; se lee `TenantLlmCredential` de ese tenant y
   proveedor; se descifra; `createGovernedClient({ provider, apiKey })`.
4. `byok` **sin credencial** para ese proveedor, o con `status` distinto de `connected`, o si el
   descifrado falla → **`HttpError(402)`** con el motivo. **No se cae al cliente de plataforma.**

El punto 4 es el corazón del change y es la lección de H1 con el signo cambiado: allí lo peligroso
era servir a quien no era cobrable; aquí lo peligroso es **cobrar el LLM a quien no toca**. Un
fallback silencioso al cliente global convertiría el plan BYOK —más barato porque el cliente
asume el coste del LLM— en el plan en el que el cliente paga menos y el propietario paga los
tokens. Fail-closed, con mensaje distinguible: "falta configurar la clave de <proveedor>".

**Call site único**: `engine.ts:439`, dentro de `runToolLoop`. Que sea uno solo es lo que hace
esta parte baratísima; el `await` no añade concurrencia nueva porque la función ya vivía dentro de
un `async`. `ToolLoopParams` gana `tenantId` y `credentialMode`, que `runAgent` ya tiene resueltos.

### §C.4 — Caché de clientes, no de credenciales

Se lee la credencial **en cada mensaje**. Se acepta con el criterio que ya está escrito en
`engine.ts:638`: una lectura por índice único al lado de una llamada LLM es ruido.

Lo que sí se cachea es la **instancia** `OpenAI`, en un `Map` de módulo con clave
`${tenantId}:${provider}:${updatedAt.getTime()}`. Meter `updatedAt` en la clave es lo que hace que
la caché no pueda quedarse obsoleta: cambiar la clave cambia `updatedAt`, y con él la entrada. Sin
ese componente habría que acordarse de invalidar en el handler que actualiza — y ese "acordarse"
es exactamente lo que falla.

No se cachea el **claro** de la clave fuera de la instancia del SDK: menos sitios donde vive un
secreto, menos sitios que auditar.

## §D — Anthropic por la capa OpenAI-compatible

Verificado en la doc oficial (Context7, `platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk`):

- **Base URL**: `https://api.anthropic.com/v1/`. Mismo patrón que Gemini (`openai.ts:11`): una
  instancia `OpenAI` con `baseURL` y la key del proveedor.
- `chat.completions.create` soportado con `model` = id de modelo Claude.
- **Los campos que no entiende se ignoran en silencio**, no dan error. `n` debe ser 1;
  `logprobs` y `metadata` se ignoran. El pensamiento extendido va por `extra_body.thinking`, no
  por `reasoning_effort`.
- Audio de entrada y prompt caching no están soportados por esta vía. Ninguno se usa aquí.

**Decisión sobre capacidades**: las entradas `claude*` de `MODEL_CAPABILITIES` se declaran
**sin efforts** (`efforts: []`, `defaultEffort: null`), igual que los `gpt-4*`. Consecuencia:
`modelSupportsEffort("claude-…") === false`, la gobernanza **borra** `reasoning_effort` y
**conserva** `temperature` (que Claude sí admite).

Y el motivo de declararlo así en vez de mapear effort → `thinking.budget_tokens`: porque el
silencio del proveedor es una trampa. Con Gemini y OpenAI, mandar un parámetro que no toca da 400
y el fallo se ve en el primer intento. Con Anthropic el mismo error **no se ve nunca**: la
respuesta llega, es plausible, y no es la que se pidió. Mapear effort a `thinking` es una función
nueva con un modo de fallo invisible; se deja fuera y se anota, no se cuela dentro de un change de
credenciales.

**Ids de modelo**: se declaran los de la familia Claude 5 (`claude-opus-5`, `claude-sonnet-5`) más
`claude-haiku-4-5-20251001`. `back/src/lib/model-capabilities.ts` y `front/lib/models.ts` se
actualizan **en el mismo commit**, porque la cabecera de los dos ficheros dice "MANTENER EN
SINCRONÍA" y esa nota sólo vale si alguien la cumple.

**`ANTHROPIC_API_KEY`** se añade como env opcional para el modo `platform`. Ausente ⇒ los modelos
`claude*` no son elegibles en `platform`, y en `byok` dependen de la credencial del tenant. Igual
que hoy con `GEMINI_API_KEY` (`openai.ts:10`).

## §E — Metering ramificado: qué cambia y qué no

### §E.1 — El gate

`assertUsageAllowed` (`token-metering.ts:67`) pasa a devolver el modo junto con el tenant:

```ts
// antes: Promise<string | null>
export async function assertUsageAllowed(
  tenantId: string | null | undefined,
  opts: { isTest?: boolean } = {}
): Promise<{ meteredTenantId: string | null; credentialMode: "platform" | "byok" }>
```

`checkClientBalance` ya hace un `findUnique` con `select: { isActive, tokenBalance, tokensUsed }`
(`token-metering.ts:33-36`); se le añade `credentialMode` **al mismo select**. Cero consultas
extra. Y su lógica se ramifica en un solo punto:

| Comprobación | `platform` | `byok` | Por qué |
|---|---|---|---|
| Tenant no existe → 402 | sí | sí | Cliente borrado = desactivado, no se distingue hacia fuera |
| `isActive === false` → 402 | sí | **sí** | Es el kill switch de **impago de la suscripción**. Traer tu clave no es dejar de ser cliente |
| `tokensUsed >= tokenBalance` → 402 | sí | **no** | El cupo raciona el gasto del propietario. En BYOK no hay gasto del propietario que racionar; cortar ahí sería cobrar dos veces la misma restricción |
| Sin tenant y sin `isTest` → 402 | sí | sí | H1 intacto |

La fila que importa es la segunda. **`byok` exime del cupo, nunca del `isActive`.** Si eximiera de
los dos, el modo BYOK sería la forma de seguir siendo atendido sin pagar la suscripción — y el
kill switch de la plataforma dejaría de apagar a la mitad de los clientes.

### §E.2 — El registro

`deductTokens` (`token-metering.ts:97`) hoy hace un `$transaction` de dos escrituras: incrementar
`Tenant.tokensUsed` y crear la fila en `uso_tokens`. En `byok` se hace **sólo la segunda**.

Y `TokenUsage` gana `credentialMode String @default("platform")`, porque sin esa columna el
propietario no puede separar en su propia tabla de consumo los tokens que pagó él de los que pagó
el cliente. Es el mismo error que H4/T1 arregló en `isActive`: **dos hechos distintos en un solo
sitio**, y la factura sale mal por exceso.

Firma: se añade un parámetro `credentialMode` en vez de un booleano `countsAgainstQuota`. El
booleano describe la consecuencia; el modo describe el hecho. Guardar la consecuencia y no el
hecho es lo que impide reconstruir la factura cuando la regla cambie.

### §E.3 — El otro call site

`back/src/lib/automations/engine.ts:123` también llama a `deductTokens`. Sin tocarlo, el consumo
de las automatizaciones de un tenant en `byok` se descontaría de un cupo que no aplica. Entra en
el change: no es un extra, es el mismo hecho por otra puerta. Es la misma clase de agujero que H1
encontró con los webhooks de Telegram y WhatsApp, que nunca pasaban el `clientId`.

## §F — Verificación de una clave

Guardar una clave sin comprobarla es guardar una promesa. El panel tiene **Guardar** y **Probar**,
y el guardado hace la comprobación:

- **Cómo**: `client.models.list()` contra el proveedor. Cuesta **cero tokens** y demuestra lo
  único que hay que demostrar (que la clave autentica). Una completion mínima gastaría dinero del
  cliente para responder a una pregunta de autenticación, y `max_tokens: 1` además revienta en
  modelos razonadores.
- **Riesgo asumido y verificable**: hay que comprobar que las tres capas compatibles exponen
  `GET /v1/models`. OpenAI sí; Gemini sí (`/v1beta/openai/models`); Anthropic lo tiene en su API
  y la base URL compatible es `/v1/`. Si alguna no lo expusiera, el fallback es una completion
  mínima **sólo para ese proveedor** — decisión que se toma con el resultado del smoke de T3.4, no
  antes.
- **Resultado**: `status = connected` + `lastVerifiedAt`, o `status = invalid` + `lastError` con
  el mensaje del proveedor tal cual (es información del cliente sobre su propia clave, no un
  interno de la plataforma).
- **Al guardar una clave inválida se guarda igual, marcada `invalid`.** Rechazar el guardado
  perdería lo que el humano acaba de teclear por un fallo que puede ser de red. Lo que **no** se
  hace es servir con ella: `§C.3` punto 4 corta por `status !== "connected"`.

## §G — Front

Mínimo y en el sitio donde ya se administra al cliente (`/clientes`, `ClientModal`):

- **Selector de modo**: `Plataforma` / `Clave propia (BYOK)`. Cambiar a BYOK sin ninguna
  credencial `connected` **avisa** de que los agentes de ese cliente dejarán de responder hasta
  que haya clave. Avisa, no bloquea: el orden natural del humano es elegir el plan y luego pedirle
  la clave al cliente.
- **Tres filas de credencial** (OpenAI / Gemini / Anthropic), cada una con campo de clave
  (`type="password"`, `autoComplete="new-password"`, siguiendo la convención del repo), botón
  Guardar+Probar, y estado: `••••1234 · verificada 27/07` o el error.
- **La clave nunca se rellena de vuelta** al abrir el modal. El campo aparece vacío con el hint al
  lado. Un campo prerellenado con puntos invita a "guardar sin tocar" y a que el front mande los
  puntos como clave nueva.
- `front/lib/models.ts` gana el bloque `anthropic`, y el selector de modelo del agente lo muestra.

**Lo que el front no hace**: decidir si un modelo es elegible. El back es quien sabe si hay
credencial para el proveedor de ese modelo; duplicar esa regla en el front la haría divergir, igual
que H3 resolvió con `publishPreconditions` calculado en el back.

## §H — Fuera de alcance, dicho con el motivo

- **Embeddings e ingesta de conocimiento** siguen usando el cliente global en los dos modos. Se
  ejecutan cuando el propietario sube documentación, no por mensaje de usuario final; el coste es
  pequeño y atribuirlo por tenant exige un choke point que hoy no existe. Anotado como deuda.
- **Estudios de mercado** (`STRONG_MODEL`): herramienta interna del propietario. No es consumo de
  cliente y no debe mirar el modo.
- **Mapear effort → `thinking.budget_tokens` en Anthropic** (`§D`).
- **Rotación y caducidad de claves**: fuera. Anotado, y es el mismo tipo de deuda que ya está
  registrada en el CRM con las `TenantApiKey` que se mintean sin revocar.

## §I — Orden de despliegue

1. **T1 (migración) + T2 (capa LLM) + T4 (resolutor) + T5 (metering) van en el mismo despliegue.**
   La migración sola es inocua (`credentialMode` con default `platform`, tabla nueva vacía,
   columna nueva en `uso_tokens` con default), pero el resto sin la migración no compila contra la
   base.
2. **Y ese despliegue va después del de H3** (T1.3 de H3 sigue pendiente de gate humano). Las dos
   tocan `runToolLoop` y `runAgent`; apilar dos migraciones sin aplicar sobre el mismo cuello
   duplica el riesgo del gate en vez de sumarlo.
3. **Ningún tenant se pasa a `byok` en el despliegue.** Todos quedan en `platform` por el default
   de columna, que es exactamente lo que hacen hoy. El cambio de modo es una acción manual por
   cliente, después. Igual que en H3: el backfill que no cambia nada es el backfill correcto.
