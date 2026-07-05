# Tasks — aa-bug-mobile-zip-deshabilitado

## Fase A — Investigación (bloqueante parcial)
- [ ] A.0 Confirmar en backend `:4000` si `/api/landing/:id/mobile` existe y responde correctamente; documentar hallazgo. Si es un bloqueante backend, marcar dependencia y avisar antes de continuar con B.

## Fase B — Fix de feedback (front)
- [ ] B.1 `front/components/landing/MobilePanel.tsx:130`: añadir tooltip/título explicando por qué el botón está deshabilitado cuando `hasMobile === false`.
- [ ] B.2 `front/components/landing/MobilePanel.tsx:33` (catch de `generate()`): capturar y mostrar el error al usuario en vez de fallar en silencio.

## Fase C — Verificación
- [ ] C.1 `npm run typecheck` limpio.
- [ ] C.2 `npm run test:e2e` verde (tests nuevos de tooltip y error visible).
- [ ] C.3 Verificación manual con backend real (si A.0 confirma que el endpoint funciona).

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [ ] Agentic Runtime PASS.
