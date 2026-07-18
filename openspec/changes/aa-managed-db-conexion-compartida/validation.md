# Validation — aa-managed-db-conexion-compartida

## User story

Como operador, quiero que un agente en modo BD gestionada funcione al instante (sin paso de
"Aprovisionar" ni credenciales admin en Render), guardando reservas/leads en la base de la
plataforma, porque los agentes son uniformes multi-tenant y el aislamiento por agentId ya se
hace en código.

## Acceptance criteria

- **AC1**: El adapter managed_db ejecuta sus queries con la conexión de la app
  (`DATABASE_URL`), no con un rol per-agente; ya no exige `dbUrlEncrypted`.
- **AC2**: El SQL raw del adapter cualifica las tablas con `aa.`, resolviendo pese a que el
  search_path de la app no incluye `aa`.
- **AC3**: Un agente managed_db aparece como listo (`provisioned:true`) sin aprovisionar; el
  endpoint provision es no-op idempotente y NO requiere `AGENT_BACKEND_ADMIN_DB_URL`.
- **AC4**: El front managed_db no muestra "Aprovisionar"/"Pendiente"; indica que la BD
  gestionada está activa y usa la base de la plataforma.
- **AC5 (aislamiento)**: cada escritura sigue bindeando `agente_id` y cada lectura filtra por
  el agente; no hay fuga entre agentes en la lógica. (Se pierde la RLS-por-rol; se acepta,
  igual que el resto de AA; follow-up: RLS por `app.current_agent`.)
- **AC6 (E2E vivo)**: crear una reserva y un lead reales vía el adapter managed_db con la
  conexión compartida los inserta en `aa.cita`/`aa.lead` con el `agente_id` correcto (probado
  contra prod y limpiado).
- **AC7 (regresión cero)**: external_api (H6), none_yet, el switch a managed_db, la agenda y
  los leads de la plataforma no cambian de comportamiento.

## Given-When-Then

**Escenario 1 (AC1+AC6):**
Given un agente en modo managed_db sin `dbUrlEncrypted`
When el agente ejecuta `crear_reserva` / `guardar_lead`
Then la reserva/lead se guarda en `aa.cita`/`aa.lead` con su `agente_id`, sin error de
"managed_db sin dbUrlEncrypted" y sin necesitar aprovisionar.

**Escenario 2 (AC3):**
Given un agente que pasa a managed_db
When se carga la ficha
Then figura como BD gestionada activa (provisioned true), sin paso de aprovisionar.

## Test por tarea
- T1.1/T1.2 → adapter usa DATABASE_URL + tablas `aa.`; bindeo agente_id intacto.
- T2.1 → provisioned true sin dbUrl; provision no-op sin admin URL.
- T3.1 → `front tsc`; sin botón Aprovisionar.
- T4.2 → E2E vivo: reserva+lead en aa.cita/aa.lead + limpieza.

Regla del repo: DONE con test verde + E2E vivo confirmado.
