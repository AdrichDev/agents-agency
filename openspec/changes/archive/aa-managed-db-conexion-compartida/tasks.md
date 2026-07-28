# Tasks — aa-managed-db-conexion-compartida

Tests **vitest** (back) + front `tsc` + **E2E en vivo contra prod** (HITL/Gru). SIN
migración (las tablas ya existen en `aa`). DONE con verde.

## F1 — Adapter managed_db sobre conexión compartida

> PIVOTE (post-E2E): la E2E revelo que el SQL raw + cualificacion `aa.` (T1.1/T1.2)
> apuntaba a un schema OBSOLETO (columnas inexistentes: `lead.intencion`,
> `cita.agente_id`). Decision aprobada: en vez de SQL propio, el adapter usa los
> MODELOS Prisma reales + la logica de booking real de AA (helpers compartidos).
> T1.1/T1.2 (enfoque SQL) quedan SUPERSEDED por T1.3/T1.4.

- [x] ~~**T1.1 — Executor desde DATABASE_URL** (SQL raw)~~ SUPERSEDED por T1.4.
- [x] ~~**T1.2 — Cualificar tablas con `aa.`** en el SQL raw~~ SUPERSEDED por T1.3/T1.4
  (ya no hay SQL raw; `sql-templates.ts` borrado).
- [x] **T1.3 — Helpers de booking reusables.** Extraidos a `lib/booking/appointments.ts`:
  `computeAvailableSlots(serviceId,{desde,hasta})`, `createAppointment({serviceId,slotStart,
  slotEnd,email?,phone?,notes?,leadId?})`, `cancelAppointment(appointmentId)`. Los endpoints
  de `routes/booking.ts` (/slots, /reserve, /:id/cancel) se refactorizan para llamarlos
  (behavior-preserving; tests verdes).
  - Test: `tests/booking-appointments.test.ts` (12 casos) + `booking-reschedule.test.ts` verde.
- [x] **T1.4 — Reescribir ManagedDbAdapter con Prisma.** El adapter opera sobre los modelos
  reales (`Service`, `TimeSlot`, `Appointment`, `Lead`) via Prisma y los helpers de T1.3.
  `resolveAgentBackendAdapter` construye `new ManagedDbAdapter(agentId, capabilities)` sin
  executor ni `dbUrlEncrypted`. `guardarLead` usa `customerName`/`agentId` (NO `intencion`).
  Aislamiento por `agentId` preservado (servicio scopeado, lead con agentId, cancel verifica
  pertenencia). external_api y none_yet intactos. `sql-templates.ts` borrado.
  - Test: `tests/managed-db-adapter.test.ts` reescrito (26 casos, mock prisma) verde.

## F2 — Flag + endpoint provision

- [x] **T2.1 — `provisioned` sin dbUrlEncrypted.** Para managed_db, `provisioned` = true
  (listo) sin depender de `dbUrlEncrypted`. Actualizar el cálculo en `agents.ts:322` y
  `service.ts:573`. `POST /:id/backend/provision` → no-op idempotente (devuelve listo), sin
  llamar al rol/RLS de provisioning.ts.
  - Test: agente managed_db → `provisioned:true` sin dbUrlEncrypted; provision endpoint no
    llama a provisionManagedDbBackend / no exige admin URL.

## F3 — Front managed_db

- [x] **T3.1 — Quitar Aprovisionar.** En BusinessDataPanel sección managed_db: quitar botón
  "Aprovisionar" + badge "Pendiente de aprovisionar"; mostrar "BD gestionada activa (usa la
  base de la plataforma)" + capacidades. No romper el switch a managed_db ni external_api/none_yet.
  - Test: `front tsc` verde.

## Verificaciones finales

- [x] **T4.1 — Typecheck + suite** (`back` vitest+tsc, `front` tsc) verde. — verificado: Engram #993 (suite 1031 verde, `tsc` limpio)
- [x] **T4.2 — E2E EN VIVO (Gru, contra prod):** vía script tsx (carga .env, importa
  adapter) → managed_db adapter con la conexión compartida: crear una reserva + un lead de
  prueba para un agente real, verificar que aparecen en `aa.cita`/`aa.lead` scopeados por
  agente_id, y BORRAR las filas de prueba. Confirma que el SQL cualificado resuelve. — verificado: Engram #993, prueba de punta a punta EN VIVO contra producción (72 huecos de disponibilidad, reserva escrita en `aa.cita`, lead en `aa.lead`, limpieza confirmada); commit 49392ca empujado
- [x] **T4.3 — sec-review:** aislamiento por agentId en código intacto (bindeo agente_id en
  escrituras, filtro en lecturas); se documenta la pérdida de RLS-por-rol y el follow-up
  (app.current_agent). No fuga entre agentes en la lógica. — verificado: `back/src/lib/agent-backend/managed-db.ts:83` (consulta de servicio filtrada por `agentId`), `:136` (la cancelación comprueba la pertenencia vía `service.agentId`), `:154` (el lead se escribe con `agentId`) y `:199-231` (el adaptador se construye por `agentId`, sin `dbUrlEncrypted`)
- [x] **T4.4 — Engram.** — verificado: Engram #993 (architecture, 18/07/2026) es la persistencia de la decisión

## Notas
- SIN migración. provisioning.ts (rol/RLS) queda inerte, no se borra (limpieza aparte).
- Follow-up defensa en profundidad: RLS por `SET app.current_agent` sin rol per-agente.

## Cierre — 28/07/2026

Cierre completo: las cuatro casillas quedan marcadas con prueba, incluida una verificación de punta a punta ejecutada en vivo contra producción con limpieza posterior. El aislamiento por `agentId` está verificado línea a línea.
