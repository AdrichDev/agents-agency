# Tasks — aa-agentes-entrega-monetizacion

Este change es un **plan maestro** (documentación). Sus "tareas" son: cerrar el doc y
engendrar los openspec hijos en orden. **NO se codea desde aquí.** Cada hijo lleva su
propio proposal/design/tasks/validation y su test verde.

## Cierre del plan maestro

- [x] **T0.1 — Decisión de negocio del humano**: coexisten `platform` (la plataforma paga
  el LLM, cliente paga suscripción con cupo) y `byok` (cliente aporta su key de
  OpenAI / Gemini / Anthropic), seleccionables. Registrada en Engram (obs. 994 + 995).
- [x] **T0.2 — Auditoría con evidencia** (6 puntos + descarte explícito del falso problema
  "hosting/Cloudflare"). Volcada en `design.md §B` con `file:line`.
- [x] **T0.3 — Anatomía comercial de referencia** (7 capas; 3 ya cubiertas). `design.md §A`.
- [x] **T0.4 — Backbone priorizado** P0/P1/P2. `design.md §C`.
- [ ] **T0.5 — Aprobación del roadmap por el humano** (confirmar orden y por cuál hijo se — ⏳ GATE HUMANO: aprobación del roadmap por el propietario (orden de los hijos e hijo de arranque)
  arranca; recomendado H1).

## Roadmap de openspec hijos (orden propuesto)

Orden por impacto/dependencia. Un hijo a la vez. `[ ]` = no arrancado.

- [~] **H1 (P0.1) — `aa-metering-fail-closed`** *(fase 1 implementada, commiteada, sin push)*:
  cerrar el fail-open de
  `back/src/routes/ai.ts:69`; `Agent.tenantId` obligatorio para publicar; **inventario
  previo de agentes con `tenantId = NULL` en prod y asignación de tenant ANTES de activar
  el corte** (si no, dejan de responder). Migración esperada. Test de regresión sobre la
  ruta caliente del chat público.
  *Bloquea vender. Recomendado arrancar por aquí.*

- [~] **H2 (P0.2) — `aa-credenciales-byok-multiproveedor`**: **openspec escrito el 27/07/2026**
  (`proposal` + `design` + `tasks` + `validation`). Clasificado **Nivel 4**: migración sobre
  producción, back + front, toca la capa LLM y el metering, y guarda **secretos de terceros en
  reposo**. Campo `credentialMode`
  (`platform` | `byok`); store de keys por tenant y proveedor cifrado con `encryptToken()`
  (`back/src/lib/integrations/oauth.ts:52`), **write-only** (la key nunca se devuelve en
  lectura ni aparece en logs); rama `byok` en `getClientForAgent()`
  (`back/src/lib/openai.ts:145`, pasa a `async`); proveedor **Anthropic** (`claude*`) vía
  capa OpenAI-compatible replicando el patrón de Gemini (`back/src/lib/openai.ts:11`) +
  extender la tabla de capacidades por familia (`back/src/lib/openai.ts:91`); metering
  ramificado: `byok` registra en `uso_tokens` pero no descuenta cupo ni da 402 por saldo.
  **Cuatro precisiones sobre el boceto de este roadmap, decididas al escribir la spec**
  (razonadas en `aa-credenciales-byok-multiproveedor/design.md`):
  1. **`credentialMode` vive en `Tenant`, no en `Agent`** (§A). BYOK es un acuerdo comercial con el
     cliente. Por agente, un mismo tenant tendría líneas de factura de dos precios y el cupo —que
     es del tenant— quedaría a distinto nivel que la unidad que lo consume.
  2. **La tabla de capacidades no está en `openai.ts:91`**, como decía este roadmap: vive en
     `back/src/lib/model-capabilities.ts` y tiene una gemela en `front/lib/models.ts` que declara en
     su cabecera que hay que mantener las dos en sincronía. Las dos se tocan en el mismo commit.
  3. **Aparece un trabajo que el boceto no veía**: la gobernanza de `reasoning_effort` /
     `temperature` está parcheada **sobre el singleton global** (`openai.ts:72-97`), así que los
     clientes por-tenant necesitan la misma regla. Se **extrae a una factoría** en vez de
     duplicarse; duplicada, el día que divergiera el síntoma sería un 400 del proveedor **sólo para
     los clientes en BYOK** (§C.2).
  4. **`byok` exime del cupo, nunca de `Tenant.isActive`** (§E.1). Si eximiera de los dos, BYOK
     sería la forma de seguir siendo atendido sin pagar la suscripción.
  *Depende de: H1. Se despliega después de H3 (las dos tocan el mismo cuello de `engine.ts`).*

- [~] **H3 (P1.1) — `aa-agente-ciclo-vida-publicacion`**: **implementado, verde y commiteado**
  (`61e8003`, `80d33f3`, rama `ac/aa-agente-ciclo-vida-publicacion`, **sin push**). Migración
  **escrita y sin aplicar**: T1.3 es gate humano y va en el mismo despliegue que T2 y T3. Estado explícito
  `draft → published → (draft | suspended | archived)`, gate de publicación en el mismo cuello único
  que H1 (`engine.ts:537`), endpoints `publish`/`unpublish` con precondiciones, rastro
  `AgentStatusEvent` y `countBillableAgents` como contrato para H4. Clasificado **Nivel 4**: dos
  gates humanos (aprobar el backfill, y aparte aplicar la migración), porque un backfill mal decidido
  deja clientes de producción sin servicio.
  **Dos desvíos respecto al boceto original de este roadmap, deliberados** (razonados en
  `aa-agente-ciclo-vida-publicacion/design.md §C.1`):
  1. Se cae el estado `probado`. No es un estado: es un hecho derivable de `Conversation.isTest`, y
     un estado que no cambia el comportamiento observable es una etiqueta, no un estado.
  2. Publicar **no** exige haber pasado por la consola de pruebas. Se satisface con un "hola", así
     que daría garantía falsa a cambio de fricción real. Las precondiciones que sí se exigen son las
     que rompen algo si faltan: tenant, prompt y canal conectado.
  Migración aditiva esperada.
  *Depende de: H1. **Bloquea: H4** (ver abajo).*

- [~] **H4 (P1.2) — `aa-planes-y-cuotas`**: parte 1 **implementada y commiteada** (`f84c89d`,
  `8041811`, rama `ac/aa-metering-fail-closed`, sin push): estado de pago separado del estado de
  cupo, y el instrumento de medición (`npm run measure:cost`, fail-closed sobre la tarifa).
  Medición hecha contra producción el 27/07 con cobertura de tarifa del 100%: una conversación
  cuesta 1-5 céntimos de dólar, 1M de tokens menos de $2. Conclusión que cambia el planteamiento:
  **el coste de LLM no fija el precio.**
  **Base de cobro decidida por el propietario: por agente activo**, con el cupo degradado a
  guardarraíl anti-abuso. Cobrar por agente activo exige que "activo" sea un hecho en BD, y `Agent`
  no lo tenía ⇒ `Plan` (T4) esperaba a H3; **H3 ya está implementado y su migración aplicada en
  producción (27/07)**, así que ese bloqueo cae.
  **Segunda decisión del propietario (27/07): en AA no va ningún precio.** `Plan` sin campo de
  importe; AA expone el **recuento de agentes activos** y el importe lo aplica Stripe (H6) como
  `Price` por unidad con `quantity` = ese recuento. Motivo: dos fuentes de verdad para el mismo
  número se separan, y cambiar de precio no debería ser una migración. Efecto: **desaparece el gate
  de la cifra en €**, y T3 (cuota por periodo) y T4 (`Plan`) quedan ambas abiertas.
  Migración esperada.
  *Depende de: H1, **H3**. Bloquea: H6. Segundo blocker real de venta.*

- [x] **H5 (P2.1) — `aa-portal-cliente`**: rol `client` + `User.tenantId` + scoping de
  sesión (hoy `User.role` es `admin|editor|viewer` sin `tenantId`,
  `back/prisma/schema.prisma:23`); vistas de sólo lectura de su agente, conversaciones y
  consumo, reutilizando `requireRole()` (`back/src/lib/auth.ts:107`).
  **El spec exige test negativo de aislamiento entre tenants.** Migración esperada.
  *Depende de: H3, H4.* — verificado: `back/prisma/schema.prisma:40` (`tenantId` en `User`) y `:23` (roles admin/editor/viewer/client); puerta `back/src/lib/client-scope.ts:38` montada en `back/src/index.ts:207`; portal en `index.ts:269`; aislamiento por allowlist deny-by-default en `back/src/lib/client-routes.ts:23`

- [x] **H6 (P2.2) — `aa-stripe-suscripciones`**: checkout, webhooks **idempotentes**,
  renovación de cupo por periodo, impago → `Tenant.isActive = false` (kill switch ya
  existente). **Dinero real ⇒ human gate obligatorio; no arrancar hasta P0/P1 verdes.**
  *Depende de: H4.* — verificado: el hijo `aa-stripe-suscripciones` está implementado (`back/src/routes/service-stripe.ts` y `back/src/lib/stripe/{gateway,sync-catalog,webhook-signature,event-log,checkout}.ts`, T1-T6 marcadas). DESVÍO DELIBERADO respecto a lo que dice esta línea: el impago NO escribe `Tenant.isActive = false`; el corte va por `subscriptionStatus` mediante `SUBSCRIPTION_BLOCKING_STATUSES` en `back/src/lib/token-metering.ts`, porque las dos columnas se separaron a propósito (una es decisión humana, la otra estado de Stripe).

## Verificaciones finales del plan maestro

- [x] **T9 — Engram**: auditoría + decisión de negocio + backbone persistidos como decisión
  de arquitectura (obs. 994 y 995; la 995 corrige a la 994 en el punto del metering).
- [ ] **T10 — Confirmar** con el humano por cuál hijo se arranca (recomendado: H1). — ⏳ GATE HUMANO: confirmar el hijo de arranque. Ya sin efecto práctico: H1 a H6 están todos arrancados o cerrados.

## Nota

Cada hijo es un openspec independiente y aplica la regla del repo: **DONE sólo con test
verde; sin spec, revertido.** Este plan maestro no genera artefactos de código.

Relación con el plan maestro anterior: `aa-agentes-rediseno-operativo` cubrió la **calidad**
del agente (H1-H8, cerrado salvo H7 diferido). Este eje cubre su **entrega y cobro**. Son
complementarios; ninguno sustituye al otro.

## Cierre — 28/07/2026

Cierre como cambio paraguas del eje de entrega y monetización: los hijos H1 a H6 están arrancados o cerrados, y H5 y H6 quedan marcados con prueba. Desvío que conviene recordar: el corte por impago se decide con `subscriptionStatus`, no con `Tenant.isActive`.
