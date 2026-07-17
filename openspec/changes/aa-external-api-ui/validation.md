# Validation — aa-external-api-ui

## User story

Como operador, quiero configurar desde la ficha del agente que use el CRM/API propio del
cliente (URL base + API key + reservas/leads), para aprovechar el adapter `external_api`
que ya existe pero hoy no puedo configurar por UI — sin exponer nunca la API key.

## Acceptance criteria

- **AC1**: `PATCH /api/agents/:id/backend` acepta y persiste, para `external_api`:
  `apiBaseUrl`, `apiKey` (cifrada con `encryptToken`), `businessId`, `locationId`,
  `capabilities∩{reservas,leads}`. Permite el switch `none_yet → external_api`.
- **AC2 (write-only key)**: si `apiKey` viene vacío/ausente → se conserva la existente
  (no se borra). La key **nunca** se devuelve por ninguna vista/endpoint; en la UI solo el
  indicador `apiKeySet`/`••••`.
- **AC3**: la vista segura del backend devuelve `apiBaseUrl` y `apiKeySet` (no la key);
  jamás `apiKeyEncrypted` ni la key en claro.
- **AC4**: `capabilities:["pedidos"]` se rechaza; el switch desde `managed_db` → 400 (no
  se rompe la BD provisionada).
- **AC5 (front)**: BusinessDataPanel muestra el form external_api (URL + apiKey write-only
  + capabilities) solo en modo external_api / CTA desde none_yet; managed_db intacto.
- **AC6 (regresión cero)**: la creación con external_api (que ya cifraba en `service.ts:175`)
  y la config managed_db/capabilities/notificationConfig siguen funcionando.
- **AC7 (seguridad)**: apiKey cifrada AES-256-GCM, nunca en logs ni respuestas;
  `apiBaseUrl` validada como URL.

## Given-When-Then

**Escenario 1 (AC1+AC2):**
Given un agente en modo none_yet
When PATCH backend con mode=external_api, apiBaseUrl, apiKey="k1", capabilities=[reservas]
Then se guarda apiBaseUrl, apiKeyEncrypted=encryptToken("k1"), mode=external_api; y un
segundo PATCH con apiKey="" conserva "k1".

**Escenario 2 (AC3 — no leak):**
Given un agente external_api con key
When se carga la vista segura del backend
Then trae apiBaseUrl y apiKeySet=true, y en ningún campo aparece la key ni su cifrado.

**Escenario 3 (AC4 — no romper managed_db):**
Given un agente en managed_db (provisionado)
When PATCH intenta mode=external_api
Then 400 y nada cambia.

## Test por tarea
- T1.1 → persiste+cifra; write-only; pedidos rechazado; switch managed_db→400.
- T2.1 → vista con apiBaseUrl+apiKeySet, sin key.
- T3.1 → `front tsc`; form en external_api, key write-only.

Regla del repo: DONE solo con test verde; sin spec, revertido.
