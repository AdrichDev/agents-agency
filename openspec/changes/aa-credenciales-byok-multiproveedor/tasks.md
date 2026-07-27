# Tasks — `aa-credenciales-byok-multiproveedor`

Orden crítico: **T2 antes de T4** (el resolutor necesita la factoría), **T1 antes de todo lo que
toca la BD**, y **T5 después de T4** (el metering necesita saber el modo que el resolutor consume).
Regla del repo: una tarea está hecha cuando su prueba está verde, no cuando el código existe.

---

## T1 — Esquema

- [x] **T1.1** — `Tenant.credentialMode String @default("platform") @map("modo_credencial")`, con
      el comentario que explica los dos modos y por qué vive en el tenant y no en el agente
      (`design.md §A`). Enum de Prisma **no**: el repo usa `String` + comentario + validación Zod
      en el borde para `runtime`, `channel`, `reasoningEffort` y `Agent.status`; un enum nativo
      obliga a migrar el tipo en Postgres por cada valor nuevo.
- [x] **T1.2** — Modelo `TenantLlmCredential` según `design.md §B`, con
      `@@unique([tenantId, provider])`, `onDelete: Cascade` desde `Tenant`, y `@@map("credencial_llm_tenant")`.
- [x] **T1.3** — `TokenUsage.credentialMode String @default("platform") @map("modo_credencial")`.
      Sin esta columna el propietario no puede separar en `uso_tokens` los tokens que pagó él de
      los que pagó el cliente (`design.md §E.2`).
- [x] **T1.4** — Migración **aditiva** escrita, revisada y **no aplicada**. Sin `DROP`, sin
      `UPDATE` de backfill: todos los tenants se quedan en `platform`, que es lo que hacen hoy.
- [ ] **T1.5 — GATE HUMANO** — `prisma migrate deploy` en producción. Va **después** del gate T1.3
      de H3 y en el mismo despliegue que T2, T4 y T5 (`design.md §I`). No se marca sin el visto
      bueno explícito del propietario.

## T2 — Capa LLM: partir el wrapper y añadir Anthropic

- [x] **T2.1** — Extraer `providerForModel(model): "openai" | "gemini" | "anthropic"` como **única**
      fuente del routing por prefijo, sustituyendo `isGeminiModel()` (`openai.ts:25-27`).
      Test: tabla de ids → proveedor, incluido el caso `undefined` y un id desconocido.
- [x] **T2.2** — Extraer `governChatBody(body)` **pura** (sin cliente, sin red) con la lógica de
      `reasoning_effort` / `temperature` que hoy vive dentro del parche (`openai.ts:79-95`), y
      hacer que **el parche global la llame** en vez de tener su copia (`design.md §C.2`).
      Test de tabla: modelo razonador sin tools ⇒ lleva effort; **con** tools ⇒ no lo lleva;
      `gpt-4*` ⇒ nunca; razonador con `temperature` ⇒ se borra; `gpt-4*` con `temperature` ⇒ se
      conserva.
- [x] **T2.3** — `createGovernedClient({ provider, apiKey })`: instancia `OpenAI` con el `baseURL`
      del proveedor y su `chat.completions.create` envuelto con `governChatBody`. Anthropic:
      `https://api.anthropic.com/v1/` (verificado en la doc oficial, `design.md §D`).
      Test: el cliente que devuelve aplica la misma gobernanza que el global sobre el mismo body.
- [x] **T2.4** — Entradas `claude*` en `MODEL_CAPABILITIES` (`back/src/lib/model-capabilities.ts`)
      **sin efforts**, y `KNOWN_MODEL_IDS` al día. Motivo en `design.md §D`: Anthropic ignora en
      silencio los campos que no entiende, así que un effort mal enviado no da error — da otra
      respuesta. Se le quita, no se confía en que el proveedor proteste.
- [x] **T2.5** — Bloque `anthropic` en `front/lib/models.ts`, **en el mismo commit** que T2.4. Las
      cabeceras de los dos ficheros dicen "MANTENER EN SINCRONÍA" y esa nota sólo vale si se cumple.
- [~] **T2.6** — `ANTHROPIC_API_KEY` como env **opcional** del modo `platform`, con el mismo patrón
      de `hasGemini` (`openai.ts:10`): ausente ⇒ los `claude*` no son elegibles en `platform`.
      Documentar en `.env.example`.

## T3 — Almacén de credenciales

- [x] **T3.1** — `back/src/lib/llm/credentials.ts`: `upsertTenantLlmCredential`,
      `getTenantLlmCredential` (devuelve el **claro**, uso interno del back) y
      `listTenantLlmCredentialsPublic` (devuelve la huella, **sin** `apiKey`). Cifrado con
      `encryptToken` / `decryptToken` de `back/src/lib/integrations/oauth.ts:52`. No se escribe
      cifrado nuevo.
- [x] **T3.2** — Endpoints en `back/src/routes/clients.ts` (`/api/clients`, montado en
      `index.ts:243`): `GET /:id/llm-credentials` (huellas), `PUT /:id/llm-credentials/:provider`
      (guardar + verificar), `DELETE /:id/llm-credentials/:provider`. Validación Zod del proveedor
      contra la lista cerrada.
- [x] **T3.3** — **Sólo escritura, con prueba que lo sostiene** (`design.md §B.1`): se guarda una
      clave conocida y se afirma que esa cadena **no aparece en el cuerpo** de ninguna respuesta de
      lectura del cliente. La aserción va sobre el JSON completo, no sobre el nombre del campo:
      es la que sobrevive a un `include` añadido por descuido dentro de seis meses.
- [~] **T3.4** — Verificación con `models.list()` (cero tokens, `design.md §F`). Estados
      `connected` / `invalid` / `undecryptable` con `lastError`. **Smoke manual contra los tres
      proveedores** para confirmar que las tres capas compatibles exponen el endpoint; si alguna no
      lo hace, fallback a completion mínima **sólo para ese proveedor**, decidido con el resultado
      del smoke y no antes.
- [x] **T3.5** — Una clave inválida **se guarda** marcada `invalid` en vez de rechazarse: perder lo
      que el humano acaba de teclear por un fallo que puede ser de red es peor que guardarlo
      marcado. Lo que no se hace es servir con ella (T4.3).

## T4 — Resolutor de cliente por tenant

- [x] **T4.1** — `getClientForAgent` pasa a `async` con la firma de `design.md §C.3`
      (`model`, `tenantId`, `credentialMode`). Orden de resolución: `openclaw` → `platform` →
      `byok`. `runtime === "openclaw"` no mira modo ni credenciales.
- [x] **T4.2** — `ToolLoopParams` gana `tenantId` y `credentialMode`; `runAgent` los pasa desde lo
      que ya tiene resuelto. Call site único: `engine.ts:439`.
- [x] **T4.3** — **Fail-closed, el corazón del change**: `byok` sin credencial para el proveedor del
      modelo, o con `status !== "connected"`, o con descifrado fallido ⇒ **`HttpError(402)`** con
      motivo distinguible. **Nunca** se cae al cliente de plataforma. Tests: los tres casos, y uno
      que afirma que el cliente global **no** se usó.
- [x] **T4.4** — Caché de **instancias** con clave `${tenantId}:${provider}:${updatedAt}`
      (`design.md §C.4`). Test: cambiar la clave del tenant cambia la instancia usada, sin ninguna
      llamada de invalidación explícita. El componente `updatedAt` es lo que hace que no se pueda
      quedar obsoleta. **V5** añadió la purga del prefijo `${tenantId}:${provider}:` al insertar:
      la entrada vieja ya era inalcanzable, pero seguía residente con la clave recién rotada dentro.
      Dos pruebas más: la instancia vieja no se reutiliza, y la purga no toca a otros tenants.
- [x] **T4.5** — Un agente **sin tenant** es siempre `platform` (`design.md §A`). Test con la
      consola de pruebas (`isTest`) contra un agente sin tenant: sigue funcionando igual que en H1.

## T5 — Metering ramificado

- [x] **T5.1** — `checkClientBalance` añade `credentialMode` **al select que ya hace**
      (`token-metering.ts:33-36`): cero consultas extra. Ramificación según la tabla de
      `design.md §E.1`.
- [x] **T5.2** — **`byok` exime del cupo, NUNCA del `isActive`.** Test explícito: tenant `byok` con
      `tokensUsed > tokenBalance` ⇒ atiende; el mismo tenant con `isActive: false` ⇒ 402. Si esta
      prueba no existe, el modo BYOK es la forma de seguir siendo atendido sin pagar la suscripción.
- [x] **T5.3** — `assertUsageAllowed` devuelve `{ meteredTenantId, credentialMode }`. Los 2 call
      sites (`engine.ts:544`, `engine.ts:648`) y el DTO interno (`agent/types.ts:25`) se actualizan.
      **AC de regresión cero sobre H1**: el gate fail-closed, el cobro contra el tenant de BD y la
      exención acotada de la consola siguen igual.
- [x] **T5.4** — `credentialMode` es un interno del motor y **no sale** en la respuesta pública:
      se descarta junto a `meteredTenantId` (`engine.ts:786-788`). `POST /api/chat` es ruta pública
      y su respuesta llega al widget en el sitio del cliente.
- [x] **T5.5** — `deductTokens` recibe `credentialMode`: en `byok` crea la fila de `uso_tokens` y
      **no** incrementa `Tenant.tokensUsed`. Parámetro con el **modo**, no un booleano
      `countsAgainstQuota`: el booleano guarda la consecuencia y pierde el hecho.
- [x] **T5.6** — `back/src/lib/automations/engine.ts:123` respeta el modo. Sin esto, el consumo de
      las automatizaciones de un tenant `byok` se descontaría de un cupo que no aplica — el mismo
      agujero que H1 encontró en los webhooks que nunca pasaban `clientId`. **V5** detectó que esto
      estaba marcado sin prueba propia (los fixtures de `metering-automations.test.ts` sólo usaban
      `platform`): añadida la que exige `deductTokens(…, "automation", "byok")`.

## T6 — Front

- [x] **T6.1** — Selector de modo en `ClientModal` (`/clientes`). Pasar a `byok` sin credencial
      `connected` **avisa**, no bloquea (`design.md §G`).
- [x] **T6.2** — Tres filas de credencial (OpenAI / Gemini / Anthropic) con Guardar+Probar y estado
      `••••1234 · verificada <fecha>` o el error del proveedor.
- [x] **T6.3** — El campo de clave **nunca** se rellena de vuelta al abrir el modal:
      `type="password"`, `autoComplete="new-password"` (convención del repo), vacío con el hint al
      lado. Un campo con puntos prerellenados invita a guardar los puntos como clave nueva.
- [x] **T6.4** — El front **no** decide qué modelos son elegibles; el back es quien sabe si hay
      credencial para ese proveedor. Misma decisión que `publishPreconditions` en H3: una regla,
      un sitio.

---

## Deuda anotada a propósito (no se arregla aquí, no se ignora)

- **Embeddings e ingesta de conocimiento** siguen siendo coste de plataforma en los dos modos: se
  ejecutan cuando el propietario sube documentación, no por mensaje de usuario final, y atribuirlos
  por tenant exige un choke point que no existe (`design.md §H`).
- **Estudios de mercado** (`STRONG_MODEL`) no miran el modo: son herramienta interna, no consumo
  de cliente.
- **Effort → `thinking.budget_tokens` en Anthropic**: función nueva con modo de fallo invisible
  (el proveedor no protesta). Fuera de un change de credenciales.
- **Rotación y caducidad de claves BYOK**: fuera. Misma clase de deuda que las `TenantApiKey` del
  CRM, que se mintean sin revocar.
- **`H4` tiene que fijar dos precios**, uno por modo. Este change crea el hecho; el precio sigue
  siendo decisión del propietario y sigue bloqueando H4/T4.

## Verificaciones finales

- [x] **V1** — `npx tsc --noEmit` **dentro** de `back/`.
- [x] **V2** — `npm test` en `back/`, sin skips nuevos (base tras H3: 111 ficheros / 1156 pasan /
      3 skipped / 0 fallos).
- [~] **V3** — front: typecheck + build.
- [x] **V4** — revisión manual de la migración: aditiva, sin `DROP`, **sin backfill**. Leída línea
      a línea: 2 `ADD COLUMN … NOT NULL DEFAULT 'platform'`, 1 `CREATE TABLE`, 1 `CREATE UNIQUE
      INDEX`, 1 `ADD CONSTRAINT … FOREIGN KEY`. Cero `DROP`, `UPDATE`, `DELETE` y `ALTER COLUMN`:
      ninguna sentencia toca una fila existente.
- [x] **V5** — `sdd-verify` ejecutado **inline** (no delegado a sub-agente). Matriz AC↔código
      completa en `validation.md`: los 16 AC apuntan a línea concreta. Encontró un defecto (la clave
      rotada seguía residente en la caché de clientes) y un hueco de cobertura (T5.6 marcado sin
      prueba). Los dos arreglados y con prueba. Medición final: back `tsc` EXIT=0, suite
      **116 ficheros / 1249 pasan / 3 skipped / 0 fallos**.
- [ ] **V6** — post-deploy: un tenant en `platform` responde igual que antes; el mismo tenant
      pasado a `byok` sin clave da 402 con el motivo; con clave válida responde y su
      `Tenant.tokensUsed` **no** se mueve mientras `uso_tokens` **sí** registra la fila.

---

## Estado real (27/07/2026)

Leyenda: `[x]` hecha con su prueba verde · `[~]` parcial, con el motivo · `[ ]` no hecha.

**Suite:** 116 ficheros / 1246 pasan / 3 skipped / 0 fallos. Base tras H3: 111 / 1156 / 3 / 0.
Los +90 son exactamente los cinco ficheros nuevos de H2 (25 + 26 + 17 + 16 + 6). Ningún test
existente se borró, se saltó ni se debilitó: los cambios en ficheros de test previos fueron de
forma de mock y de fixture (el gate devuelve un objeto donde antes devolvía un string, y
`deductTokens` recibe un argumento más).

**Pruebas nuevas:**

| Fichero | Cubre |
|---|---|
| `tests/llm-governance.test.ts` (25) | T2.1 routing por prefijo, T2.2 tabla de `governChatBody`, T2.3 factoría |
| `tests/llm-credentials.test.ts` (26) | T3.3 write-only sobre el JSON entero, T3.4 `models.list()`, T3.5 inválidas |
| `tests/byok-resolver.test.ts` (19) | T4.3 402 sin fallback, T4.4 caché por `updatedAt` + purga de la clave rotada, T4.5 bordes |
| `tests/metering-automations.test.ts` (+1) | T5.6 una automatización byok cobra con modo byok |
| `tests/byok-metering.test.ts` (16) | T5 cupo exento en byok, `isActive` no exento, `deductTokens` por modo |
| `tests/byok-end-to-end.test.ts` (6) | T4.2/T5.3/T5.4: el modo viaja del gate al cliente y al cobro |

**Dos defectos reales que encontraron las pruebas nuevas, no la revisión:**

1. **Fuga del secreto por `lastError`** (la cazó T3.3). OpenAI responde literalmente
   `Incorrect API key provided: sk-proj-...`, y ese mensaje se guardaba tal cual en un campo
   que la API devuelve — el secreto salía por la vía de lectura con nombre de "error", y además
   quedaba escrito en los logs de Render. Añadido `redactSecret()` en `credentials.ts`, con
   sustitución literal de la clave verificada más un patrón genérico de reserva. El comentario
   que ya estaba puesto ("lo que NO se registra en el log es la clave") afirmaba justo lo que el
   código no hacía.
2. **`BLOQUEADO` sobre clientes que funcionan** (front, `ClientRow.tsx`). `blocked` incluía
   `remaining <= 0`, que en `byok` no bloquea nada. La tabla habría marcado en rojo a un cliente
   BYOK con el cupo a cero, y el operador le habría recargado tokens para arreglar algo que no
   estaba roto. Ahora el cupo sólo cuenta fuera de `byok`, y la celda muestra `CLAVE PROPIA ·
   sin cupo` en su lugar.

**Endurecimiento añadido sobre el diseño:** las tres lecturas públicas de `credentials.ts`
casteaban la fila de Prisma (`as PublicCredential`). Un cast no filtra campos de sobra, así que
la única barrera era el `select`. Añadido `toPublic()`, proyección explícita campo a campo:
segunda barrera para el vector que el propio diseño identifica (un `include` añadido más
adelante que arrastre la columna sin que nadie teclee `apiKey`).

**Desviación de nombres respecto a T3.1:** las funciones quedaron como `listCredentialsPublic`,
`upsertCredential`, `reverifyCredential`, `deleteCredential` y `getDecryptedApiKey`.

**Parciales y bloqueos:**

- **T2.6 `[~]`** — `ANTHROPIC_API_KEY` documentada en `render.yaml`. **`back/.env.example` NO se
  ha tocado**: la lectura de ese fichero está denegada por permisos en esta sesión, y no se
  rodeó la denegación. Queda como única línea pendiente de la tarea.
- **T3.4 `[~]`** — el test de que la verificación usa `models.list()` y no gasta tokens está
  verde. El **smoke contra los tres proveedores reales sigue pendiente**: necesita claves de
  verdad del propietario. Hasta ese smoke no está confirmado que las tres capas compatibles
  expongan el endpoint; si alguna no lo hiciera, el fallback es una completion mínima **sólo
  para ese proveedor**.
- **T3.5 gate humano** — no se ha pasado ningún cliente a `byok`.
- **V3 `[~]`** — `npx tsc --noEmit` en `front/` verde. El `next build` no se ejecutó para no
  escribir en el `.next` de la carpeta del usuario.
- **V4** — HECHO: migración leída línea a línea, aditiva, sin backfill.
- **V5 `sdd-verify`** — HECHO inline. Ver la matriz AC↔código en `validation.md`.
- **T1.5 / migración** — `20260727010000_llm_credential_mode` escrita y **no aplicada**. Despliega
  **después** de la de H3 (`20260727000000_agent_lifecycle_status`), que también sigue sin aplicar.
- **Nada commiteado de H2.**
