# Tasks — aa-lead-whatsapp-kickoff

Orden: F1 (envío) → F2 (endpoint, depende de F1) → F3 (config, se integra en F2).
Cada tarea DONE solo con su test verde (vitest, NO node:test).

## F1 — `sendTemplate()`

- [x] **T1.1 — `sendTemplate` en `channels/whatsapp.ts`.** <!-- DONE: tests/whatsapp-send-template.test.ts 4/4 verdes (body type:template, sin components, error status) --> Envío Meta
  `type:"template"` (name + language.code + components/body params). Mismo patrón
  fetch/error que `sendMessage`. `bodyParams` vacío → omite `components`.
  - Test: `back/tests/whatsapp-send-template.test.ts` (`fetch` mock) — body
    correcto (template.name, language.code, parameters ordenados); sin variables
    → sin components; no-2xx → throw con status+detalle.

## F2 — Endpoint de kickoff + siembra

- [x] **T2.1 — Router `POST /api/leads/kickoff`.** <!-- DONE: src/routes/leads.ts montado público en src/index.ts + allowlist public-routes.ts; tests/leads-kickoff.test.ts T2.1 verde (401 token, 422 body/telefono, limiter wired) --> `back/src/routes/leads.ts`,
  montado en `index.ts` en el lane público (antes de `authenticate`). Zod body.
  Gate por token del agente + rate-limit. Normaliza teléfono (E.164).
  - Test: token inválido → 401; body inválido → 422; rate-limit aplicado.
- [x] **T2.2 — Resolución de agente + creds WhatsApp.** <!-- DONE: ChannelConnection agentId_provider + decryptCreds; tests/leads-kickoff.test.ts T2.2 verde (409 sin conexión, creds usadas) --> `ChannelConnection`
  (`agentId_provider`) + `decryptCreds`. Sin conexión WhatsApp → 409 honesto.
  - Test: con conexión → creds descifradas; sin conexión → 409.
- [x] **T2.3 — Idempotencia.** <!-- DONE: resolveConversation existente → 200 already_started sin reenviar; tests/leads-kickoff.test.ts T2.3 verde --> `resolveConversation(agentId,"whatsapp",telefono)`
  existente → 200 `already_started`, NO reenvía plantilla.
  - Test: conversación previa → no llama `sendTemplate`, responde `already_started`.
- [x] **T2.4 — Crear Contacto en CRM (best-effort).** <!-- DONE: resolveAgentBackendAdapter.guardarLead en try/catch (no bloquea); tests/leads-kickoff.test.ts T2.4 verde (llamado, adapter throw/null → sigue) --> `resolveAgentBackendAdapter`
  → `guardarLead` si capability `leads`. Fallo → log, no bloquea.
  - Test: adapter presente → `guardarLead` llamado con los datos; adapter null →
    se sigue sin romper.
- [x] **T2.5 — Enviar plantilla + sembrar conversación.** <!-- DONE: sendTemplate → 200 started con Conversation(metadata.externalId/leadFlow/source=kickoff)+Message assistant; Graph fail → 502 sin sembrar; tests/leads-kickoff.test.ts T2.5 verde --> `sendTemplate` con la
  config; luego `conversation.create` (metadata.externalId=telefono, leadFlow,
  source=kickoff) + `message.create` (assistant = texto renderizado). Fallo Graph
  → 502, NO siembra.
  - Test: happy path → sendTemplate llamado, Conversation+Message creados, 200
    con conversationId; fallo Graph → 502 y 0 filas creadas.

## F3 — Config de plantilla

- [x] **T3.1 — Resolución de config de plantilla + kickoff-token.** <!-- DONE: src/lib/channels/lead-template.ts (notificationConfig>env>default, renderBodyParams, renderTemplateText, resolveKickoffToken); tests/lead-template.test.ts 11/11 verdes -->
  `notificationConfig.leadTemplate` (name/language/bodyVars) > env
  `META_LEAD_TEMPLATE_NAME`/`_LANG` > default; `notificationConfig.kickoffToken`.
  Render de variables para el `Message` sembrado.
  - Test: precedencia notificationConfig > env > default; render de `bodyVars`
    contra los datos del lead.

## Verificaciones finales

- [x] **T4.1 — Regresión cero.** <!-- DONE: whatsapp-webhook.ts/engine.ts sin cambios (aditivo); suite completa 932 passed / 3 skipped, 0 fallos --> Webhook reactivo + `chatWithAgent` sin cambios
  (asserts puros / suite existente verde).
- [x] **T4.2 — Typecheck + suite.** <!-- DONE: npm run typecheck 0 errores; vitest run 932 passed / 3 skipped --> `cd back && npm run typecheck` 0 + `npm test`
  (vitest) verde.
- [x] **T4.3 — sdd-verify** (2026-07-17): VERDICT **PASS** (AC1-AC9, Engram #947). 0 critical / 2 warning / 2 suggestion. Seguridad: endpoint NO abusable (fail-closed 401 antes de enviar). Warnings no bloqueantes: (1) idempotencia read-then-write sin unique index → doble-submit concurrente puede doble-enviar; (2) rate-limit solo por IP. Falta code-review humano + commit (HITL).
- [x] **T4.4 — Persistir decisiones en Engram** (protocolo save). <!-- DONE: Engram obs #946 topic sdd/aa-lead-whatsapp-kickoff/apply-progress -->

## Follow-ups (fuera de este change)

- Aprobar la plantilla de primer contacto en Meta (HITL, externo) — sin ella el
  envío falla en runtime.
- Plantilla de re-contacto tras 24h de silencio (nurture) — change aparte.
- UI en el panel para configurar `leadTemplate` + `kickoffToken` per-agente.
- VAPI ("llámame ahora").
