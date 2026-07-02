# Tasks — aa-bug-modal-qr-tab

## Fase A — Reproducción
- [ ] A.0 Reproducir manualmente: abrir SetupWizard con "Incluir Bot", luego pulsar "QR" sin cerrar el modal; confirmar que el tab no cambia.

## Fase B — Fix
- [ ] B.1 `front/components/landing/SetupWizard.tsx`: decidir entre `useEffect(() => setStep(initialStep), [initialStep])` o `key={initialStep}` en el punto de montaje (`front/app/landing-builder/[id]/page.tsx:256`).
- [ ] B.2 Implementar la opción elegida.

## Fase C — Verificación
- [ ] C.1 `npm run typecheck` limpio.
- [ ] C.2 `npm run test:e2e` verde (tests nuevos + regresión de open/next existentes).
- [ ] C.3 Verificación manual del caso original (QR tras Incluir Bot sin cerrar).

## Tras verde: gate Ruflo (revisión refactor) ANTES de cualquier commit/push.
- [ ] Ruflo PASS.
