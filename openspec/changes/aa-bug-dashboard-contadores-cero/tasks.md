# Tasks — aa-bug-dashboard-contadores-cero

## Fase A — Reproducción
- [ ] A.0 Confirmar visualmente el parpadeo "0" en carga en `app/dashboard/page.tsx` (throttle de red o delay artificial en dev).

## Fase B — Fix
- [ ] B.1 `app/dashboard/page.tsx`: usar `agents === null` como condición de carga en el render de los contadores.
- [ ] B.2 Añadir skeleton/placeholder visual para los contadores mientras `agents === null`.
- [ ] B.3 Verificar que el caso "0 agentes reales" tras cargar se muestra distinto del estado de carga.

## Fase C — Verificación
- [ ] C.1 `npm run typecheck` limpio.
- [ ] C.2 `npm run test:e2e` verde (tests nuevos de skeleton + regresión de conteo real).
- [ ] C.3 Verificación manual con throttle de red.

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [ ] Agentic Runtime PASS.
