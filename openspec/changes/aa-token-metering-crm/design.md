# Design: Token Metering CRM → AA

## Technical Approach

Secuencia real de `POST /service/operator/proyectos` (creador_CRM):
1. Validar token operador + confirmación (ya existe).
2. `tenantExists` + `calculateProjectCost(config)` → si `saldo (tokenBalance -
   tokensUsed) < costo`, **402** y NO se crea el proyecto (snapshot read, sin
   lock — carrera aceptada explícitamente en `spec.md`).
3. `createProjectService` (ya existe, transacción propia crm.*).
4. Proyecto creado con éxito → `chargeTokensForProject` (nuevo, best-effort,
   nunca revierte el proyecto si falla).
5. Respuesta 201 con `tokensDeducted` = costo calculado (ver Decisión 3).

Desviación relevante frente a `spec.md`: el código de `chargeTokensForProject`
/ `calculateProjectCost` NO vive en `agents-agency` como sugería la sección de
interfaces. Ver Decisión 4 — el repo real no permite ese import.

## Architecture Decisions

### Decisión 1 — Retry strategy

**Elegido**: replicar la FORMA de `withCodeRetry` (`agents-agency/back/src/lib/codes.ts:74-89`,
memoria `aa-codes-race-retry`: envolver cálculo+create juntos, `maxAttempts=3`),
no reutilizar el módulo (ver Decisión 4, es cross-repo). Nuevo helper local
`withTransientRetry` en creador_CRM back que envuelve la transacción COMPLETA
(update + insert) y reintenta solo sobre errores transitorios de
Prisma/Postgres (`P1001`, `P1017`, `P2024`, timeout de conexión). Un fallo de
regla de negocio (saldo insuficiente) no es transitorio: no se reintenta, se
propaga inmediatamente al log de fallo (Decisión 2/3).

**Alternativas descartadas**: reintentar sobre `P2002` como el original — no
aplica, aquí no hay carrera de código único, la operación es un UPDATE
aditivo + INSERT sin unique constraint en juego · reintentar indefinidamente —
contradice R2 (3× fijo) y puede enmascarar una BD caída de verdad.

**Razón**: mismo espíritu (aislar la operación crítica en una función
reintentable, cap en 3), condición de reintento distinta porque el problema es
distinto (conexión inestable, no carrera de secuencia).

### Decisión 2 — Logging verbosity

**Elegido**: SÍ se loguea (vía `console.error`, mismo estilo que el resto de
`service-operator.ts`, p.ej. línea 263 `[service-operator] error creando
proyecto:`): agotamiento de los 3 reintentos, y cualquier error de sistema no
esperado (excepción no-Prisma, conexión rota). Formato:
`[service-operator] fallo deduccion tokens: { tenantId, businessId, costo, error }`.
NO se loguea: cada deducción exitosa individual (eso vive solo en
`aa.uso_tokens`, tal como pide R3).

**Alternativas descartadas**: logger estructurado tipo pino (como
`agents-agency/back/src/lib/logger.ts`) — CRM back no tiene ese módulo, todo el
archivo usa `console.error` plano; introducir uno nuevo solo para esta feature
es inconsistente con el resto del router · log en éxito con nivel `debug` —
spec dice explícitamente "sin logs de deducción en stdout", éxito incluido.

**Razón**: consistencia con el estilo ya existente en el mismo archivo; el
ruido de stdout debe reservarse para lo accionable (fallo), igual que ya hace
el router en sus demás handlers.

### Decisión 3 — Fallo post-creación

**Elegido**: la mitigación que ya fija `spec.md` (`Risk`): solo log (Decisión 2)
+ reconciliación manual futura, sin infraestructura nueva. NO se añade
`tokensPending` a `Business` ni una cola de reconciliación. La respuesta HTTP
del alta de proyecto sigue siendo 201 con `tokensDeducted` = el costo
calculado (`calculateProjectCost`), IGUAL si la deducción real falló — el
operador no debe bloquearse ni ver un error de infraestructura interna; el
log de fallo (con `tenantId` + `businessId` + costo) es la única fuente para
reconciliar manualmente ese caso raro.

**Alternativas descartadas**: cola de reconciliación (BullMQ/pg-boss) — monta
infraestructura nueva para un caso ya aceptado como raro y sin volumen que lo
justifique (YAGNI, contradice R4 "TODO futuro") · `tokensPending: true` en
`Business` — requiere migración + UI + proceso de limpieza que nadie consume
todavía, mismo problema · devolver 5xx o marcar el proyecto como fallido —
viola R2 explícitamente ("NO deshacer proyecto") y confunde al operador con un
fallo que no es suyo (el proyecto SÍ se creó).

**Razón**: es la opción que ya aprobó el L1; no inventar mecanismo nuevo donde
el spec ya fijó "logging + dashboard futuro" como suficiente para el riesgo
aceptado.

### Decisión 4 — Ubicación del código

**Elegido**: `creador_CRM/back/src/lib/projects/token-charge.ts` (nuevo,
junto a `create-project-service.ts`, mismo dominio de alta de proyecto), NO
`agents-agency/back/src/lib/billing.ts` como proponía `spec.md`.

Evidencia: no hay workspace compartido (`package.json` raíz solo trae
`ngrok`, sin `pnpm-workspace.yaml`/`lerna.json`); `agents-agency` y
`creador_CRM` son despliegues Node independientes, cada uno con su propio
Prisma client generado (`lib/generated/prisma/client`) — CRM no puede
`import` código TS de AA en runtime. El propio CRM YA resuelve este límite
así: lee `aa.tenant` por `$queryRaw` cross-schema en su propio proceso
(`create-project-service.ts:76-80`, `routes/tenants.ts`, `routes/service-operator.ts:345`)
en vez de llamar a la API HTTP de AA o importar su código. `chargeTokensForProject`
sigue el mismo patrón: función local en CRM que hace `$transaction` con SQL
crudo contra `aa.tenant` (UPDATE) y `aa.uso_tokens` (INSERT, tabla no modelada
en el Prisma de CRM). `calculateProjectCost` se mueve con ella (función pura,
sin motivo para vivir en otro repo).

**Migración de schema**: `aa.uso_tokens` (modelo `TokenUsage`) hoy exige
`agentId`/`conversationId`/`model` NOT NULL y no tiene `operacion`/`contexto`
— no sirve tal cual para `crm_generate`. Esa migración la aplica
`agents-agency` (dueño Prisma del schema `aa`, ver memoria
`supabase-audit-estado`): añade `operacion String?`, `contexto Json?`,
relaja `agentId`/`conversationId` a opcionales. Permisos de escritura
cross-schema ya existen — `service_role` tiene `GRANT ALL` sobre
`SCHEMA aa` con `ALTER DEFAULT PRIVILEGES` (`agents-agency/db/01-supabase-setup.sql:16-28`),
así que no hace falta un grant nuevo para que CRM inserte en `aa.uso_tokens`.

**Alternativas descartadas**: exponer un endpoint HTTP en AA
(`POST /internal/token-charge`) y que CRM lo llame — añade latencia de red,
un nuevo secreto compartido y un punto de fallo de red donde hoy no hay
ninguno (mismo proceso/BD); mantener el código en AA y que CRM lo invoque por
un job/mensaje — sobre-ingeniería para una operación síncrona de bajo volumen.

**Razón**: seguir el precedente real del propio repo (cross-schema por SQL
crudo desde el proceso llamador) en vez de inventar un mecanismo de
integración nuevo que spec.md asumió sin verificar la topología real.

### Decisión 5 — Transacción atómica

**Elegido**: `db.$transaction` (mismo patrón que
`invoicesCreateHandler`/`lockBusinessForInvoicing` en
`creador_CRM/back/src/routes/service-operator.ts:403-411,444-454`): dentro de
una única transacción, `UPDATE aa.tenant SET tokens_usados = tokens_usados +
$costo WHERE id = $tenantId` (incremento aritmético atómico por fila, sin
necesitar `SELECT ... FOR UPDATE` — a diferencia de la numeración de facturas,
aquí no se lee un `COUNT` previo para derivar el valor nuevo) + `INSERT INTO
aa.uso_tokens (...)`. `withTransientRetry` (Decisión 1) envuelve la llamada a
`db.$transaction` completa.

**Alternativas descartadas**: `SELECT ... FOR UPDATE` sobre `aa.tenant` antes
del update — innecesario, el `UPDATE ... SET x = x + N` ya es atómico a nivel
de fila en Postgres sin lock explícito; usar solo `withCodeRetry` sin
transacción (dos escrituras sueltas: update + insert) — rompe R3 (registro
auditable siempre coherente con el descuento real): si el proceso muere entre
las dos escrituras, el saldo baja sin fila de auditoría o viceversa.

**Razón**: la transacción da atomicidad de las DOS escrituras (update +
insert); el retry (Decisión 1) da resiliencia frente a fallos transitorios de
conexión. Son responsabilidades distintas, ambas necesarias — `spec.md` ya
pide expresamente las dos ("`withCodeRetry` pattern" + "registro auditable").
