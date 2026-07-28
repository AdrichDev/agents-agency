# Tasks — aa-bug-acceso-sin-sesion

> **Revisión 28/07/2026**: la mayor parte de esta change YA estaba construida, sólo que
> nadie marcó las casillas. Lo único que faltaba de verdad era B.3. Evidencia por tarea.

## Fase A — Decisión técnica
- [x] A.1 Confirmar si Supabase SSR (cookies) está configurado en `front/` o si la auth es puramente client-side. — **client-side**: no existe `front/middleware.ts` ni `front/src/middleware.ts`, y el guard vive en la capa de `fetch` (`front/lib/api.ts`), que corre en el navegador con el token de `getSession`.
- [x] A.2 Decidir middleware Next.js vs guard client-side según A.1; documentar decisión. — **guard client-side en la capa de API**, ya implementado en `front/lib/api.ts:145-158`. Sin cookies de sesión SSR, un middleware de Next no puede leer el token de Supabase: sólo podría comprobar una cookie que este front no escribe, o sea un guard de mentira. El de `api.ts` reacciona al 401 real del backend, que es la única fuente de verdad.
- [x] A.3 Listar el conjunto real de rutas privadas del dashboard a proteger. — **se hizo al revés, y es mejor**: en vez de enumerar las privadas (lista que se queda obsoleta en cuanto alguien añade una página y nadie se acuerda), `api.ts:146` mantiene `PUBLIC_PATHS = ["/", "/privacidad", "/aviso-legal", "/cookies"]` y expulsa desde cualquier otra. Deny-by-default: una página nueva nace protegida.

## Fase B — Implementación
- [x] B.1 Implementar el guard/middleware elegido para las rutas privadas. — `front/lib/api.ts:145-158`: ante un 401 hace `signOut({ scope: "local" })` y redirige si no está en `PUBLIC_PATHS`. El `scope: "local"` está ahí por un bucle de redirección real, documentado en ese mismo comentario.
- [x] B.2 Al detectar ausencia de sesión, redirigir al homepage con `returnTo` seteado a la ruta original. — `api.ts:155-158`; además borra un `returnTo` preexistente del search antes de reencodear, para no anidarlos.
- [x] B.3 Tras login exitoso, redirigir a `returnTo`. — **esto era lo único que faltaba**, y el propio comentario de `api.ts:151` lo admitía: «si el modal de login aún no lee returnTo, el parámetro queda inerte». `LoginModal.tsx` hacía `router.push("/dashboard")` fijo. Implementado 28/07/2026: lee el `returnTo` de la URL y navega ahí.
  - **Redirección abierta cerrada de paso**: el `returnTo` lo controla quien manda el enlace, así que `safeDestination()` sólo acepta rutas relativas de este origen — exige `/` inicial y rechaza `//evil.com` (URL protocol-relative, el navegador la resuelve a otro host) y `/\evil.com` (algunos navegadores normalizan `\` a `/`). Cualquier otra cosa cae al dashboard.
  - **No se usa `useSearchParams`**: en el App Router obliga a envolver el componente en un límite de Suspense o falla el build, y el dato sólo hace falta dentro del submit, que ya corre en cliente.

## Fase C — Verificación
- [x] C.1 `npm run typecheck` limpio. — `npx tsc --noEmit` en `front/`, exit 0 (28/07/2026).
- [ ] C.2 `npm run test:e2e` verde (tests nuevos + regresión de rutas públicas/privadas existentes). — **no ejecutable aquí**: `test:e2e` es Playwright y necesita el front levantado; no se arranca `next dev` en la carpeta del usuario. Tampoco se escriben tests nuevos a ciegas: un e2e que no se ha visto pasar no es evidencia de nada.
- [ ] C.3 Verificación manual: acceso directo sin sesión a `/landing-builder/{id}` real. — gate humano.

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [ ] Agentic Runtime PASS.
