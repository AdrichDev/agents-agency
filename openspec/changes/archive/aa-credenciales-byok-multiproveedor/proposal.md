# Proposal — `aa-credenciales-byok-multiproveedor`

Hijo H2 del eje `aa-agentes-entrega-monetizacion`. **Nivel 4**: migración sobre datos de
producción, back + front, toca la capa LLM y el metering, y **guarda credenciales de terceros
en reposo**.

## Intención

Que un cliente pueda traer su propia clave de LLM (**BYOK**) en vez de consumir la cuenta del
propietario, y que la plataforma sepa en cada llamada **quién paga los tokens**.

Los dos modos tienen que existir a la vez y ser elegibles, porque son dos productos:

- **`platform`** (lo de hoy): la plataforma pone la clave, asume el coste del LLM y lo repercute
  en la suscripción. El cupo (`Tenant.tokenBalance`) es el guardarraíl que impide que un cliente
  se coma el margen.
- **`byok`**: el cliente pone su clave de OpenAI / Gemini / **Anthropic**, paga su consumo
  directamente al proveedor, y la plataforma le cobra sólo el servicio. El cupo deja de tener
  sentido —no hay nada que racionar— pero el resto de la relación comercial sigue igual.

## El problema, con la línea de código

`back/src/lib/openai.ts:16-22`:

```ts
const openaiRaw = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const geminiRaw = hasGemini ? new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: GEMINI_BASE_URL }) : null;
export const openai = (openaiRaw ?? geminiRaw)!;
```

Dos singletons de módulo construidos con **variables de entorno del proceso**. No hay ningún
punto del código en el que la clave dependa de quién está hablando. Consecuencias concretas:

1. **No se puede vender BYOK.** Es una opción comercial que hoy no tiene dónde apoyarse: la
   clave la elige el `process.env`, no el tenant.
2. **Todo consumo de cliente se carga contra la cuenta del propietario.** Sin BYOK, cada mensaje
   que atiende un agente vendido es coste variable del propietario. Es sostenible porque 1M de
   tokens cuesta menos de 2 $ (`aa-planes-y-cuotas/design.md §C.4`), pero es el techo del margen
   y no hay alternativa.
3. **`uso_tokens` no distingue quién pagó.** `deductTokens` (`token-metering.ts:97-119`) escribe
   la misma fila para todo consumo. En cuanto exista BYOK, el propietario no podrá responder
   "¿cuánto me costó a mí el mes pasado?" mirando su propia tabla de consumo: la respuesta
   estaría mezclada con tokens que pagó otro.
4. **Anthropic no existe en la plataforma.** El routing por proveedor es un `startsWith("gemini")`
   (`openai.ts:25-27`) y la tabla de capacidades (`model-capabilities.ts`) no tiene ninguna
   entrada `claude*`. El cliente que quiera traer su clave de Anthropic —el caso que pidió el
   propietario— no tiene modelo que elegir.

## Lo que este change añade

- **`Tenant.credentialMode`**: `platform` | `byok`. Por tenant, no por agente (`design.md §A`).
- **Almacén de claves por tenant y proveedor**, cifrado con el `encryptToken()` que ya usan las
  integraciones OAuth (`oauth.ts:52`, AES-256-GCM con `CHANNEL_ENCRYPTION_KEY`) y **de sólo
  escritura**: nunca se devuelve en una lectura, nunca se registra en un log. Lo que la API
  devuelve es una huella (proveedor, últimos 4, estado, fecha de verificación).
- **Extracción del choke point de `chat.completions` a una factoría reutilizable**
  (`design.md §C`). Es el nudo técnico del change: la gobernanza de `reasoning_effort` /
  `temperature` está hoy parcheada **sobre el singleton global** (`openai.ts:72-97`), y los
  clientes por-tenant de BYOK necesitan exactamente la misma gobernanza. Duplicarla es garantizar
  que un día divergen y un cliente que paga recibe un 400 del proveedor.
- **Proveedor Anthropic** por su capa OpenAI-compatible (`https://api.anthropic.com/v1/`,
  verificado en la doc oficial vía Context7), replicando el patrón de Gemini, más las entradas
  `claude*` en la tabla de capacidades y en `front/lib/models.ts` (que declara en su cabecera que
  hay que mantener las dos en sincronía).
- **Metering ramificado**: en `byok` se **registra** el consumo en `uso_tokens` pero **no** se
  descuenta cupo ni se corta por saldo. Lo que **no** cambia: el kill switch de impago
  (`Tenant.isActive`) sigue aplicando igual. Un cliente que trae su clave sigue pagando la
  suscripción; si deja de pagarla, su agente calla.
- **Fail-closed en el modo `byok`**: sin credencial válida para el proveedor del modelo elegido,
  **402**. Nunca se cae hacia la clave de la plataforma. Es la lección de H1 aplicada al revés:
  un fallback silencioso convertiría el plan barato en "gasta el dinero del propietario".

## Fuera de alcance

- **Embeddings y usos no-chat del cliente global** (ingesta de conocimiento, estudios de
  mercado con `STRONG_MODEL`). Siguen siendo coste de plataforma en los dos modos. Motivo: se
  ejecutan desde el panel del propietario en el momento de la ingesta, no por mensaje de usuario
  final, y atribuirlos por tenant exige un choke point propio que no existe. Declarado, no
  ignorado (`design.md §H`).
- **El precio** de cada modo (H4/T4). Aquí se crea el hecho que H4 tarificará.
- **Stripe** (H6) y **portal de cliente** (H5). En la v1 las claves las introduce el propietario
  desde el panel de administración, no el cliente por sí mismo.
- **`runtime = "openclaw"`**: no admite BYOK y no lo necesita (gateway local, sin clave de
  cliente). El modo se ignora para esos agentes y se documenta.
- Fase 2 de H1 (`Agent.tenantId` → `NOT NULL`).

## Riesgos

- **Secretos de terceros en reposo.** Es el riesgo grave del change y no tiene mitigación
  perfecta, sólo disciplina: cifrado con la clave existente, columna nunca seleccionada en las
  lecturas de la API, prohibición explícita de log, y una prueba que falla si la clave en claro
  aparece en una respuesta HTTP. La superficie no es nueva —`Integration.accessToken` ya guarda
  tokens OAuth de Google/Slack/Notion con el mismo cifrado— pero una clave de API de LLM no
  caduca ni tiene refresh, así que una fuga vale más tiempo.
- **Si `CHANNEL_ENCRYPTION_KEY` cambia o se pierde, las claves guardadas son ilegibles.** Ya es
  cierto para las integraciones OAuth; con BYOK el síntoma es peor (el agente de un cliente que
  paga deja de responder en vez de pedir reconexión). Se mitiga con un estado
  `invalid` en la credencial y un mensaje que distingue "clave rechazada por el proveedor" de
  "no se pudo descifrar".
- **Divergencia entre la tabla de capacidades y el proveedor real.** Anthropic ignora en
  silencio los campos que no entiende en su capa compatible (doc oficial), así que un
  `reasoning_effort` mal enviado **no** dará error: dará un resultado distinto del pedido sin
  avisar. Por eso las entradas `claude*` se declaran sin efforts y la gobernanza lo borra, en vez
  de confiar en que el proveedor proteste.
- **Cambio de firma de `assertUsageAllowed`** (`token-metering.ts:67`): pasa a devolver también
  el modo. Son 2 call sites (`engine.ts:544` y `engine.ts:648`) y el compilador los señala, pero
  toca el gate que H1 acaba de cerrar. **AC de regresión cero sobre H1** obligatorio.
- **Coste por mensaje**: el modo `byok` añade una lectura de credencial por llamada. Se acepta
  con el mismo criterio ya escrito en `engine.ts:638` ("el coste es una lectura por PK,
  despreciable frente a una llamada LLM") y se evita la construcción repetida de clientes con una
  caché invalidada por `updatedAt` (`design.md §C.4`).

## Dependencias

- **Depende de H1** (`aa-metering-fail-closed`): ramifica su gate y su `deductTokens`.
  Commiteado (`f84c89d`), sin push.
- **Depende de H3** (`aa-agente-ciclo-vida-publicacion`) sólo en el orden de despliegue: las dos
  tocan `engine.ts` en el mismo cuello. Commiteado (`80d33f3`), migración **sin aplicar** (T1.3).
- **Alimenta H4** (`aa-planes-y-cuotas`): el precio por agente activo depende del modo, porque en
  `byok` el propietario no paga tokens. H4 no puede fijar dos precios si no existe el modo.
- **Arte previo en el otro repo**: `creador_CRM` diseñó un panel de claves por tenant con el mismo
  patrón (almacén cifrado único, guardar+probar por clave). Sigue sin implementar allí, pero la
  forma del panel se reutiliza en vez de inventarla.
- Ficheros previstos: `back/prisma/schema.prisma` (+ migración), `back/src/lib/openai.ts`,
  `back/src/lib/model-capabilities.ts`, `back/src/lib/llm/credentials.ts` (nuevo),
  `back/src/lib/token-metering.ts`, `back/src/lib/agent/engine.ts`,
  `back/src/lib/automations/engine.ts`, `back/src/routes/clients.ts` (montado en `/api/clients`,
  `index.ts:243`), `front/lib/models.ts`, y el panel de credenciales en `front/components/clientes/`
  (la pantalla es `/clientes`, no `/clients` — corrección heredada de H3/T5.2).
