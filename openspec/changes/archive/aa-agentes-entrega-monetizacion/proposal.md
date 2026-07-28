# Proposal — aa-agentes-entrega-monetizacion

## Intent

Convertir los agentes de AA en un **producto vendible**. Hoy AA sabe *fabricar* agentes
buenos (el plan maestro `aa-agentes-rediseno-operativo`, H1-H8, cerró la calidad: consola
de pruebas, RAG honesto, wizard canal-aware, skills por tipo, external_api UI, n8n honesto)
pero **no sabe entregarlos ni cobrarlos**. El agente sale correcto y se queda en el panel
del operador: no hay acto de publicación, no hay plan ni precio, no hay portal para el
cliente, y el metering tiene un fail-open que regala consumo.

Este documento es el **plan maestro** del eje que faltaba: **entrega + monetización**.
Mapea la anatomía comercial de referencia, contrasta con el estado real del código
(auditoría con evidencia `file:line`), prioriza en backbone P0/P1/P2 y define el roadmap
de openspec hijos. **NO toca código** — de aquí salen los hijos que sí lo tocarán.

## Decisión de negocio que gobierna este eje (humano, 2026-07-26)

Dos modalidades de credencial **coexisten** y el cliente elige:

| Modo | Quién paga el LLM | Metering |
|---|---|---|
| `platform` | La plataforma, con su key global | Descuenta cupo del tenant; 402 al agotar |
| `byok` | El cliente, con su propia key (OpenAI / Gemini / **Anthropic**) | Registra consumo para analítica; **no** descuenta cupo ni 402 por saldo |

Consecuencia directa: en modo `platform` la plataforma asume el coste variable, por lo que
**metering fail-closed, cuota y kill switch dejan de ser deuda técnica y pasan a ser
blockers de venta**. Vender sin ellos es exponerse a coste no acotado por cliente.

## Problema (auditoría con evidencia)

Seis puntos verificados contra el código (detalle en `design.md §B`):

1. **Fail-open de metering (agujero de coste)** — `Agent.tenantId` es `String?` nullable
   (`back/prisma/schema.prisma`) y opcional al crear (`back/src/routes/agents.ts:86`).
   El chat público sólo verifica saldo *si* hay tenant: `if (agent.tenantId) { ... }`
   (`back/src/routes/ai.ts:69`). Un agente sin tenant consume la key de la plataforma
   **sin cupo, sin registro en `uso_tokens` y sin posibilidad de kill switch**.
2. **BYOK imposible con la arquitectura actual** — los clientes LLM son singletons de
   módulo construidos desde `process.env` en tiempo de import (`back/src/lib/openai.ts:16-22`).
   No existe ninguna vía para inyectar una key por tenant. El punto de extensión correcto
   ya existe y está sin usar para esto: `getClientForAgent()` (`back/src/lib/openai.ts:145`).
3. **Anthropic no soportado** — el proveedor se decide por prefijo del modelo:
   `gemini*` → Gemini, resto → OpenAI (`back/src/lib/openai.ts:25-26`). No hay rama
   `claude*`. Buena noticia: Gemini ya entra por capa OpenAI-compatible
   (`back/src/lib/openai.ts:11`), patrón replicable para Anthropic.
4. **No existe el acto de publicar** — `Agent` no tiene estado de ciclo de vida. Hay
   `widgetInstalledAt` / `widgetLastSeenAt` (telemetría de instalación) pero nada que
   distinga borrador de publicado, ni entregable emitido para el cliente. El widget ya
   funciona técnicamente (`back/public/widget.js:3`, resolución por `publicKey` en
   `back/src/routes/ai.ts:57-64`): falta el envoltorio comercial, no la infraestructura.
5. **Cupo sin plan y sin granularidad** — `Tenant` tiene `tokenBalance` / `tokensUsed` /
   `isActive` (`back/prisma/schema.prisma`, modelo `Tenant`) y `checkClientBalance()`
   funciona y corta con 402 (`back/src/lib/token-metering.ts:18-27`). Pero **no existe
   `Plan`, `Subscription`, precio ni renovación**: el cupo se asigna a mano. Y la cuota es
   sólo por tenant, nunca por agente: un agente desbocado se come el cupo de sus hermanos.
6. **Sin portal del cliente** — `User.role` es `admin | editor | viewer`
   (`back/prisma/schema.prisma:23`) y `User` **no tiene `tenantId`**. No hay rol de cliente
   ni scoping por tenant en la sesión, así que el cliente no puede entrar a ver su agente:
   todo pasa por el panel del operador.

**Lo que NO es el problema (descartado con evidencia):** alojamiento. Un agente no es
código desplegable, es una fila en `aa.agente` + `publicKey` servida por un runtime
multi-tenant (`aa-back` en Render). **No hace falta Cloudflare ni hosting por agente.**
Esta línea se documenta explícitamente para cerrar la duda recurrente.

## Scope de este documento

- Definir la **anatomía comercial de referencia** de un agente vendible (design §A).
- **Auditoría gap** actual vs ideal, los 6 puntos (design §B).
- **Backbone priorizado** P0/P1/P2 con justificación de impacto (design §C).
- **Roadmap** de openspec hijos y orden de ejecución (`tasks.md`).
- Fuera de scope: escribir código, migraciones, o los specs hijos en detalle.

## Backbone (resumen; detalle en design §C)

- **P0 (tapa la sangría, desbloquea vender):**
  - Metering fail-closed + `tenantId` obligatorio para publicar.
  - Modo de credencial `platform` | `byok` + store cifrado por proveedor + Anthropic.
- **P1 (convierte producto en oferta):**
  - Ciclo de vida del agente (`borrador → probado → publicado → suspendido`) + entregable.
  - `Plan` con precio y cupo + cuota por agente además de por tenant.
- **P2 (autoservicio):**
  - Portal del cliente (rol `client` + `User.tenantId`).
  - Stripe: suscripción, renovación de cupo, impago → suspensión.

## Risks

- **Alcance-elefante**: el eje entero de golpe hunde el producto. Mitigación: un openspec
  hijo por pieza, P0 primero; H1 y H4 son los únicos que bloquean vender de verdad.
- **Regresión en el chat público**: H1 y H2 tocan la ruta caliente (`ai.ts`) por la que
  entra todo el tráfico de agentes. Mitigación: fail-closed detrás de test de regresión;
  ningún cambio de comportamiento para agentes que ya tienen tenant.
- **Fail-closed rompe agentes huérfanos existentes**: si hay filas en prod con
  `tenantId = NULL`, al cerrar el guard dejan de responder. Mitigación obligatoria en H1:
  inventariar y asignar tenant **antes** de activar el corte.
- **Custodia de keys de cliente (BYOK)**: guardar credenciales de terceros eleva el riesgo.
  Mitigación: reutilizar `encryptToken()` (`back/src/lib/integrations/oauth.ts:52`),
  write-only (nunca devolver la key en lectura), y nunca registrarla en logs.
- **Dinero real (H6)**: Stripe implica webhooks, idempotencia y estados de impago.
  Requiere human gate y no se aborda hasta que P0/P1 estén verdes.
- **Coste de `platform` sin precio calculado**: fijar plan sin conocer el coste real por
  conversación puede vender a pérdida. Mitigación: H4 arranca midiendo coste real desde
  `uso_tokens` antes de proponer precio.

## Dependencies

- Auditoría base: este documento (evidencia ya recogida, `design.md §B`).
- Plan maestro previo `aa-agentes-rediseno-operativo` (calidad del agente) — cerrado
  salvo H7 diferido. Este eje es complementario, no lo sustituye.
- Patrón de cifrado existente: `encryptToken()` en `back/src/lib/integrations/oauth.ts:52`.
- Punto de extensión existente: `getClientForAgent()` en `back/src/lib/openai.ts:145`.
- H6 (Stripe) depende de H4 (Plan) y de aprobación humana explícita.
- **H4 depende de H3** *(dependencia nueva, 27/07/2026)*: con la medición de coste delante, el
  propietario decidió cobrar **por agente activo** en vez de por consumo. Eso convierte "agente
  activo" en el numerador de la factura, y ese concepto no existe: `Agent`
  (`back/prisma/schema.prisma:133-165`) no tiene estado ni publicación. H3 deja de ser P1 paralelo
  y pasa a ser previo al modelo `Plan`. Detalle en `aa-planes-y-cuotas/design.md §C.4`.
- Sin dependencias de despliegue: este documento no genera artefactos de código.
