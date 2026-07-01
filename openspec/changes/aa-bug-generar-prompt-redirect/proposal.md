# Proposal — Fix redirect a "/" sin sesión al generar prompt (aa-bug-generar-prompt-redirect)

**Nivel Gru: 3 — Grande.** Toca el interceptor global de sesión/auth (`lib/api.ts`), compartido por toda la app front.

## Contexto
En Landing Builder → pestaña Prompts → botón "✨ Generar prompt" (`front/components/landing/PromptPicker.tsx:96-104`), el botón es real (no `<a>`) y llama `loadPrompts()` (`front/components/landing/PromptPicker.tsx:47-63`), que hace `api("/api/landing/${projectId}/prompts", {method:"POST"})`. El wrapper `front/lib/api.ts:64-73` tiene un interceptor global: ante **cualquier** 401 ejecuta `supabase.auth.signOut({scope:"local"})` + `window.location.href="/"` (navegación dura). El botón no redirige por sí mismo — es el 401 de esa petición concreta el que dispara el interceptor y tira la sesión.

## Intención
Que el usuario no pierda sesión ni contexto al usar "Generar prompt" si la sesión sigue siendo válida, y que si de verdad expiró, se le avise en vez de un hard-redirect silencioso.

## Alcance
- **T0 investigación (backend, fuera de este repo front)**: confirmar por qué `POST /api/landing/:id/prompts` devuelve 401 en este flujo — token expirado, `getSession()` no resuelto a tiempo, scope de token incorrecto, u otra causa en el backend `:4000`. Esto condiciona si el fix real es en el back o si es puramente el front el que reacciona mal a un 401 legítimo.
- **Front — endurecer el interceptor 401** (`front/lib/api.ts:64-73`, MEJORA#15): en vez de `signOut` + `window.location.href="/"` ciego en cualquier 401, distinguir sesión realmente expirada de error puntual; si expiró, mostrar aviso "sesión expirada" preservando la ruta/contexto actual (patrón `returnTo`, ver `aa-bug-acceso-sin-sesion`) en vez de perder al usuario en el homepage sin explicación.

## Fuera de alcance
- Rediseño completo del wrapper `api.ts` más allá del manejo de 401.
- Cambios de arquitectura de auth backend (Supabase vs JWT propio) — eso es otro change si aplica.

## Open questions (resolver en T0)
- ¿Por qué el backend `:4000` devuelve 401 en `POST /api/landing/:id/prompts` en este flujo concreto? (fuera de este repo, requiere investigación backend).
- ¿El interceptor de `lib/api.ts:64-73` es punto único usado por todas las llamadas `api()`, o hay excepciones que deban tratarse distinto?

## Riesgos
- Este interceptor es raíz compartida con `aa-bug-acceso-sin-sesion` (mismo archivo `lib/api.ts:64-73`). Cambiarlo sin coordinar ambos changes puede generar comportamiento inconsistente entre "sesión expirada en acción" y "acceso directo sin sesión". Nivel 3 por tocar código de sesión/auth transversal a toda la app.
