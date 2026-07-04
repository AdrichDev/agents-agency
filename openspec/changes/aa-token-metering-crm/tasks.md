# Tasks — aa-token-metering-crm

Fuente canonica: `spec.md` + `design.md`. Cambio pequeno, 2 repos sin workspace
compartido (`agents-agency` dueno del schema `aa` via Prisma; `creador_CRM` hace
todo el runtime cross-schema por SQL crudo, ver Decision 4 de `design.md`). No
hay codigo compartido en memoria/proceso entre ambos: son 2 commits/PRs
separados (uno por repo) que forman UN solo cambio logico.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~150-250 (migracion AA ~20-30 lineas + token-charge.ts ~80-120 + integracion handler ~20-30 + tests ~80-100) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | 2 PRs por repo (AA: migracion; CRM: token-charge + integracion + tests), sin cadena — cada uno cabe solo |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending (no aplica: sin cadena recomendada) |

Decision needed before apply: Si — ver **Nota abierta AC4** mas abajo, resolver
antes de dar T3/T4 por completos.
Chained PRs recommended: No
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| WU1 | Migracion `aa.uso_tokens` (agents-agency) | PR agents-agency | Prisma owner del schema `aa`; sin este cambio CRM no puede insertar filas `crm_generate`. |
| WU2 | `token-charge.ts` (creador_CRM) | PR creador_CRM #1 | `calculateProjectCost` + `withTransientRetry` + `chargeTokensForProject`, sin integrar aun. |
| WU3 | Integracion en `POST /service/operator/proyectos` | PR creador_CRM #2 (o mismo PR que WU2 si cabe en presupuesto) | Depende de WU1 (columnas) y WU2 (funciones). |
| WU4 | Tests AC1-4 + retry | mismo PR que WU3 | No hay "hecho" sin test verde (regla SDD). |

## Nota abierta — AC4 ("admin sin tenantId")

`spec.md` R1/AC4 asume que un alta SIN `tenantId` existe y debe deducir "del
token del operador (Adrian)". Verificado en `crearProyectoHandler`
(`creador_CRM/back/src/routes/service-operator.ts:239-245`): el handler SIEMPRE
resuelve un `tenantId` (de `body.tenantId` o, si falta, de
`config.business.clienteId`) y devuelve **422 `tenant_required`** si ninguno
esta presente — no existe hoy un camino donde el alta continua sin `tenantId`.
No hay concepto de "tenant del operador": `OPERATOR_OWNER_USER_ID` es un
`usuario` CRM (dueno del `Membership`), no un `aa.tenant.id`.

**Decision para T3/T4**: AC4 se reinterpreta como "el `tenantId` resuelto por
fallback (`config.business.clienteId`, sin venir en el body top-level) tambien
se cobra correctamente" — NO como "deducir de una cuenta propia del operador"
(esa cuenta no existe en el modelo de datos actual). Si el negocio quiere de
verdad un modo "sin tenant, cobra al operador", eso es un cambio de spec nuevo
(requiere un `aa.tenant` fila para el operador o una excepcion explicita de
"no cobrar") — fuera de alcance de este PR. Marcar en el commit/PR que AC4 se
implementa con esta lectura, para que el usuario la confirme o la corrija.

## WU1 — Migracion `aa.uso_tokens` (agents-agency)

- [x] **T1.1** — En `agents-agency/back/prisma/schema.prisma`, model `TokenUsage`:
  anadir `operacion String? @map("operacion")` y `contexto Json? @map("contexto")`;
  relajar `agentId`, `conversationId`, `model` a opcionales (`String?`) — hoy son
  NOT NULL y `crm_generate` no tiene agente/conversacion/modelo LLM asociados. HECHO.
- [x] **T1.2** — DESVIACION JUSTIFICADA: NO se uso `prisma migrate dev`. El schema
  real de AA vive por `prisma db push` + SQL numerado en `db/` (las migraciones
  `prisma/migrations/` estan drifteadas tras el rename es de `db/05`; `migrate dev`
  intentaria un reset masivo). Se creo `agents-agency/db/07-aa-uso-tokens-metering.sql`
  siguiendo la convencion de `db/04-06`: aditiva y transaccional (`ADD COLUMN IF NOT
  EXISTS operacion/contexto` + `ALTER COLUMN ... DROP NOT NULL` en agente_id/
  conversacion_id/modelo), sin `DROP`/perdida de datos. PENDIENTE: aplicarla contra
  Supabase manualmente (igual que db/04-06), lo hace el usuario.
- [x] **T1.3** — Verificado: `service_role` ya tiene `GRANT ALL ON ALL TABLES IN
  SCHEMA aa` + `ALTER DEFAULT PRIVILEGES` (`db/01-supabase-setup.sql:19,25-26`). No
  hace falta grant nuevo; no se toco SQL de permisos.
- [x] **T1.4** — `npx prisma generate` en agents-agency/back: OK (sin EPERM,
  cliente 7.8.0 regenerado). No hizo falta `--no-engine`.

## WU2 — `token-charge.ts` (creador_CRM)

- [x] **T2.1** — Crear `creador_CRM/back/src/lib/projects/token-charge.ts`:
  `calculateProjectCost(config: ProjectConfig): number` — `100 + (config.modules?.length ?? 0) * 50`,
  funcion pura (ver `spec.md` Interfaces).
- [x] **T2.2** — En el mismo archivo, `withTransientRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T>` —
  misma FORMA que `withCodeRetry` (`agents-agency/back/src/lib/codes.ts:74-89`)
  pero la condicion de reintento es sobre codigos Prisma/Postgres transitorios
  (`P1001`, `P1017`, `P2024`, timeout de conexion), NO `P2002` (Decision 1 de
  `design.md`). Un error no-transitorio (incl. logica de negocio) se propaga
  de inmediato sin reintentar.
- [x] **T2.3** — En el mismo archivo, `fetchTenantBalance(db, tenantId): Promise<{ saldo: number } | null>` —
  `$queryRaw` contra `aa.tenant` (`saldo_tokens - tokens_usados`), devuelve
  `null` si no hay fila (deja que `createProjectService`/`tenantExists` sea la
  UNICA fuente del error `tenant_not_found`, para no duplicar ese caso con un
  codigo de error distinto).
- [x] **T2.4** — `chargeTokensForProject(db, tenantId, cost, context: { projectId: string; modulesCount: number }): Promise<void>` —
  envuelta en `withTransientRetry`, hace `db.$transaction` con: `UPDATE aa.tenant
  SET tokens_usados = tokens_usados + $cost WHERE id = $tenantId` (incremento
  atomico por fila, sin `SELECT ... FOR UPDATE`, Decision 5) + `INSERT INTO
  aa.uso_tokens (id, tenant_id, operacion, tokens, contexto, creado_en) VALUES
  (gen_random_uuid()/cuid, $tenantId, 'crm_generate', $cost, $context::jsonb, now())`.
  Nunca lanza al caller si el retry se agota — captura, loguea (T3.4) y retorna
  (best-effort, Decision 3: fallo post-creacion NO revierte el proyecto).

## WU3 — Integracion en `POST /service/operator/proyectos`

- [x] **T3.1** — En `crearProyectoHandler` (`creador_CRM/back/src/routes/service-operator.ts`),
  tras resolver `tenantId` (linea ~243) y tras el chequeo de idempotencia
  (linea ~254, solo si NO hay `existing` — un duplicado devuelto no cobra),
  insertar: `calculateProjectCost(config)` + `fetchTenantBalance` → si
  `balance !== null && balance.saldo < costo` → **402** `{ error: { code:
  'insufficient_tokens', message: '...' } }`, SIN crear el proyecto. Si
  `balance === null` (tenant no existe), NO cortar aqui — dejar que
  `createProjectService` (linea ~257) devuelva su 422 `tenant_not_found` ya
  existente (single source of truth para ese caso, evita duplicar el check).
- [x] **T3.2** — Tras `createProjectService` devolver `ok: true` (linea ~258+),
  llamar `chargeTokensForProject(prisma, tenantId, costo, { projectId:
  result.business.id, modulesCount: config.modules?.length ?? 0 })`. NO usar
  `await` bloqueante que pueda tumbar la respuesta 201 si falla — el catch de
  `chargeTokensForProject` ya absorbe el error (T2.4); solo esperar a que
  termine (o no, si se decide fire-and-forget — decidir en review: Decision 3
  dice "log + reconciliacion manual", no exige bloquear la respuesta, pero SI
  exige que el intento se haga sincronamente antes del `res.status(201)` para
  no perder el intento si el proceso muere justo despues de responder — usar
  `await`).
- [x] **T3.3** — Anadir `tokensDeducted: costo` a la respuesta 201 (linea ~261) —
  SIEMPRE el costo calculado, aunque `chargeTokensForProject` haya fallado en
  silencio (Decision 3: el operador no debe ver un error de infraestructura
  interna en un proyecto que SI se creo).
- [x] **T3.4** — Logging de fallo: `console.error('[service-operator] fallo
  deduccion tokens:', { tenantId, businessId, costo, error })` SOLO si
  `withTransientRetry` agota los 3 intentos o hay un error no-Prisma inesperado
  (Decision 2). NUNCA loguear una deduccion exitosa (vive solo en `aa.uso_tokens`).

## WU4 — Tests (AC1-4 de `spec.md`)

- [x] **T4.1 (AC1)** — `POST /proyectos` con saldo suficiente → 201 + `tokensDeducted`
  correcto + fila `aa.uso_tokens` creada (verificar via doble de `$transaction`/
  `$queryRaw`, patron DI existente en `service-operator-crear-proyecto.test.ts`).
- [x] **T4.2 (AC2)** — `POST /proyectos` con saldo `< costo` → 402
  `insufficient_tokens` + 0 llamadas a `createProjectService`/`chargeTokensForProject`
  (verificar que el double de creacion NUNCA se invoca).
- [x] **T4.3 (AC3)** — Fila insertada en `aa.uso_tokens` tiene `operacion:
  'crm_generate'`, `tokens: costo`, `contexto: { projectId, modulesCount }`,
  `creado_en` presente.
- [x] **T4.4 (AC4, con la lectura de la Nota abierta — CONFIRMADA)** — `tenantId` ausente en
  body pero presente en `config.business.clienteId` → se resuelve y se cobra
  sobre ESE tenantId (fallback ya existente en el handler, T3.1-T3.2 lo cubren
  sin cambio adicional — el test solo lo fija en caracterizacion). AC4 en spec.md
  actualizado con esta lectura tras revision.
- [x] **T4.5** — `withTransientRetry`: reintenta sobre error simulado `P1001`
  (hasta 3x, exito en el intento N) y NO reintenta sobre error de negocio
  (propaga inmediato).
- [x] **T4.6** — Fallo total de `chargeTokensForProject` (3 intentos agotados)
  NO revierte el proyecto: `POST /proyectos` sigue devolviendo 201 con
  `tokensDeducted` (Decision 3), y se loguea exactamente una vez (T3.4).
- [x] **T4.7** — AA no tiene patron de test de esquema (tests via vitest, sin
  `prisma migrate diff` en CI). Garantia por construccion: `db/07` usa solo
  `ADD COLUMN IF NOT EXISTS` + `ALTER COLUMN ... DROP NOT NULL` (cero `DROP` de
  tabla/columna, cero reescritura de filas), transaccional → sin perdida de datos
  en `uso_tokens`. La suite AA completa (543 pass / 3 skip) sigue verde tras
  relajar los campos a nullable.

## Verificacion final

- [x] tsc limpio en ambos repos: `agents-agency/back` (tsc --noEmit OK) y
  `creador_CRM/back` (tsc --noEmit OK).
- [x] Test suite verde: `creador_CRM/back` 378 pass / 0 fail (node:test, incluye
  los nuevos AC1-4 + retry + soft-fail); `agents-agency/back` 543 pass / 3 skip
  (vitest — es el runner real de AA; WU1 no anade tests, solo schema+SQL).
- [x] Revision fresca (Ruflo, Opus worktree aislado) — 2 revisiones separadas.
  AA: LIMPIO. CRM: APROBADO con 1 LOW (fetchTenantBalance sin filtro activo=true,
  CORREGIDO antes de commit). Commits: agents-agency 4eb8513, creador_CRM 228d369.
  Ambos pusheados a origin.
- [x] Lectura de AC4 confirmada (ver Nota abierta) y reflejada en spec.md.

## Pendiente fuera de este cambio (accion manual del usuario)

- [ ] Aplicar `agents-agency/db/07-aa-uso-tokens-metering.sql` a Supabase antes
  de que el cobro real funcione en produccion (hasta entonces falla en runtime
  pero se absorbe best-effort, sin romper la creacion de proyectos).
