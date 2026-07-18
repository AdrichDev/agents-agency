# Validation — aa-backend-datos-switch-y-ayuda

## User story

Como operador que creó un agente "solo informa" (none_yet), quiero poder activar luego la
BD gestionada (nuestra BD) desde el panel, sin regenerar el agente; y quiero que el
formulario de API externa me explique qué es cada campo y qué sistema conecta.

## Acceptance criteria

- **AC1 (F1)**: desde `none_yet`, un CTA "Usar base de datos gestionada" cambia el modo a
  `managed_db` (PATCH `{mode:"managed_db"}`) y aparece la UI de managed_db (capacidades +
  botón Aprovisionar). El switch solo fija el modo; NO aprovisiona por sí solo.
- **AC2 (F1)**: el backend acepta `mode:"managed_db"` en el PATCH desde `none_yet`/
  `external_api`; sigue rechazando (400) salir de `managed_db` (no tira la BD aprovisionada).
- **AC3 (F2)**: el formulario external_api muestra ayuda: el contrato `/api/public/*` ("no
  es una BD cruda") + qué es URL base, API key, Business ID y Location ID (obligatorio para
  reservas).
- **AC4 (regresión cero)**: el switch a external_api y la escritura cifrada de apiKey (H6)
  siguen igual; managed_db provisioning (endpoint aparte) no cambia; la apiKey nunca se fuga.

## Given-When-Then

**Escenario 1 (AC1+AC2):**
Given un agente en modo `none_yet`
When pulso "Usar base de datos gestionada"
Then el modo pasa a `managed_db` (sin aprovisionar aún) y veo capacidades + "Pendiente de
aprovisionar" + botón Aprovisionar.

**Escenario 2 (AC2 — no romper managed_db):**
Given un agente en `managed_db` (aprovisionado)
When se intenta PATCH mode a external_api/none_yet
Then 400 y nada cambia.

## Test por tarea
- T1.1 → none_yet→managed_db persiste modo sin provision; salir de managed_db → 400; external_api→managed_db OK.
- T1.2/T2.1 → `front tsc` verde; CTA presente; ayudas presentes.

Regla del repo: DONE con test verde (+ HITL visual).
