# Design — aa-bug-acceso-sin-sesion

**Nivel Gru: 3.** Introduce protección de rutas transversal + comparte el interceptor `front/lib/api.ts:64-73` con `aa-bug-generar-prompt-redirect`. Coordinar ambos.

## 0. Hechos confirmados (investigación read-only front 2026-07-01)
- **NO existe `middleware.ts`** en `front/` (ni raíz ni `src/`). Búsqueda exhaustiva sin resultado.
- **NO existe** `AuthGuard`/`ProtectedRoute` en ningún componente.
- `front/app/landing-builder/[id]/page.tsx:16-57` no verifica sesión antes de renderizar; muestra "Cargando proyecto..." mientras `useLandingBuilder()` (`front/hooks/useLandingBuilder.ts:45-64`) llama `api("/api/landing/{id}")`. Sin sesión → 401 → interceptor `lib/api.ts:64-73` → `window.location.href="/"`.
- **`/` (`front/app/page.tsx`) es el landing de marketing público**, sin condición de auth (no hay `if(!user) return <Login/>`).
- **Login es un MODAL** (`front/components/landing/LoginModal.tsx`) invocado desde `LandingHeader.tsx`. **NO hay ruta `/login` dedicada.**
- `AppShell.tsx:15-17` decide el chrome (sidebar/topbar) por `pathname === "/"`, NO por sesión.
- **Patrón `returnTo` YA EXISTE** (no inventar): `front/components/landing/SetupWizard.tsx:127` y `front/app/agents/new/page.tsx:87-88` lo usan para volver a la ruta original tras crear un agente.

## 1. Decisión de arquitectura: dónde proteger
Auth de AA es **Supabase client-side** (token en el cliente, no cookie httpOnly leída en server por defecto). Esto condiciona la opción:

| Opción | Pro | Contra | Veredicto |
|---|---|---|---|
| **A. `middleware.ts` (server)** | Protección centralizada antes de render; estándar Next | Requiere que el token/sesión sea legible en el edge (cookie). Si Supabase guarda en localStorage, el middleware no lo ve → no fiable sin mover sesión a cookie | **Descartada** salvo que se confirme sesión en cookie (T0) |
| **B. Guard client-side** (hook/componente en el layout de rutas privadas) | Funciona con sesión client-side actual; sin re-arquitectura de auth | Flash de contenido antes del check; no protege datos (eso lo hace el back con 401, que ya ocurre) | **Elegida** (default) |

**Decisión (pendiente de T0)**: guard client-side. La protección de *datos* ya la da el backend (401); esto es protección de *navegación/UX* — evitar que el usuario sin sesión aterrice confundido en el homepage.

## 2. Diseño del guard client-side
- Un componente/hook (`RequireAuth` o similar) que envuelve las rutas privadas (dashboard, landing-builder, clientes, contactos, estadísticas, facturación, skills, tarifas, configuración) — idealmente en un layout de grupo de rutas.
- Al montar: leer sesión (`useAuthUser()` / `supabase.auth.getSession()`).
  - **Con sesión** → render normal.
  - **Sin sesión** → navegar a `/` con `?returnTo=<ruta-actual>` y señal para **abrir el modal de login** automáticamente.
- Mientras se resuelve el check inicial → spinner/placeholder (evitar flash del contenido privado).

## 3. Abrir el modal de login con returnTo
- `/` (`app/page.tsx` / `LandingHeader.tsx`) lee `returnTo` del query param al montar; si está presente, abre `LoginModal` automáticamente.
- Tras login exitoso en el modal: si hay `returnTo` válido → `router.replace(returnTo)`; si no → comportamiento actual (dashboard).
- **Validación de `returnTo`**: solo rutas internas — debe empezar por `/`, no contener `//` ni esquema (`http:`), para evitar open-redirect.

## 4. Contrato compartido con aa-bug-generar-prompt-redirect
El mecanismo "sin sesión / expirada → `/?returnTo=...` + abrir modal login" se diseña **aquí** y lo reutiliza el otro change en su path de expiración de sesión. Orden de implementación: **este change primero** (crea el mecanismo returnTo + apertura de modal), luego `aa-bug-generar-prompt-redirect` lo consume al endurecer el interceptor 401. Evita dos implementaciones divergentes del mismo flujo.

## 5. Seguridad
| Riesgo | Mitigación |
|---|---|
| Open-redirect vía `returnTo` | Solo rutas internas relativas (`/...`, sin `//`, sin esquema). |
| Flash de contenido privado antes del check | Placeholder/spinner hasta resolver `getSession()` inicial. |
| Falsa sensación de seguridad (guard client no protege datos) | Explicitar: la protección real de datos es el 401 del backend; el guard es UX de navegación. |

## 6. Plan
- **T0** (bloqueante): confirmar si la sesión Supabase es legible server-side (cookie) → decide A vs B. Confirmar el patrón exacto de `returnTo` existente para replicarlo idéntico.
- **T1**: guard client-side sobre rutas privadas (o middleware si T0 habilita A).
- **T2**: `/` abre `LoginModal` al detectar `returnTo`; post-login → `router.replace(returnTo)` validado.
- **T3**: test Playwright — acceso directo a `/landing-builder/{id}` sin sesión → aterriza en `/` con modal de login abierto y, tras login, vuelve a `/landing-builder/{id}`.
