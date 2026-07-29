# Six Hats — F8-T3: escritura CRM + wizard conversacional

> Trigger: L4, "Requires new architecture" — abrir escritura en `creador_CRM` back
> (`crm_crear_proyecto`) + máquina de estado del alta paso a paso por Telegram.
> Orden fijo White→Red→Black→Yellow→Green→Blue. Salida Blue → insumo de `devil`.
> Fecha: 03/07/2026.

## White — hechos (Filesystem Scan)
- `POST /projects` (back CRM, `routes/projects.ts:105`) crea en 1 `$transaction`:
  Business + Location + BusinessSetting(config) + **Membership(role ADMIN, exige `userId`)**
  + VisitStates; valida `tenantExists`. Config = `TenantConfig`; columnas espejo (nombre/vertical/marca).
- `GET /projects` filtra por Membership del `userId` → sin membership, el proyecto NO aparece en el front.
- `/service/operator` (back CRM) es token-only, montado FUERA de `/api` (no pasa `authenticate`), hoy solo lectura.
- Mínimos de alta: tenant (obligatorio) + vertical (default `peluqueria`); módulos del preset; branding/db/datos omitibles (spike-f8).
- OpenClaw: chips nativos ya habilitados para Adrian; la sesión del agente (jsonl) sostiene el hilo; message tool re-pinta botonera por turno.

## Red — instinto
Duplicar `createProject` en un segundo endpoint da mal cuerpo: dos rutas de alta que divergen con el tiempo.
Y el `userId`: forzar un usuario "fantasma" para el Membership huele a parche que romperá el multi-usuario futuro.

## Black — crítica (insumo para devil)
- Reescribir la lógica de alta en el endpoint del operator = drift Front↔operator (Location/VisitStates/config se desincronizan). Deuda.
- Estado del wizard SOLO en contexto LLM = frágil ante reset de sesión/compaction; sin idempotencia, una doble confirmación crea 2 proyectos. Falta candado.
- `userId` hardcodeado (Adrian) en un endpoint token-only fuera de `/api`: si se hardcodea rompe multi-usuario; si se omite el Membership, el proyecto no aparece en `GET /projects`.

## Yellow — beneficios
Extraer el alta a un service compartido = una sola fuente de verdad (POST /projects y el operator llaman al mismo código, cero drift).
Alta de CRM por Telegram = valor real: Adrian genera proyectos sin abrir el front.

## Green — alternativas
- **A** Extraer `createProjectService({tenantId, userId, config})`; lo comparten `POST /projects` y un nuevo
  `POST /service/operator/proyectos` (token-only, gate `confirmado`→409 + auditoría). `userId` = owner CRM de Adrian
  resuelto por env (`OPERATOR_OWNER_USER_ID`, fail-closed). Estado del wizard en contexto LLM (chips re-pintados,
  TTL holgado) + idempotencia por clave (tenantId+nombre+ventana) contra doble-confirmación.
- **B** Endpoint sin Membership (proyecto huérfano) + asignación posterior. Descartada: rompe `GET /projects`.
- **C** Estado server-side (tabla `operator_wizard_state`) que persiste paso+selección. Más robusto, más peso.

## Blue — síntesis / recomendación
**A**, con idempotencia. Extraer el helper actual a `createProjectService` SIN cambiar comportamiento
(tests de caracterización de `POST /projects` ANTES de extraer). El operator escribe por el nuevo endpoint token-only,
misma disciplina que toda escritura del operator (confirmación en 2 pasos + `operator_audit`). `userId` = owner CRM
de Adrian por env, fail-closed si falta. Wizard en contexto LLM; escalar a **C** solo si el GATE muestra pérdida de estado.

→ devil audita: (1) resolución de `userId` e impacto multi-usuario, (2) idempotencia real del alta,
(3) que el service extraído no altere `POST /projects` (caracterización verde primero).
