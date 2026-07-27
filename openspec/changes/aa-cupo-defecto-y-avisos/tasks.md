# Tareas — aa-cupo-defecto-y-avisos (H7)

**Nivel 3.** Sin migración. Cambia el gate que decide si un agente responde en producción ⇒ revisión
obligatoria antes de commit, sin push.

**Orden crítico:** T1 → T2 → T3 → T4 → T5. T1 antes de T2 porque el gate deja de lanzar el 402 sólo
cuando la resolución ya devuelve un cupo real; al revés habría un momento en el que el gate no corta
y tampoco hay tope.

---

## T1 — Resolución con defecto

- [x] **T1.1** `DEFAULT_TOKEN_QUOTA_PER_AGENT = 10_000_000` en `back/src/lib/quota.ts`, con el
  comentario del design §A (medición del 27/07/2026 y el vínculo con `PLAN_TOKENS`).
- [x] **T1.2** `QuotaSource`: quitar `"none"`, añadir `"default"`. Igual en `AgentQuotaSource`.
- [x] **T1.3** `resolveTokenQuota` — la rama `if (!tenant.plan)` (hoy línea 62) devuelve
  `{limit: DEFAULT × Math.max(1, billableAgents), source: "default"}`. El orden override → plan →
  defecto no se toca.
- [x] **T1.4** `quotaNeedsAgentCount` — `return true` cuando `!tenant.plan` (design §B.3).
- [x] **T1.5** `resolveAgentQuota` — separar la rama que hoy junta "sin plan" y "plan sin tope"
  (línea 106): sin plan ⇒ `{limit: DEFAULT, source: "default"}`; plan con `tokenQuotaPerAgent = null`
  ⇒ `{limit: null, source: "none"}` **sin cambios** (sin tope, como fijó H4 T5). `"none"` sobrevive en
  `AgentQuotaSource` porque ahí sigue siendo alcanzable y significa *sin tope*, no *bloqueado*.
- [x] **T1.6** Test `back/tests/cupo-defecto-resolucion.test.ts` — AC1 a AC5 y AC12 (E1, E2).
  **Incluye obligatoriamente el caso `tokenBalance = 0` ⇒ sigue 0** (R1: el kill switch no se
  invierte).

## T2 — Gate

- [x] **T2.1** `back/src/lib/token-metering.ts` — quitar `if (source === "none") throw new
  HttpError(402, MSG_SIN_PLAN)` (línea 112) y la constante `MSG_SIN_PLAN`. `MSG_SUSPENDIDO`,
  `MSG_CUOTA` y `MSG_CUOTA_AGENTE` se quedan.
- [x] **T2.2** Verificar que el bloque BYOK (línea 109) sigue saltándose todo esto: con
  `credentialMode = "byok"` no hay cupo, ni recuento, ni tope de agente. **Nada que cambiar aquí; se
  comprueba, no se toca.**
- [x] **T2.3** Test `back/tests/cupo-defecto-gate.test.ts` — AC6 (el 402 de "sin plan" ya no existe) y
  AC7 (E3: el agente que se pasa se corta y sus hermanos siguen respondiendo).
- [x] **T2.4** Actualizar los tests de H4 que aserten `MSG_SIN_PLAN` o `source: "none"`. Son cambios
  de comportamiento **deliberados**: se reescribe la expectativa, no se borra el test.

## T3 — Umbrales de aviso

- [x] **T3.1** `QuotaWarning` y `quotaWarningLevel(used, limit)` en `back/src/lib/quota.ts`, tal cual
  el design §C. Función pura, sin base de datos.
- [x] **T3.2** Test `back/tests/cupo-avisos-umbrales.test.ts` — AC8, AC9, AC10 (E4, E5). Casos
  frontera exactos: 749/750/899/900/999/1000, `limit = null`, `limit = 0`.

## T4 — Superficie back + coherencia del número

- [x] **T4.1** `back/src/routes/clients.ts:33` — `withQuota()` añade `quotaWarning` calculado con
  `quotaWarningLevel(client.tokensUsedPeriod, limit)`. Verificar que el `select` de la ruta ya trae
  el consumo del periodo; si no, añadirlo. **Corregido en revisión:** en `credentialMode = "byok"` el
  aviso sale `null`, no `"ok"`. Allí el gate no mira cupo ni incrementa contadores, así que cualquier
  nivel sería un porcentaje contra un tope que no se aplica; un cliente que pasa de `platform` a
  `byok` con el periodo consumido saldría con "90% CONSUMIDO" y el operador le recargaría tokens que
  no necesita.
- [x] **T4.2** Test `back/tests/cupo-defecto-front-back-coherencia.test.ts` — AC11 (E6): lee
  `front/components/presupuestos/types.ts` desde disco, extrae `PLAN_TOKENS` y lo compara con
  `DEFAULT_TOKEN_QUOTA_PER_AGENT`. Mismo recurso que H4 T4.1.
- [x] **T4.3** (añadida en revisión) Test `back/tests/cupo-avisos-superficie.test.ts` — `GET
  /api/clients` sobre la ruta real: el aviso se mide contra el consumo del periodo y no contra el
  acumulado de por vida, el freno de mano sale `exhausted` con cupo 0, y `byok` sale sin aviso.

## T5 — Panel de Clientes

- [x] **T5.1** `front/components/clientes/types.ts:27` — `quotaSource: "override" | "plan" |
  "default"`. Nuevo `quotaWarning?: "ok" | "warn75" | "warn90" | "exhausted"`.
- [x] **T5.2** `front/components/clientes/ClientRow.tsx` — quitar `noPlan` (línea 46) y la etiqueta
  `SIN PLAN` (línea 94). `SIN TOPE` (línea 75) se queda. Añadir el aviso: `warn75` ámbar, `warn90`
  rojo, `exhausted` con el `BLOQUEADO` que ya existe.
- [x] **T5.3** Enseñar el origen del número: `default` no se pinta igual que `override` (design §D.2
  — 10M por política y 10M puesto a mano se arreglan de formas distintas).
- [x] **T5.4** `npx tsc --noEmit` en `front/`. **No levantar `next dev`** en la carpeta del usuario.

## Verificaciones finales

- [x] `npx tsc --noEmit` en `back/` y en `front/`.
- [x] Suite completa de `back/` verde: **126 ficheros / 1386 tests** (referencia: 121 / 1325 antes de
  este change).
- [x] `npx prisma migrate status` sin drift (**no hay migración nueva**; se comprueba que sigue
  limpio).
- [x] Comprobar en producción que los 4 tenants con `saldo = 0` (Telecom Madrid, Comercial Demo IA,
  Estudio Lúa, JorjotasBarber) siguen resolviendo cupo `0`. Es consulta de lectura, no escritura.
- [x] Revisión antes de commit. **Sin push.** Dos correcciones salidas de ahí: el aviso `null` en
  `byok` (T4.1) y el bloque JSDoc huérfano que dejó la retirada de `MSG_SIN_PLAN` en
  `token-metering.ts`.
- [x] Resumen de scope caveman + guardado en Engram (`architecture:aa-cupo-defecto-y-avisos`).

## Lo que este change NO hace (declarado, no olvidado)

1. **No notifica.** Los avisos del 75% y 90% son de **lectura** en el panel. No hay email ni
   Telegram: eso exige guardar qué aviso ya se envió para no repetirlo en cada mensaje, y es un
   change con estado propio.
2. **No vende recargas.** `tokens_5m` (17€) y `tokens_10m` (30€) están en el catálogo y siguen sin
   conectar. Es H6.
3. **No siembra filas en `plan`.** La tabla sigue vacía y con este change deja de hacer falta.
4. **No toca BYOK.** Ya cumple lo pedido: sin cobro y sin contador (`token-metering.ts:109` y `:268`).
5. **No unifica los catálogos de precios duplicados** (`front/components/presupuestos/types.ts:20`
   vs `back/src/lib/service-catalog.ts:14`, ya divergentes). Deuda registrada en H5 R5.
6. **No mete el modo de credenciales en el asistente de creación de agentes.** `credentialMode` vive
   en `Tenant`, se gestiona en Clientes, y así evita que un cliente tenga el agente A con su clave y
   el B con la nuestra.
