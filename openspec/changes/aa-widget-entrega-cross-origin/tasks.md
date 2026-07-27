# Tareas — aa-widget-entrega-cross-origin

Nivel 3. Toca la política de CORS y una cabecera de seguridad en producción.
Una tarea está hecha sólo cuando su prueba está verde.

## T1 — `isEmbeddable()` en `public-routes.ts`

- [x] **T1.1** Añadir `EMBED_RULES` con las 6 rutas de §D2, reusando los helpers `exact`/`prefix` ya
      presentes en el fichero, y exportar `isEmbeddable(method, path)`.
      *Test:* `public-routes.test.ts` — cada una de las 6 da `true`; `/api/auth/login`,
      `/api/channels/telegram/x`, `/api/cron/automations` y `/api/oauth/google/callback` dan `false`.
      ✅ 18/18 verde.
- [x] **T1.2** Comentar **por qué** `/api/auth/*` queda fuera aunque sea pública: viaja con cookie.
      *Test:* el mismo de T1.1 cubre el comportamiento; el comentario lo revisa el reviewer.
      ✅ `public-routes.ts:57-62`.
- [x] **T1.3** Invariante incrustable ⊂ público, comprobado recorriendo las reglas.
      *Test:* E6. ✅ Verde, y con un segundo test de recuento que obliga a dar muestra al añadir
      regla: sin él una regla nueva quedaría fuera del invariante sin que nadie se entere.

## T2 — CORS por ruta en `index.ts`

- [x] **T2.1** ~~Montar la capa **antes** de la estricta~~ → **un solo montaje que despacha por ruta**.
      Encadenarlas no funciona: `cors()` corta la cadena en el preflight pero llama `next()` en la
      petición real, que caía en la estricta con 403. Ver D1 y E3b. Método real leído de
      `Access-Control-Request-Method` en el preflight.
      *Test:* E3 (preflight 2xx) y **E3b** (petición real 200) — el segundo es el que cazó el fallo.
- [x] **T2.2** Reflejar el origen y decidir credenciales según la allowlist (§D3). Nunca `*`.
      *Test:* E3/E3b (sin credenciales fuera) y E4 (con credenciales dentro). ✅
- [x] **T2.3** Petición sin `Origin` pasa igual que antes.
      *Test:* E8. ✅

## T3 — Rechazo con 403

- [x] **T3.1** Adjuntar `status = 403` al error de la política estricta, para que `errorHandler` lo
      devuelva como 403 y deje de mandarlo a Sentry como 5xx.
      *Test:* E5 + ruta protegida + preflight no incrustable. ✅

## T4 — CORP en el estático

- [x] **T4.1** `express.static(..., { setHeaders })` con
      `Cross-Origin-Resource-Policy: cross-origin`. En el montaje, no en `helmet()` global.
      *Test:* E1. ✅ El test monta `helmet()` de verdad, para que el sobreescrito se pruebe, no se
      suponga.
- [x] **T4.2** Comprobar que el resto de la API conserva `same-origin`.
      *Test:* E2. ✅

## T5 — No regresión

- [x] **T5.1** `npx tsc --noEmit` EXIT=0 en `back/`. ✅
- [x] **T5.2** Suite completa del back: **136/139 ficheros verdes**. Los 3 rojos son los
      `market-study*` conocidos (timeout de 5 s bajo carga de suite completa), ya rojos antes de este
      cambio. Ninguna regresión nueva.
- [x] **T5.3** Revisión antes de commitear. ✅ Commit `64ad272` en `ac/widget-cross-origin`, sin push.
      Puntos revisados: superficie autenticada sin ampliar (invariante con test), nada autenticado
      legible desde origen ajeno (sin credenciales fuera de la allowlist), gate `test:true` más
      apretado no más flojo, CORP relajado sólo en el montaje estático, nunca `*`.

## G — Gates humanos

- [x] **G1** Aprobación para desplegar: cambia una cabecera de seguridad y la política de CORS en
      producción. ✅ Aprobado y desplegado el 27/07/2026 (`45445b8`).
      Verificado contra producción real, no contra el test:

      | Escenario | Resultado en `aa-back-jmyo.onrender.com` |
      |---|---|
      | E1 `GET /widget.js` | `cross-origin-resource-policy: cross-origin` |
      | E2 `GET /health` | `cross-origin-resource-policy: same-origin` |
      | E3 preflight `/api/chat` desde origen ajeno | `204`, `allow-origin` reflejado, sin `allow-credentials` |
      | E3b `POST /api/chat` desde origen ajeno | pasa CORS (`400` del validador, no bloqueo), origen reflejado |
      | E5 `POST /api/auth/login` desde origen ajeno | `403`, sin `allow-origin` |
      | E8 sin `Origin` | `200` |

- [x] **G2** Agente publicado: **AiAs** (`cmq9m0o4k0001n8fxmave9sr4`, `runtime = "openai"`,
      `publishedAt` 27/07/2026 20:47), vía `transitionAgentStatus` para que las precondiciones de H3
      apliquen igual que desde la ruta HTTP.
      **E9 PARCIAL.** Lo que este cambio tenía que arreglar, arreglado y demostrado en navegador:
      `widget.js` carga desde un dominio ajeno, la burbuja abre, el saludo se pinta y `POST /api/chat`
      **llega al servidor y ejecuta la lógica**. Cero `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`.
      Lo que sigue sin verse es la respuesta del bot, y **no por CORS**: la cuenta OpenAI de la
      plataforma devuelve `429 You exceeded your current quota`. Ver abajo.

## Orden crítico

```
T1 → T2 → T3 → T4 → T5 → [G1 desplegar] → G2 (E9 + publicar) → desbloquea H3/V6 y H2/V6
```

## Hallazgos de E9 — fuera de alcance de este cambio, bloquean la venta igual

- 🔴 **La cuenta OpenAI de la plataforma no tiene cuota.** `POST /api/chat` a un agente publicado
  devuelve `429 You exceeded your current quota, please check your plan and billing details`.
  Y hay **0 filas en `TenantLlmCredential`** en toda la plataforma: nadie tiene BYOK, luego **todos**
  los agentes tiran de la key de plataforma. Con el modelo de SaaS puro (la plataforma paga el LLM),
  sin saldo en esa cuenta no hay producto que vender. Es facturación, no código: gate humano.
- 🟠 **El error crudo del proveedor se filtra al visitante de la web del cliente.** El widget pintó
  literalmente el texto de OpenAI, con enlace a `platform.openai.com/docs`, en la web de un tercero.
  Debería ser un mensaje genérico. Además viaja como `500`, así que también va a Sentry como avería
  propia cuando es una condición de facturación.
- ✅ ~~`POST /api/widget/ping` falla con `net::ERR_ABORTED`~~ — **descartado, no era un fallo.**
  Investigado el 27/07. `curl` devuelve `204` al preflight y al POST desde un origen ajeno; en el
  navegador el `fetch` resuelve `HTTP 204` con y sin `keepalive`; el `ERR_ABORTED` lo reporta
  Playwright sobre el `POST` **después** de haber recibido el `204`, que es lo que hace con una
  respuesta `204 No Content` — no queda cuerpo que entregar. La página del cliente no ve nada:
  0 mensajes de consola, 0 errores de página. Y la instalación **sí** se sella: en producción el
  agente `AiAs` tiene `widgetInstalledAt=2026-07-27T18:49:05Z` y un `widgetLastSeenAt` que avanza
  con cada carga. F7 funciona.

## Fuera de alcance, anotado como deuda

- Los 3 agentes `runtime = "openclaw"` (Agente Caress, Agente JorjotasBarber, Agente EDM San Blas)
  no pueden responder desde producción: `openai.ts:194` apunta a
  `OPENCLAW_BASE_URL ?? "http://localhost:18791/v1"` y en Render `localhost` es el propio contenedor
  de Render. El único OpenClaw que corre es `openClaw_Wabiks_engine`, en la máquina del dueño, y
  `docker inspect` devuelve `{}` en puertos: no publica ninguno. Arreglar CORS no los arregla.
- Restringir por dominio qué sitios pueden incrustar un agente. Si se quiere, va en una allowlist
  **por agente** en BD, no en la capa CORS (ver R1 de la propuesta).
