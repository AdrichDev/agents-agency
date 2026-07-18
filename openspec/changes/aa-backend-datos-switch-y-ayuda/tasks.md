# Tasks — aa-backend-datos-switch-y-ayuda

Tests **vitest** (back) + front `tsc`. SIN migración. DONE con verde.

## F1 — Switch none_yet → managed_db

- [x] **T1.1 — Backend: PATCH acepta mode managed_db.** `updateBackendSchema`
  (`agents.ts:~213`): `mode: z.enum(["external_api","managed_db"]).optional()`. Handler:
  permitir switch a `managed_db` desde `none_yet`/`external_api`; MANTENER el bloqueo de
  salir de `managed_db` (target ≠ managed_db y actual == managed_db → 400). Cambiar a
  managed_db solo fija `mode` (NO aprovisiona; provision sigue siendo su endpoint aparte).
  No romper el switch a external_api ni la escritura de apiBaseUrl/apiKey de H6.
  - Test: none_yet + mode:managed_db → mode="managed_db" persistido (sin provision); desde
    managed_db intentar cambiar a external_api/none_yet → 400 (ya cubierto/extender);
    external_api + mode:managed_db → OK.
- [x] **T1.2 — Front: CTA "Usar base de datos gestionada".** En la sección `none_yet` de
  `BusinessDataPanel.tsx` (:250-266), junto a "Usar API externa", añadir botón "Usar base de
  datos gestionada" → PATCH `/:id/backend` con `{mode:"managed_db"}` → `onChange()` (recarga)
  → aparece la UI managed_db existente (capacidades + Aprovisionar). No romper el CTA externa.
  - Test: `front tsc` verde.

## F2 — Ayuda en el formulario external_api

- [x] **T2.1 — Copy de ayuda** en `externalApiForm` (`BusinessDataPanel.tsx:125-215`): nota
  arriba explicando el contrato `/api/public/{leads,availability,bookings}` ("no es una BD
  cruda") + ayuda breve por campo (URL base, API key, Business ID, Location ID). Solo texto.
  - Test: `front tsc` verde.

## Verificaciones finales
- [ ] **T3.1 — Typecheck + suite** (`back` vitest+tsc, `front` tsc) verde.
- [ ] **T3.2 — sec-review** ligero: el switch a managed_db no aprovisiona solo; guard de
  salida de managed_db intacto; no fuga apiKey.
- [ ] **T3.3 — Engram.**

## Notas
- SIN migración. F1 solo fija modo (provision aparte). Regresión cero en external_api/H6.
