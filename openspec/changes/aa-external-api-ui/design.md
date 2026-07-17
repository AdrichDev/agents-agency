# Design — aa-external-api-ui

SIN migración (columnas ya existen). Secreto de tenant → cifrado write-only.

## §A. Evidencia

- Columnas: `apiBaseUrl` (`schema.prisma:190`), `apiKeyEncrypted` (`:191`),
  `dbSchema.{businessId,locationId}` (`:188`), `capabilities` (`:193`).
- Cifrado ya usado en create: `service.ts:175` `apiKeyEncrypted: encryptToken(apiKey)`.
  Descifrado adapter: `managed-db.ts:347` `decryptToken(...)`. Helpers `oauth.ts:52/58`.
- PATCH actual `agents.ts:212-262`: schema solo `capabilities`+`notificationConfig`; guard
  external_api `:234-245` (permite, restringe a reservas/leads). NO escribe api*.
- Vista segura `service.ts:476-483`: sin `apiBaseUrl`, sin key.
- Front `BusinessDataPanel.tsx`: bloque capabilities+guardar solo `managed_db` (`:115-168`);
  external_api solo chip de modo. `MODE_LABEL` ya tiene "API externa" (`:9`).

## §B. F1 — PATCH acepta external_api

Ampliar `updateBackendSchema` (`agents.ts:212`) con campos opcionales:
```ts
mode: z.enum(["external_api"]).optional(),   // solo para switch none_yet→external_api
apiBaseUrl: z.string().url().optional(),
apiKey: z.string().optional(),               // write-only; "" o ausente = conservar
businessId: z.string().optional(),
locationId: z.string().optional(),
// capabilities ya existe (restringido a reservas/leads por el guard)
```
Handler:
- Cargar el `AgentDataBackend`. Si `mode:"external_api"` y el actual es `none_yet` o
  `external_api` → permitir. Si el actual es `managed_db` → **rechazar** el switch (400
  "El backend gestionado no se puede convertir a API externa aquí") para no romper la BD
  provisionada.
- Escribir: `apiBaseUrl` si viene; `apiKeyEncrypted = encryptToken(apiKey)` solo si
  `apiKey` no vacío (si vacío/ausente → no tocar la key = write-only); `dbSchema` merge
  `{businessId,locationId}`; `capabilities` (guard reservas/leads); `mode` si aplica el switch.
- No llamar provision. No tocar `dbUrlEncrypted`.
- Nunca loguear `apiKey`.

## §C. F2 — Vista segura

En la vista del backend (`service.ts:476-483`) añadir:
- `apiBaseUrl: backend.apiBaseUrl ?? null` (no secreto).
- `apiKeySet: Boolean(backend.apiKeyEncrypted)` (flag, no la key).
- `businessId`/`locationId` desde `dbSchema` (no secretos) si útiles al form.
**Nunca** `apiKeyEncrypted` ni la key en claro.

## §D. F3 — Front BusinessDataPanel (external_api)

Nuevo bloque condicional junto a `:115-168`:
- Si `mode === "none_yet"`: CTA "Usar API externa" → despliega el form (envía `mode:"external_api"`).
- Si `mode === "external_api"`: form con:
  - **URL base** (`apiBaseUrl`, prellenada desde la vista).
  - **API key**: input tipo password; si `apiKeySet` → placeholder `••••••••` + nota
    "Déjalo en blanco para conservar la actual"; si se escribe algo, se envía. Write-only.
  - **businessId / locationId** (opcionales; `locationId` requerido para reservas según el
    adapter — avisar si falta y hay `reservas`).
  - **Capabilities**: checkboxes reservas / leads (no pedidos).
  - **Guardar** → PATCH ampliado. Mensaje de éxito/error.
- Copy español llano. No mostrar nunca la key. Reusar estilos del bloque managed_db.

## §E. F4 (opcional) — Probar conexión

Botón "Probar" → endpoint backend que hace `GET {apiBaseUrl}/api/public/availability`
(vía `safeFetch`, con Bearer apiKey descifrada o la recién enviada) y reporta ok/fallo sin
filtrar la key. Si añade complejidad/tiempo → follow-up, no bloquea H6.

## §F. Tests (vitest back + front tsc)

- **F1**: PATCH con `mode:external_api`+apiBaseUrl+apiKey → persiste `apiBaseUrl` y
  `apiKeyEncrypted=encryptToken(...)`; `apiKey` vacío → conserva la anterior (write-only);
  `capabilities:["pedidos"]` → rechazado; switch desde `managed_db` → 400.
- **F2**: la vista segura devuelve `apiBaseUrl`+`apiKeySet` y NUNCA la key/cifrado.
- **F3**: `front tsc` verde; el form aparece en external_api, no en managed_db; la key es
  write-only (placeholder si set).
- **Seguridad**: la key nunca en la respuesta ni en logs.

Regla del repo: DONE solo con test verde.
