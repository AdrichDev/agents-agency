# Validación — aa-bug-acceso-sin-sesion

Historia: como visitante sin sesión que accede directo a una URL privada del dashboard (p.ej. `/landing-builder/{id}`), quiero que se me pida iniciar sesión y, tras hacerlo, volver exactamente a donde intentaba ir — no quedarme en el homepage sin explicación.

## Criterios de aceptación
- **AC1**: Acceder sin sesión a `/landing-builder/{id}` no muestra el homepage "normal" sin más — abre el modal de login (o redirige de forma que el login se presente de inmediato).
- **AC2**: La URL objetivo se preserva vía `returnTo=/landing-builder/{id}` (mismo patrón que `SetupWizard.tsx:127` / `app/agents/new/page.tsx:87-88`).
- **AC3**: Tras autenticar correctamente, el usuario aterriza exactamente en `/landing-builder/{id}`, no en "/" ni en un dashboard genérico.
- **AC4**: Con sesión válida, acceder a esas mismas rutas funciona igual que antes (sin regresión).
- **AC5**: typecheck + `test:e2e` verdes.

## Por tarea (Given-When-Then)
### T0 — decisión técnica
- **Given** las dos opciones (middleware Edge vs guard client-side), **When** se evalúa cómo Supabase gestiona la sesión en este front, **Then** se documenta la decisión con justificación antes de implementar. _No es test, es decisión de diseño registrada en el change (o en proposal.md actualizado)._

### Guard / middleware
- **Given** sin sesión, **When** se navega a `/landing-builder/{id}`, **Then** se abre el login con `returnTo` seteado a esa ruta. _Test Playwright._
- **Given** login exitoso con `returnTo` presente, **When** se completa la autenticación, **Then** el usuario es redirigido a la ruta de `returnTo`. _Test Playwright._
- **Given** sesión válida, **When** se navega a una ruta privada, **Then** no hay interrupción ni modal de login. _Test Playwright (regresión)._
- **Given** una ruta pública (p.ej. "/"), **When** se accede sin sesión, **Then** se comporta igual que hoy (sin guard). _Test Playwright (regresión)._
