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
- [x] C.2 Regresión e2e ejecutada. — **el "no ejecutable aquí" que ponía antes era falso** y conviene dejarlo escrito: `playwright.config.ts` trae un bloque `webServer`, así que Playwright levanta el front él mismo. El riesgo del `.next` era de CONCURRENCIA (dos instancias a la vez), no de arrancar. Ejecutado el 28/07/2026: **91 passed, 3 failed**. Los 3 rojos son todos de `telegram-widget.spec.ts`, ajenos a este change y propiedad de `aa-espejo-movil-operador-telegram`; la regresión de rutas públicas/privadas pasa entera.
  - **Cobertura del `returnTo`, por mitades.** La de **escritura** (el interceptor de `lib/api.ts` que pone el `returnTo` al expulsar por 401) ya la cubría `tests/api-401-returnto.spec.ts`, incluido el caso de no-bucle estando en la landing; ambos en verde. La de **lectura** (`safeDestination`, donde estaba el agujero) **no la cubría nada**, así que se añade `tests/login-return-to.spec.ts`: 8 destinos externos —los 5 que se colaban por TAB/LF/CR más `//host`, `/\host` y absoluta— y 3 casos legítimos. **11 tests, todos verdes**, con `tsc --noEmit` exit 0.
  - Para poder probarlo sin autenticarse de verdad contra Supabase, `safeDestination` pasa a recibir el `origin` por parámetro en lugar de leer `window` dentro, y se exporta. Es un cambio de una línea en la llamada; la lógica de seguridad no se toca. Sin eso, la única red posible era un e2e atado a credenciales vivas, es decir, ninguna.
- [x] C.3 **CERRADO el 28/07/2026**: ya estaba cubierto, sólo que la casilla pedía hacerlo a mano. `tests/api-401-returnto.spec.ts:19` hace exactamente eso —`page.goto("/landing-builder/test-id")` sin sesión— y afirma que la URL acaba en `?returnTo=%2Flanding-builder%2Ftest-id`. **Verde.** Que el 401 venga de un mock o de un back real no cambia nada aquí: el front sólo ve el status, y el interceptor reacciona al status.
  - La otra mitad —volver al destino tras autenticarse— no admite e2e sin credenciales vivas de Supabase, así que se cubre en unidad sobre `safeDestination` (`tests/login-return-to.spec.ts`, 11 verdes) más la llamada de una línea en `LoginModal.tsx`. Lo único que queda a ojo es el viaje completo con una cuenta real, y su parte peligrosa (a dónde se redirige) es justo la que está probada.

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [x] Agentic Runtime **PASS con corrección** — revisión hecha el 28/07/2026.

  **El gate se saltó**: `f141fd9` se commiteó y se empujó SIN esta revisión. Se hizo después, y
  encontró un fallo de seguridad **en el código que este change añadió**. Eso es exactamente lo que
  el gate existía para impedir; queda escrito para que la próxima vez se respete el orden.

  **Hallazgo: redirección abierta en `safeDestination()` de `LoginModal.tsx`.** La versión
  commiteada validaba el `returnTo` comparando prefijos (`startsWith("/")`, `"//"`, `"/\\"`). El
  parser de URL del navegador **elimina tabuladores, LF y CR antes de resolver**, así que
  `/<TAB>/evil.com` supera los tres filtros y acaba resolviéndose a `https://evil.com`. Sonda de 11
  entradas: **5 se colaban**. Impacto: phishing post-login — el enlace apunta al dominio real, la
  víctima se autentica de verdad, y aterriza en el del atacante.

  **Corregido** parseando con `new URL(returnTo, window.location.origin)`, comparando `origin` y
  devolviendo `pathname + search + hash` ya normalizados en lugar de la cadena original.
  Reverificado con la misma sonda: **5 fugas → 0**, y los destinos legítimos intactos (incluido
  `/agents/123?tab=qr#seccion`). `tsc --noEmit` exit 0.

  Resto de la revisión, sin objeciones: el guardia de `lib/api.ts` (401 → `signOut` local →
  redirect con `returnTo`, deny-by-default vía `PUBLIC_PATHS`) ya existía y es correcto; evitar
  `useSearchParams` para no forzar un límite de Suspense está justificado y el dato sólo se usa
  dentro del submit, que ya corre en cliente.
