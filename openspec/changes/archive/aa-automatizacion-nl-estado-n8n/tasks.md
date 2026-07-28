# Tasks — aa-automatizacion-nl-estado-n8n

Tests **vitest** (back) + front `tsc`. SIN migración, SIN cablear n8n. DONE con verde.

## F1 — Parar la pérdida del import JSON

- [x] **T1.1 — Back guard camino JSON.** En `back/src/lib/automations/import.ts` camino
  JSON: si `!n8n.isConfigured()` → `HttpError(503, "El motor de automatización (n8n) está
  apagado; no se pueden importar workflows ahora.")` ANTES de crear la fila. No crear
  Automation inerte, no perder el JSON en silencio (paridad con el camino por ID `:119`).
  - Test: JSON import con isConfigured=false → 503 y `prisma.automation.create` NO llamado;
    isConfigured=true → comportamiento actual (regresión).
- [x] **T1.2 — Front bloquea import.** `AutomationImportForm.tsx`: `canSubmit` incluye
  `n8nConfigured`; botón deshabilitado con n8n off + mensaje bloqueante claro (workflows
  importados requieren n8n; las NL sí funcionan por motor interno).
  - Test: `front tsc` verde; submit deshabilitado con n8n off.

## F2 — Banner y nota honestos

- [x] **T2.1 — Banner AutomationsPanel** (`:44-48`) reescrito honesto: motor interno corre
  NL (~5 min, requiere integración conectada); importados requieren n8n. Sin "todo bien".
- [x] **T2.2 — Nota AutomationForm** (`:138-142`) honesta: sondeo ~5 min, no push; requiere
  proveedor conectado (email/slack).

## F3 — Estado por-ítem honesto

- [x] **T3.1 — AutomationItem badges** (`:46-61`): `imported`+n8n off → "requiere n8n
  (apagado)" (no se ejecutará); NL `pending` → "motor interno" + real por `lastRunAt`
  ("sin ejecutar aún" / "última: fecha"). Mantener synced/error.
  - Test: `front tsc` verde; badge distinto imported-off vs pending-NL.

## F4 — Honestidad del intervalo

- [x] **T4.1 — Nota del intervalo** donde se elige `intervalMinutes`: "motor interno revisa
  ~cada 5 min; el intervalo exacto solo aplica con n8n encendido".

## Verificaciones finales

- [x] **T5.1 — Typecheck + suite** (`back` vitest + tsc, `front` tsc) verde. — verificado: Engram #977 (suite back 93 ficheros, 1003 passed, 3 skipped, 0 failed; front `tsc --noEmit` exit 0)
- [ ] **T5.2 — Verificación visual (HITL):** con n8n off, ver banner honesto, import
  bloqueado, badges correctos. — ⏳ GATE HUMANO: verificación visual con n8n apagado (banner de servicio caído, importación deshabilitada, badges de estado)
- [x] **T5.3 — Engram:** persistir (n8n off ≠ muerto: cron interno corre NL; import JSON
  bloqueado honesto; honestidad de estado). — verificado: Engram #1046 (28/07/2026) rectifica la observación #976, que decía "Backend T1.1 NO tocado" y era falsa

## Notas
- El cron interno NO se toca (sigue ejecutando NL con n8n off). Regresión cero.
- Follow-ups: health check real de n8n, persistir workflowJson, honrar intervalMinutes real.

## Cierre — 28/07/2026

Cierre con una única verificación visual pendiente (T5.2, con n8n apagado). Aviso de método: la observación #976 quedó desactualizada y contradecía a la #977; se rectificó en la #1046 al cerrar.
