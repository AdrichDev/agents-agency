# Diseño — aa-widget-entrega-cross-origin

## D1 — Dos políticas de CORS excluyentes, despachadas por ruta

La tentación es añadir `"*"` a `CORS_ORIGINS` y seguir. No vale: la capa actual lleva
`credentials: true`, y la especificación prohíbe combinar `Access-Control-Allow-Origin: *` con
credenciales. El navegador rechazaría entonces las llamadas del panel, que es exactamente lo que hoy
funciona.

Hay dos políticas y **un solo montaje** que elige entre ellas:

```
helmet()
  → httpLogger
  → [NUEVO] crearCorsPorRuta(ALLOWED_ORIGINS)
       isEmbeddable(métodoReal, ruta) ? política abierta : política estricta
  → express.json
  → [MODIFICADO] express.static(public/)  con CORP cross-origin
```

**Corregido durante la implementación (T2).** El diseño original montaba las dos capas encadenadas,
la de incrustación primero. Parece equivalente y no lo es, y el test E3b lo cazó: `cors()` responde
el preflight `OPTIONS` y **corta** la cadena, pero en la petición **real** pone las cabeceras y llama
`next()`. Encadenadas, el preflight pasaba y el `POST /api/chat` de verdad caía acto seguido en la
capa estricta con 403 — el widget seguía roto, sólo que un paso más tarde. Las dos políticas son
excluyentes por definición y el código tiene que decirlo: un `if`, no un orden de montaje.

El método se lee de `Access-Control-Request-Method` cuando `req.method` es `OPTIONS`; leerlo mal
mandaría el preflight a la política estricta y el navegador nunca emitiría la petición real.

## D2 — `isEmbeddable()` vive junto a `isPublic()`

`back/src/lib/public-routes.ts` ya existe con este propósito exacto, y su cabecera dice por qué:
"Extraído de index.ts para poder testearlo sin arrancar el servidor". La nueva regla sigue el mismo
patrón, reusa los helpers `exact`/`prefix` y se testea igual.

Rutas incrustables — las que `widget.js` y los formularios embebidos llaman **desde la página de un
cliente**:

| Ruta | Quién la llama |
|---|---|
| `POST /api/chat` | el widget, en cada mensaje |
| `GET /api/widget/config` | el widget, al arrancar (colores, avatar, nombre) |
| `POST /api/widget/ping` | auto-verificación de instalación |
| `GET /api/booking/slots` | widget de reservas |
| `POST /api/booking/reserve` | widget de reservas |
| `POST /api/public/leads` | formulario de captación en la landing del cliente |

Deliberadamente **fuera**, aunque sean públicas:

- `/api/auth/*` — viajan con cookie de sesión. Abrirlas sería el agujero de verdad.
- Webhooks de Telegram/WhatsApp, cron, `/api/automations/:id/execute` — servidor a servidor. No hay
  navegador, luego no hay CORS que resolver.
- `GET /api/oauth/:provider/callback` — es una navegación del navegador, no una petición XHR.

**Invariante comprobable:** incrustable ⊂ público. Una ruta incrustable que no fuera pública sería un
agujero (se le abriría el origen a algo que exige sesión). Lo fija un test que recorre las reglas,
no un comentario.

## D3 — Reflejar el origen, nunca `*`, y las credenciales según la allowlist

```
origen ∈ ALLOWED_ORIGINS  → refleja ese origen, credentials: true
origen ∉ ALLOWED_ORIGINS  → refleja ese origen, credentials: false
sin Origin                → pasa (servidor a servidor)
```

Reflejar el origen sin credenciales es equivalente en seguridad a `*`: no viaja cookie, así que la
respuesta no puede contener nada autenticado. Pero permite conservar `credentials: true` para el
front, que es lo que salva la consola de operador (R2).

No se usa `*` en ningún caso: mezclar `*` con `credentials` es un error de configuración que el
navegador castiga en silencio y cuesta horas de depurar.

## D4 — Origen rechazado: 403, y no a Sentry

`errorHandler` (`observability.ts:75`) ya lee `err.status` y sólo manda a Sentry lo que es `>= 500`.
Basta con adjuntar `status = 403` al error de CORS y el envelope, el log y el filtro de Sentry se
arreglan de una vez, sin tocar el handler.

**Se mantiene el rechazo en servidor**, no se pasa a `cb(null, false)`. Con `cb(null, false)` la
petición se ejecutaría y sólo el navegador escondería la respuesta: sería ampliar la superficie en
silencio a cambio de nada. Lo que se corrige es el código de estado, no la decisión.

## D5 — CORP sólo en el montaje del estático

```ts
express.static(path.join(process.cwd(), "public"), {
  setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
})
```

En el montaje, no en `helmet()` global: el resto de la API sigue con `same-origin`. `back/public/`
tiene hoy un único fichero y la intención es que siga siendo el punto de reparto de lo embebible
(R3).

## D6 — Qué NO cambia

- El gate de autenticación de `/api` (`isPublic`/`isServiceCall`) no se toca. CORS decide **qué
  origen puede leer la respuesta**; la sesión decide **quién puede pedirla**. Son capas distintas y
  esta propuesta sólo mueve la primera.
- `SERVICE_RULES` y `AA_SERVICE_TOKEN`, intactos.
- Ninguna migración. Ningún cambio de esquema.

## Ficheros

| Fichero | Cambio |
|---|---|
| `back/src/lib/public-routes.ts` | + `EMBED_RULES`, + `isEmbeddable()` |
| `back/src/lib/cors-layers.ts` | nuevo: `crearCorsPorRuta()`, las dos políticas y el despacho |
| `back/src/index.ts` | monta `crearCorsPorRuta(ALLOWED_ORIGINS)` en lugar del `cors()` único; `setHeaders` en el estático |
| `back/tests/cors-incrustacion.test.ts` | nuevo |
| `back/tests/public-routes.test.ts` | + invariante incrustable ⊂ público |

## Estrategia de prueba

Tres niveles, porque cada uno atrapa lo que el anterior no puede:

1. **Unidad** sobre `isEmbeddable()` — barato, cubre la tabla de rutas entera y el invariante de D2.
2. **Integración** con `supertest` sobre la app real — comprueba las cabeceras que salen de verdad
   (`Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, `Cross-Origin-Resource-Policy`)
   con `NODE_ENV=production`, que es la única rama donde la allowlist se aplica.
3. **Navegador**, con el banco de Playwright ya montado en `scratchpad/widget-harness`: página en un
   origen ajeno que embebe el `widget.js` de producción. Es el único nivel que reproduce el fallo
   original, porque las dos roturas las impone el navegador. Este nivel se ejecuta **tras desplegar**.
