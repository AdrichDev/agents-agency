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

- [ ] **G1** Aprobación para desplegar: cambia una cabecera de seguridad y la política de CORS en
      producción.
- [ ] **G2** Tras desplegar, publicar un agente `runtime = "openai"` y correr E9 con Playwright.
      Desbloquea de paso H3/V6 y H2/V6, que hoy están parados por lo mismo.

## Orden crítico

```
T1 → T2 → T3 → T4 → T5 → [G1 desplegar] → G2 (E9 + publicar) → desbloquea H3/V6 y H2/V6
```

## Fuera de alcance, anotado como deuda

- Los 3 agentes `runtime = "openclaw"` (Agente Caress, Agente JorjotasBarber, Agente EDM San Blas)
  no pueden responder desde producción: `openai.ts:194` apunta a
  `OPENCLAW_BASE_URL ?? "http://localhost:18791/v1"` y en Render `localhost` es el propio contenedor
  de Render. El único OpenClaw que corre es `openClaw_Wabiks_engine`, en la máquina del dueño, y
  `docker inspect` devuelve `{}` en puertos: no publica ninguno. Arreglar CORS no los arregla.
- Restringir por dominio qué sitios pueden incrustar un agente. Si se quiere, va en una allowlist
  **por agente** en BD, no en la capa CORS (ver R1 de la propuesta).
