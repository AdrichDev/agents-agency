# Tasks — aa-bug-acceso-sin-sesion

## Fase A — Decisión técnica
- [ ] A.1 Confirmar si Supabase SSR (cookies) está configurado en `front/` o si la auth es puramente client-side.
- [ ] A.2 Decidir middleware Next.js vs guard client-side según A.1; documentar decisión.
- [ ] A.3 Listar el conjunto real de rutas privadas del dashboard a proteger.

## Fase B — Implementación
- [ ] B.1 Implementar el guard/middleware elegido para las rutas privadas listadas en A.3.
- [ ] B.2 Al detectar ausencia de sesión, redirigir al homepage abriendo `LoginModal` con `returnTo` seteado a la ruta original (reusar patrón de `SetupWizard.tsx:127` / `app/agents/new/page.tsx:87-88`).
- [ ] B.3 Tras login exitoso, redirigir a `returnTo`.

## Fase C — Verificación
- [ ] C.1 `npm run typecheck` limpio.
- [ ] C.2 `npm run test:e2e` verde (tests nuevos + regresión de rutas públicas/privadas existentes).
- [ ] C.3 Verificación manual: acceso directo sin sesión a `/landing-builder/{id}` real.

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [ ] Agentic Runtime PASS.
