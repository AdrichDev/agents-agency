# Tasks — aa-external-api-ui

Tests **vitest** (back) + front `tsc`. SIN migración (columnas ya existen). DONE con verde.

## F1 — Backend: PATCH acepta external_api

- [x] **T1.1 — Ampliar updateBackendSchema + handler** (`agents.ts:212-262`): aceptar
  `mode:"external_api"` (solo switch desde none_yet/external_api; rechazar desde
  managed_db con 400), `apiBaseUrl` (url), `apiKey` (write-only), `businessId`,
  `locationId`. Escribir `apiBaseUrl`, `apiKeyEncrypted=encryptToken(apiKey)` solo si
  apiKey no vacío, `dbSchema` merge {businessId,locationId}, capabilities (guard
  reservas/leads). No provision, no tocar dbUrl. Nunca loguear apiKey.
  - Test: persiste apiBaseUrl+apiKeyEncrypted; apiKey vacío conserva; pedidos rechazado;
    switch desde managed_db → 400.

## F2 — Backend: vista segura

- [x] **T2.1 — Exponer apiBaseUrl + apiKeySet** en la vista del backend (`service.ts:476-483`):
  `apiBaseUrl`, `apiKeySet:Boolean(apiKeyEncrypted)`, businessId/locationId de dbSchema.
  NUNCA la key ni el cifrado.
  - Test: vista devuelve apiBaseUrl+apiKeySet, jamás la key/apiKeyEncrypted.

## F3 — Front: form external_api

- [x] **T3.1 — BusinessDataPanel bloque external_api** junto a `:115-168`: CTA "Usar API
  externa" si none_yet; form URL + apiKey (password, write-only, placeholder •••• si set +
  nota "en blanco conserva") + businessId/locationId + checkboxes reservas/leads + Guardar
  → PATCH ampliado. Avisar si reservas sin locationId. Copy español, key nunca visible.
  - Test: `front tsc` verde; form en external_api no en managed_db; key write-only.

## F4 — (opcional) Probar conexión

- [ ] **T4.1 — Botón Probar** → endpoint que hace GET {apiBaseUrl}/api/public/availability
  vía safeFetch con la key, ok/fallo sin filtrarla. Si añade complejidad → follow-up. — deuda fuera de alcance: el propio documento la marca "(opcional)" con seguimiento aparte si añade complejidad. Confirmado sin implementar.

## Verificaciones finales

- [x] **T5.1 — Typecheck + suite** (`back` vitest + tsc, `front` tsc) verde. — verificado: Engram #975 (suite back 93 ficheros, 1001 passed, 3 skipped; `tsc --noEmit` exit 0 en back y front)
- [x] **T5.2 — sec-review:** apiKey cifrada (encryptToken), write-only, nunca devuelta ni
  logueada; apiBaseUrl validada (SSRF si F4); capabilities restringidas. — verificado: Engram #975, informe de revisión de seguridad con veredicto PASS: la clave es write-only y nunca se filtra, comprobado en `back/src/routes/agents.ts:302` y `:449` más la vista segura del servicio, con tests
- [ ] **T5.3 — Verificación visual (HITL):** configurar external_api en un agente y ver que
  el adapter usa esa URL/key. — ⏳ GATE HUMANO: configurar `external_api` en un agente contra un CRM externo real y comprobar que el adaptador usa esa URL y esa clave
- [x] **T5.4 — Engram:** persistir (external_api ya cifraba en create; H6 añade PATCH+form). — verificado: Engram #974 y #975 (18/07/2026) persisten la decisión

## Notas
- SIN migración. `encryptToken`/`decryptToken` en `oauth.ts:52/58`.
- external_api NO usa provision. Wizard NO se toca (config post-creación).

## Cierre — 28/07/2026

Cierre con una acción humana pendiente (T5.3, prueba contra un CRM externo real) y una tarea opcional que el propio documento dejó fuera de alcance (T4.1). La regla de que la clave del cliente nunca se filtra está verificada y cubierta por tests.
