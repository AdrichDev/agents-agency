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
- [ ] **T0.5 — Aprobación del roadmap por el humano** (confirmar orden y por cuál hijo se
  arranca; recomendado H1).

## Roadmap de openspec hijos (orden propuesto)

Orden por impacto/dependencia. Un hijo a la vez. `[ ]` = no arrancado.

- [ ] **H1 (P0.1) — `aa-metering-fail-closed`**: cerrar el fail-open de
  `back/src/routes/ai.ts:69`; `Agent.tenantId` obligatorio para publicar; **inventario
  previo de agentes con `tenantId = NULL` en prod y asignación de tenant ANTES de activar
  el corte** (si no, dejan de responder). Migración esperada. Test de regresión sobre la
  ruta caliente del chat público.
  *Bloquea vender. Recomendado arrancar por aquí.*

- [ ] **H2 (P0.2) — `aa-credenciales-byok-multiproveedor`**: campo `credentialMode`
  (`platform` | `byok`); store de keys por tenant y proveedor cifrado con `encryptToken()`
  (`back/src/lib/integrations/oauth.ts:52`), **write-only** (la key nunca se devuelve en
  lectura ni aparece en logs); rama `byok` en `getClientForAgent()`
  (`back/src/lib/openai.ts:145`, pasa a `async`); proveedor **Anthropic** (`claude*`) vía
  capa OpenAI-compatible replicando el patrón de Gemini (`back/src/lib/openai.ts:11`) +
  extender la tabla de capacidades por familia (`back/src/lib/openai.ts:91`); metering
  ramificado: `byok` registra en `uso_tokens` pero no descuenta cupo ni da 402 por saldo.
  *Depende de: H1.*

- [ ] **H3 (P1.1) — `aa-agente-ciclo-vida-publicacion`**: estado
  `borrador → probado → publicado → suspendido`; `publicado` exige tenant + paso por la
  consola de pruebas (ya existe, flag `es_prueba`); `publicKey` responde sólo si
  `publicado`; publicar emite el entregable (snippet `widget.js`, deep-link Telegram,
  instrucciones). Migración esperada.
  *Depende de: H1.*

- [ ] **H4 (P1.2) — `aa-planes-y-cuotas`**: **primera tarea = medir coste real por
  conversación desde `uso_tokens`** (sin ese número, el precio es adivinado); modelo `Plan`
  (precio + cupo por periodo); cupo **por periodo**, no acumulado histórico como el actual
  `tokensUsed`; cuota por agente además de por tenant (hoy un agente puede comerse el cupo
  de sus hermanos). Migración esperada.
  *Depende de: H1. Bloquea: H6. Segundo blocker real de venta.*

- [ ] **H5 (P2.1) — `aa-portal-cliente`**: rol `client` + `User.tenantId` + scoping de
  sesión (hoy `User.role` es `admin|editor|viewer` sin `tenantId`,
  `back/prisma/schema.prisma:23`); vistas de sólo lectura de su agente, conversaciones y
  consumo, reutilizando `requireRole()` (`back/src/lib/auth.ts:107`).
  **El spec exige test negativo de aislamiento entre tenants.** Migración esperada.
  *Depende de: H3, H4.*

- [ ] **H6 (P2.2) — `aa-stripe-suscripciones`**: checkout, webhooks **idempotentes**,
  renovación de cupo por periodo, impago → `Tenant.isActive = false` (kill switch ya
  existente). **Dinero real ⇒ human gate obligatorio; no arrancar hasta P0/P1 verdes.**
  *Depende de: H4.*

## Verificaciones finales del plan maestro

- [x] **T9 — Engram**: auditoría + decisión de negocio + backbone persistidos como decisión
  de arquitectura (obs. 994 y 995; la 995 corrige a la 994 en el punto del metering).
- [ ] **T10 — Confirmar** con el humano por cuál hijo se arranca (recomendado: H1).

## Nota

Cada hijo es un openspec independiente y aplica la regla del repo: **DONE sólo con test
verde; sin spec, revertido.** Este plan maestro no genera artefactos de código.

Relación con el plan maestro anterior: `aa-agentes-rediseno-operativo` cubrió la **calidad**
del agente (H1-H8, cerrado salvo H7 diferido). Este eje cubre su **entrega y cobro**. Son
complementarios; ninguno sustituye al otro.
