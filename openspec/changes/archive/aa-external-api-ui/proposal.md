# Proposal — aa-external-api-ui

Hijo H6 del plan maestro `aa-agentes-rediseno-operativo` (P2, cerrar features a medias).

## Intent

El backend de datos `external_api` (que el agente use el CRM/API propio del cliente en vez
de una BD gestionada) tiene el **adapter completo** (`external-api.ts` → `POST
/api/public/leads`, `GET /api/public/availability`, `POST /api/public/bookings`) y ya se
cifra en la CREACIÓN (`service.ts:175`). Pero **no hay UI post-creación** que configure la
URL + API key → el modo es inalcanzable en la práctica salvo al crear. H6 añade el
formulario para configurarlo desde la ficha del agente.

## Descubrimiento (auditoría `file:line`)

- Modelo `AgentDataBackend` YA tiene las columnas: `apiBaseUrl` (`schema.prisma:190`),
  `apiKeyEncrypted` (`:191`, cifrada), `dbSchema.{businessId,locationId}` (`:188`),
  `capabilities` (`:193`). **Sin migración.**
- Adapter lee: `apiBaseUrl`, `dbSchema.businessId/locationId`, `decryptToken(apiKeyEncrypted)`,
  `capabilities∩{reservas,leads}` (`managed-db.ts:339-360`). `pedidos` nunca (honesto).
- **Falta backend**: PATCH `/:id/backend` (`agents.ts:212-262`) solo acepta
  `capabilities`+`notificationConfig`; NO escribe `apiBaseUrl`/`apiKey`. Cifrado a reusar:
  `encryptToken`/`decryptToken` (`oauth.ts:52,58`), el mismo de la creación.
- **Falta vista**: la vista segura (`service.ts:476-483`) no devuelve `apiBaseUrl`; la key
  jamás se devuelve (enmascarada).
- **Falta front**: `BusinessDataPanel` solo tiene UI para `managed_db` (`:115-168`);
  external_api solo muestra el chip de modo. Wizard `DataBackendStep` solo ofrece
  `managed_db`/`none_yet` (external_api = backlog, `DataBackendStep.tsx:9`).
- `external_api` NO necesita provision (eso es de managed_db, `agents.ts:278`).

## Scope

- **F1 Backend — PATCH acepta external_api:** ampliar `updateBackendSchema` + handler
  (`agents.ts:212-262`) para aceptar, cuando el modo es/pasa a `external_api`:
  `apiBaseUrl`, `apiKey` (→ `encryptToken`), `businessId`, `locationId` (→ `dbSchema`),
  `capabilities∩{reservas,leads}`. Permitir el switch `none_yet → external_api` (sin tocar
  el flujo de `managed_db`/provision). `apiKey` **write-only**: en blanco = conserva la
  existente; nunca se devuelve.
- **F2 Backend — vista segura:** añadir `apiBaseUrl` (no secreto) y un flag
  `apiKeySet: boolean` a la vista del backend (`service.ts:476-483`); **nunca** la key.
- **F3 Front — form en BusinessDataPanel:** bloque `mode === "external_api"` (y un CTA
  "Usar API externa" si `none_yet`): inputs URL base + API key (enmascarada `***` si ya hay,
  write-only) + businessId/locationId (opcionales) + checkboxes reservas/leads + Guardar.
  Llama al PATCH ampliado.
- **F4 (opcional) Probar conexión:** botón que valida URL+key contra el CRM externo
  (p.ej. `GET /api/public/availability`) antes de confiar. Si añade complejidad, follow-up.

## Fuera de scope
- Añadir external_api al wizard (se mantiene post-creación; no recargar el wizard de H3).
- Cambiar `managed_db ↔ external_api` con datos ya provisionados (evitar teardown de BD).

## Risks (seguridad — secreto de tenant: API key del CRM externo)
- La `apiKey` se cifra con `encryptToken` (AES-256-GCM), **nunca** se devuelve ni loguea;
  en la UI solo el indicador `***`/`apiKeySet`. Write-only (blanco = conservar).
- Validar `apiBaseUrl` (URL http/https; considerar SSRF — reusar `safeFetch` si se hace
  F4). Restringir capabilities a `reservas/leads` (rechazar `pedidos`).

## Dependencies
- `back/src/routes/agents.ts` (PATCH + schema), `back/src/lib/agent/service.ts` (vista
  segura + precedente de cifrado create), `oauth.ts` (encryptToken/decryptToken),
  `managed-db.ts` (adapter, solo lectura), `front/components/agents/BusinessDataPanel.tsx`.
