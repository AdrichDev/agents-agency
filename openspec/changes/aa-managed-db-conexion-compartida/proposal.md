# Proposal — aa-managed-db-conexion-compartida

## Intent

Quitar el rol Postgres per-agente y el aprovisionamiento de `managed_db`. El agente en modo
BD gestionada pasa a usar la **conexión normal de la app** (DATABASE_URL), scopeado por
`agentId` en código — como el resto de AA. Así desaparece la fricción de
`AGENT_BACKEND_ADMIN_DB_URL` + el paso "Aprovisionar", y un agente managed_db **funciona al
instante**, con reservas/leads en las **tablas de la plataforma** (consistente con la agenda).

## Justificación (auditoría `file:line`)

- El adapter managed_db abre un pool `pg` como rol per-agente vía `dbUrlEncrypted`
  (`managed-db.ts:55-60,363-367`) y throwea si falta (`:363-365`) → por eso exige
  aprovisionar (que exige la admin URL, `provisioning.ts:438-443`).
- Pero las tablas (`cita`,`lead`,`servicio_agente`,`franja_horaria`,`horario_agente`,
  `rango_bloqueo`) son **compartidas, scopeadas por `agente_id`** (`provisioning.ts:167-261`)
  y **ya existen en el schema `aa` de la app** (mismos `@@map`: `Lead:397`, `Service:584`,
  `Appointment`(cita), `TimeSlot`(franja_horaria)…).
- El adapter **ya bindea `agente_id` en cada escritura y filtra por `this.agentId` en cada
  lectura** (`managed-db.ts:230,240,273,154-198`). El aislamiento por agente ya está en código.
- Lo ÚNICO exclusivo del rol per-agente es la **RLS atada a `session_user`**
  (`provisioning.ts:268-374`) — defensa en profundidad, no requisito funcional.

Decisión (aprobada por el humano): el rol per-agente es **redundante**; se elimina de la
ruta managed_db. Se acepta el aislamiento por código + auth de la app (mismo modelo que
todo AA). Follow-up opcional: RLS por `SET app.current_agent` (sin rol per-agente) si se
quiere el candado a nivel BD más adelante.

## Scope

- **F1 — Adapter sobre conexión compartida:** `resolveAgentBackendAdapter` para managed_db
  usa un `SqlExecutor` construido desde `DATABASE_URL` (pool compartido, memoizado), no
  `dbUrlEncrypted`. Quitar el throw por `dbUrlEncrypted` ausente.
- **F1b — Cualificar el schema:** el SQL raw del adapter nombra las tablas con `aa.` (el
  search_path de la conexión de la app NO incluye `aa` — mismo gotcha que el fix del RAG;
  `::` cast y pooler no admiten `SET search_path` fiable → cualificar es lo robusto).
- **F2 — Flag/aprovisionamiento:** `provisioned` deja de depender de `dbUrlEncrypted`; para
  managed_db, el agente está listo sin aprovisionar. El endpoint `POST /:id/backend/provision`
  pasa a no-op idempotente (devuelve listo) para no romper llamadas; el flujo de rol/RLS
  (`provisioning.ts`) queda inerte (no se llama desde managed_db).
- **F3 — Front:** en la sección managed_db de `BusinessDataPanel`, quitar el botón
  "Aprovisionar" y el badge "Pendiente de aprovisionar"; mostrar "BD gestionada activa (usa
  la base de la plataforma)" + capacidades (reservas/leads/pedidos). El switch a managed_db
  (change previo) queda listo al instante.

## Fuera de scope
- Borrar el código de rol/RLS de `provisioning.ts` (queda inerte; limpieza aparte).
- RLS por `app.current_agent` (follow-up de defensa en profundidad).
- La config `external_api` (H6) y `none_yet` no cambian.

## Risks
- **SQL raw contra el schema `aa` real** (columnas/compatibilidad): mismo gotcha del RAG.
  Mitigación: cualificar con `aa.` + **prueba E2E en vivo contra prod** (crear reserva+lead
  reales, verificar en `aa.cita`/`aa.lead`, limpiar) ANTES de desplegar.
- **Seguridad**: managed_db escribe con la conexión de la app (privilegios amplios),
  aislado por `agentId` en código. Mismo modelo que el resto de AA (no un downgrade
  relativo). Documentar en sec-review.

## Dependencies
- `back/src/lib/agent-backend/managed-db.ts` (adapter, executor, SQL raw), `back/src/routes/agents.ts`
  (provisioned flag + provision endpoint), `back/src/lib/agent/service.ts` (provisioned en vista),
  `front/components/agents/BusinessDataPanel.tsx` (UI managed_db).
