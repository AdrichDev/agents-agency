# Design — aa-agentes-entrega-monetizacion

Plan maestro del eje **entrega + monetización**. Documentación: no se codea desde aquí.

---

## §A. Anatomía de un agente vendible (referencia)

Siete capas. Las tres primeras ya las cubre AA (plan maestro anterior). Las cuatro últimas
son este eje.

| # | Capa | Pregunta que responde | Cubierta por |
|---|---|---|---|
| 1 | **Fábrica** | ¿Sé construir un agente bueno? | `aa-agentes-rediseno-operativo` H1-H8 ✅ |
| 2 | **Prueba** | ¿Puedo hablarle antes de publicarlo? | H1 consola de pruebas ✅ |
| 3 | **Canal** | ¿Cómo llega al usuario final? | widget.js / Telegram / API ✅ |
| 4 | **Credencial** | ¿Con qué key razona y quién la paga? | **este eje, H2** |
| 5 | **Control** | ¿Puedo medir, limitar y cortar el consumo? | parcial → **H1, H4** |
| 6 | **Entrega** | ¿Existe un acto de publicar con entregable? | **este eje, H3** |
| 7 | **Cobro** | ¿El cliente se sirve solo y paga? | **este eje, H5, H6** |

**Principio de la capa 5:** medir sin poder cortar no es control, es contabilidad. Y cortar
sólo cuando hay tenant no es cortar, es confiar.

---

## §B. Gap actual vs ideal (evidencia `file:line`)

### B.1 — Fail-open de metering ⚠️ agujero de coste

```ts
// back/src/routes/ai.ts:69
if (agent.tenantId) {              // ← fail-OPEN: sin tenant, no se comprueba nada
  await checkClientBalance(agent.tenantId);
}
```

- `Agent.tenantId` es `String?` **nullable** (`back/prisma/schema.prisma`, modelo `Agent`).
- Opcional también al crear: `tenantId: z.string().min(1).optional()`
  (`back/src/routes/agents.ts:86`).
- Efecto: agente huérfano ⇒ chat ilimitado contra la key de la plataforma, **sin cupo, sin
  fila en `uso_tokens`, sin kill switch aplicable**. Invisible en cualquier informe de
  consumo porque el consumo nunca se registra.
- **Ideal:** fail-closed. Sin tenant resoluble ⇒ 402. `tenantId` obligatorio para publicar.

### B.2 — Lo que SÍ funciona (no rehacer)

Registrado explícitamente para que ningún hijo reinvente esto:

- `checkClientBalance(tenantId)` (`back/src/lib/token-metering.ts:18-27`): lee
  `Tenant.isActive`, `tokenBalance`, `tokensUsed`; lanza `HttpError(402, ...)` si el tenant
  no existe, está inactivo o `tokensUsed >= tokenBalance`. **Se llama antes de consumir.**
- Contabilización posterior: incrementa `tokensUsed`, escribe log en `uso_tokens`
  (`TokenUsage`: `tenantId`, `agentId`, `conversationId`, `tokens`, `model`, `operacion`,
  índice `[tenantId, createdAt]`) y desactiva al tenant al agotar cupo (best-effort).
- **Kill switch manual por tenant ya existe**: `Tenant.isActive = false` ⇒ 402.
- Entrega técnica ya resuelta: `<script src=".../widget.js" data-agent-key="PUBLIC_KEY">`
  (`back/public/widget.js:3`) contra resolución por `publicKey` (`back/src/routes/ai.ts:57-64`).

### B.3 — BYOK arquitectónicamente imposible hoy

```ts
// back/src/lib/openai.ts:16-22 — singletons de módulo, resueltos en el import
const openaiRaw = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const geminiRaw = hasGemini ? new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: GEMINI_BASE_URL }) : null;
export const openai = (openaiRaw ?? geminiRaw)!;
```

Key fijada por proceso ⇒ no hay forma de usar la del tenant.

**Punto de extensión correcto, ya existente y con la firma adecuada:**

```ts
// back/src/lib/openai.ts:145
export function getClientForAgent(agent: AgentRuntimeSelector): AgentClientResolution
```

Ya ramifica `runtime === "openclaw"` construyendo un cliente nuevo por llamada. La rama
`byok` encaja en el mismo sitio con la misma forma. Coste previsible: pasarla a `async`
(hay que leer y descifrar la key), lo que arrastra a sus llamadores.

### B.4 — Anthropic ausente

```ts
// back/src/lib/openai.ts:25-26
function isGeminiModel(model?: string): boolean {
  return typeof model === "string" && model.startsWith("gemini");
}
```

Routing binario por prefijo: `gemini*` → Gemini, todo lo demás → OpenAI. Sin rama `claude*`.

A favor: Gemini entra por **capa OpenAI-compatible**
(`GEMINI_BASE_URL = ".../v1beta/openai/"`, `back/src/lib/openai.ts:11`). Anthropic ofrece
capa equivalente ⇒ se añade replicando el patrón, sin SDK nuevo ni segunda abstracción.

Aviso para el hijo: `Agent.model` tiene default `"gpt-4.1-nano"` y hay lógica de
capacidades por familia (`reasoningEffort`, temperatura forzada a 1 en razonadores,
`back/src/lib/openai.ts:91`). Añadir familia obliga a extender esa tabla, no sólo el router.

### B.5 — Sin ciclo de vida ni entregable

`Agent` no tiene campo de estado. Existe telemetría de instalación (`widgetInstalledAt`,
`widgetLastSeenAt`, migración `20260716120000_agent_widget_install`) pero:

- nada distingue borrador de publicado ⇒ un agente a medio configurar es tan alcanzable
  por su `publicKey` como uno terminado;
- no hay artefacto de entrega (snippet listo, deep-link de Telegram, instrucciones);
- no hay estado `suspendido` a nivel de agente: suspender hoy es todo-o-nada por tenant.

**Ideal:** `borrador → probado → publicado → suspendido`. `publicado` exige tenant +
haber pasado por la consola de pruebas. Publicar emite el entregable.

### B.6 — Cupo sin plan, cuota sin granularidad

`Tenant` (`back/prisma/schema.prisma`) tiene el mecanismo pero no la oferta:

```
tokenBalance  Int  @default(0)  @map("saldo_tokens")    // cupo asignado (0 = bloqueado)
tokensUsed    Int  @default(0)  @map("tokens_usados")   // consumo acumulado
isActive      Boolean @default(true) @map("activo")     // false → widget devuelve 402
```

- No existe `Plan`, `Subscription`, `Credit`, precio ni renovación: el cupo se asigna a mano
  y no se repone solo.
- `tokensUsed` es **acumulado histórico**, no por periodo ⇒ no modela "N tokens/mes".
- Cuota sólo por tenant: **un agente desbocado se come el cupo de sus hermanos** y no hay
  forma de limitarlo ni de saber a quién facturar el exceso sin agregar a mano `uso_tokens`.
- Se mide en tokens, se vende en dinero: falta traducción coste→precio. Sin coste real por
  conversación medido, cualquier precio es adivinado.

### B.7 — Sin portal del cliente

```
// back/prisma/schema.prisma:23
role  String  @default("admin")  @map("rol")   // admin | editor | viewer
```

- `User` **no tiene `tenantId`**: la sesión no puede acotarse a un tenant.
- No hay rol `client`. `requireRole()` existe (`back/src/lib/auth.ts:107`) ⇒ la maquinaria
  de autorización está, faltan el rol y el scoping.
- Efecto: el cliente no entra. Cada consulta suya ("¿cuánto he gastado?", "¿qué le han
  preguntado al bot?") es trabajo manual del operador. No escala con las ventas.

---

## §C. Backbone priorizado

### P0 — Tapa la sangría y desbloquea vender

**H1 · `aa-metering-fail-closed`** — el único cambio que es urgente de verdad.
Fail-closed en `ai.ts:69`; `tenantId` obligatorio para publicar; inventario previo de
agentes huérfanos en prod y asignación antes de activar el corte.
*Impacto:* cierra consumo no facturable e invisible. *Coste:* bajo. *Riesgo:* ruta caliente
⇒ exige test de regresión. **Sin esto, cada agente vendido es coste no acotado.**

**H2 · `aa-credenciales-byok-multiproveedor`** — habilita la decisión de negocio.
`credentialMode` (`platform` | `byok`) + store cifrado por proveedor con `encryptToken()`
(`back/src/lib/integrations/oauth.ts:52`), write-only; rama `byok` en `getClientForAgent()`
(`back/src/lib/openai.ts:145`); proveedor Anthropic (`claude*`) por capa OpenAI-compatible;
metering ramificado (`byok` registra en `uso_tokens` para analítica pero **no** descuenta
cupo ni devuelve 402 por saldo).
*Impacto:* sin esto la mitad de la oferta acordada no existe. *Riesgo:* custodia de
credenciales de terceros + `async` contagioso en los llamadores.

### P1 — Convierte producto en oferta

**H3 · `aa-agente-ciclo-vida-publicacion`** — el acto de vender.
Estado `borrador → probado → publicado → suspendido`; publicar exige tenant + paso por
consola de pruebas (H1 del plan anterior, ya existe con flag `es_prueba`); emite entregable
(snippet, deep-link Telegram); `publicKey` sólo responde si `publicado`.
*Depende de:* H1 (tenant obligatorio).

**H4 · `aa-planes-y-cuotas`** — el otro blocker real de venta.
Arranca **midiendo coste real por conversación desde `uso_tokens`** antes de proponer
precio. Luego: modelo `Plan` (precio + cupo por periodo), cupo por **periodo** (no
acumulado histórico), y cuota por agente además de por tenant.
*Depende de:* H1. *Bloquea:* H6.

### P2 — Autoservicio

**H5 · `aa-portal-cliente`** — rol `client` + `User.tenantId` + scoping de sesión; vistas
de sólo lectura sobre su agente, sus conversaciones y su consumo, reutilizando
`requireRole()`. *Riesgo:* fuga entre tenants ⇒ el spec exige test negativo de aislamiento.
*Depende de:* H3, H4.

**H6 · `aa-stripe-suscripciones`** — checkout, webhooks idempotentes, renovación de cupo,
impago → `isActive = false` (kill switch ya existente). **Dinero real: human gate
obligatorio.** *Depende de:* H4. No arrancar hasta P0/P1 verdes.

---

## §D. Principio rector del rediseño

> **Un agente no se despliega, se activa.** No hay nada que alojar: el runtime es único y
> multi-tenant (`aa-back` en Render), y el agente es una fila más su `publicKey`.
> Por tanto todo el trabajo de este eje es **control y contrato**, no infraestructura.

Tres reglas que todo hijo debe respetar:

1. **Fail-closed por defecto.** Ante duda de identidad de tenant, credencial o cupo: cortar,
   no confiar. El estado por defecto de lo desconocido es "no cobrable" ⇒ "no servible".
2. **No rehacer lo que funciona.** `checkClientBalance`, `uso_tokens`, `Tenant.isActive`,
   `encryptToken`, `getClientForAgent`, `widget.js` y la consola de pruebas ya existen.
   Extender, no reescribir.
3. **Honestidad de estado.** Igual que el plan anterior prohibió marcar RAG `"indexed"` con
   0 chunks, este prohíbe mostrar un agente como "publicado" si no es alcanzable, o un
   consumo como medido si el metering no corrió.
