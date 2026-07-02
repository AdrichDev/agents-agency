# Proposal — Proteger rutas del dashboard sin sesión (aa-bug-acceso-sin-sesion)

**Nivel Gru: 3 — Grande.** Toca seguridad/routing transversal (protección de rutas privadas) y comparte raíz con `aa-bug-generar-prompt-redirect`.

## Contexto
Acceder directo a `/landing-builder/{id}` sin sesión muestra el homepage público en vez de mandar a login. No existe `middleware.ts` en `front/`, ni AuthGuard/ProtectedRoute. `front/app/landing-builder/[id]/page.tsx:16-57` no verifica sesión; su hook `front/hooks/useLandingBuilder.ts:45-64` llama `api()`, y el 401 resultante cae en el mismo interceptor global `front/lib/api.ts:64-73` que redirige a "/". El "/" (`front/app/page.tsx`) es landing de marketing sin auth. El login es un **modal** (`front/components/landing/LoginModal.tsx`, invocado desde `front/components/landing/LandingHeader.tsx`) — no hay ruta `/login` dedicada.

Ya existe en el repo el patrón `returnTo` para volver a la ruta original tras una acción (`front/components/landing/SetupWizard.tsx:127` y `front/app/agents/new/page.tsx:87-88`); NO hay que inventar un mecanismo nuevo, hay que reutilizar este.

## Intención
Que acceder sin sesión a una ruta privada del dashboard (p.ej. `/landing-builder/{id}`) lleve al homepage abriendo el modal de login con `returnTo=/landing-builder/{id}`, y que tras autenticar el usuario vuelva exactamente a esa ruta.

## Alcance
- Definir y aplicar un mecanismo de protección de rutas privadas: middleware de Next.js o guard client-side (a decidir en Open questions, dado que la auth de Supabase en este front es client-side).
- Reutilizar el patrón `returnTo` ya existente para pasar la ruta original al modal de login.
- Tras autenticación exitosa, redirigir a la ruta `returnTo`.

## Fuera de alcance
- Migrar auth a un modelo server-side/SSR de Supabase.
- Rediseñar el modal de login o crear una ruta `/login` dedicada.
- El fix del interceptor 401 en sí (`lib/api.ts:64-73`) — eso vive en `aa-bug-generar-prompt-redirect`; este change se centra en el guard de entrada a la ruta, no en la reacción a un 401 tras haber entrado.

## Open questions (resolver en T0)
- ¿Middleware de Next.js (Edge, revisa cookies de sesión) o guard client-side (revisa `supabase.auth.getSession()` en el propio componente/layout)? Dado que la auth de Supabase en este front es client-side, un middleware Edge puede no tener acceso directo a la sesión sin cookies SSR configuradas — verificar si Supabase SSR está en uso en este proyecto o no.
- ¿Qué rutas exactas se consideran "privadas" del dashboard? (`/landing-builder/*`, `/dashboard`, `/clientes`, etc. — listar el conjunto real antes de implementar el guard).

## Riesgos
- Guard mal implementado puede bloquear rutas públicas por error o dejar rutas privadas sin proteger si la lista de rutas privadas queda incompleta.
- Comparte el interceptor `lib/api.ts:64-73` con `aa-bug-generar-prompt-redirect` — coordinar ambos changes para no duplicar ni contradecir el manejo de sesión expirada/ausente.
