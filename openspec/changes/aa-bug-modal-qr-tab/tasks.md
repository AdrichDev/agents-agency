# Tasks — aa-bug-modal-qr-tab

## Fase A — Reproducción
- [x] A.0 Reproducir manualmente: abrir SetupWizard con "Incluir Bot", luego pulsar "QR" sin cerrar el modal; confirmar que el tab no cambia. — **confirmado leyendo el código, que es prueba más fuerte que un clic**: `useLandingBuilder.ts:142-145` → `openWizard(step)` hace `setWizardStep(step); setShowWizard(true);`. Los dos botones son `page.tsx:123` (`openWizard(1)`) y `:126` (`openWizard(2)`). El wizard se monta en `page.tsx:258` con `{showWizard && <SetupWizard … initialStep={wizardStep} />}` y captura el paso una sola vez: `SetupWizard.tsx:64`, `useState(initialStep)`. Con el modal ya abierto `showWizard` sigue siendo `true`, así que React no remonta y el `useState` conserva el valor viejo. El bug es real y determinista.

## Fase B — Fix
- [x] B.1 Decidido: **`key={wizardStep}`** en el punto de montaje, no `useEffect`. Motivo: el `useEffect` sincroniza sólo `step` y deja vivo el resto del estado interno del wizard (campos a medio rellenar del paso anterior); saltar a otra pestaña debe dar una pestaña limpia. El `key` es además una línea y no añade un efecto que se dispara en cada render.
- [x] B.2 Implementado en `front/app/landing-builder/[id]/page.tsx` (`key={wizardStep}` sobre `<SetupWizard>`), con el porqué en comentario.

## Fase C — Verificación
- [x] C.1 `npm run typecheck` limpio. — `npx tsc --noEmit` en `front/`, exit 0 (28/07/2026).
- [ ] C.2 `npm run test:e2e` verde (tests nuevos + regresión de open/next existentes). — **no ejecutable aquí**: `test:e2e` es Playwright y necesita el front levantado; no se arranca `next dev` en la carpeta del usuario (corrompe `.next` si hay otra instancia). No se escriben tests nuevos a ciegas: un e2e que no se ha visto pasar no es evidencia.
- [ ] C.3 Verificación manual del caso original (QR tras Incluir Bot sin cerrar). — gate humano.

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [ ] Agentic Runtime PASS.
