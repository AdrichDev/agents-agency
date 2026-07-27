# aa-widget-entrega-cross-origin

## Intención

Que el widget embebible cargue y responda desde el sitio de un cliente. Hoy no lo hace, y eso
convierte en teórico todo el eje de monetización: se cobra por un agente que el cliente no puede
poner en su web.

## El problema, con evidencia

Descubierto el 27/07/2026 con Playwright contra producción, después de desplegar `25299eb`. `curl` no
lo ve, porque las dos roturas las impone el navegador, no el servidor.

**Rotura 1 — el script ni se descarga.**

```
GET https://aa-back-jmyo.onrender.com/widget.js
→ net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
cross-origin-resource-policy: same-origin
```

`helmet()` (`back/src/index.ts:74`) pone esa cabecera y corre **antes** de
`express.static(public/)` (línea 111), así que el estático la hereda. `back/public/` contiene
exactamente un fichero: `widget.js`, cuyo propio comentario documenta el uso como
`<script src="https://TU-APP/widget.js" data-agent-key="...">` desde un sitio ajeno. Imposible hoy.

**Rotura 2 — aunque cargara, la llamada moriría.**

```
POST /api/chat        con Origin: https://cliente-cualquiera.com → HTTP 500
OPTIONS /api/chat     (preflight, mismo Origin)                  → HTTP 500
```

CORS global único (`index.ts:90-99`): allowlist `FRONT_URL + CORS_ORIGINS` con `credentials: true`.
Un origen fuera de la lista hace `cb(new Error("Origin no permitido por CORS"))`, el error no lleva
`status`, y `errorHandler` (`observability.ts:75`) lo convierte en 500 — además de mandarlo a Sentry
como si fuera un fallo del servidor, que no lo es.

**Causa de fondo.** Una sola política de CORS para dos públicos incompatibles. El panel necesita
allowlist cerrada **con** credenciales. El widget necesita origen abierto **sin** credenciales. Con
una sola capa, cualquier configuración correcta para uno rompe al otro.

## Alcance

Dentro:

- Separar la política CORS en dos capas: una de incrustación para las rutas que un sitio ajeno llama
  de verdad, y la estricta de siempre para el resto.
- Servir el estático del widget con `Cross-Origin-Resource-Policy: cross-origin`.
- Que un origen no permitido responda **403**, no 500, y deje de ensuciar Sentry.

Fuera:

- Publicar agentes y el smoke de publicación (H3/V6, H2/V6). Dependen de esto, no al revés.
- Los 3 agentes `runtime = "openclaw"`. Su problema es otro y más profundo: `openai.ts:194` apunta a
  `OPENCLAW_BASE_URL ?? "http://localhost:18791/v1"`, y en Render `localhost` es el propio
  contenedor de Render. Se anota como deuda aparte; arreglar CORS no los arregla.
- Firmar o restringir por dominio qué sitios pueden incrustar un agente. Ver riesgo R1.

## Riesgos

**R1 — abrir CORS en `/api/chat` deja que cualquier web incruste cualquier agente si conoce su
`publicKey`.** Es el comportamiento *deseado* de un widget embebible: si hubiera que declarar el
dominio de antemano, el producto no se podría instalar copiando y pegando una línea. Lo que sostiene
el gate no es el origen, que el navegador no garantiza y un cliente HTTP puede falsear de todos
modos, sino: la `publicKey`, la puerta de publicación de H3, el metering fail-closed de H1 y el
rate-limit. Si más adelante se quiere restringir por dominio, el sitio natural es una allowlist
**por agente** en BD, no la capa CORS.

**R2 — romper la consola de operador.** El front llama a `/api/chat` **con** credenciales para el
modo prueba. Una capa de incrustación que devuelva `Access-Control-Allow-Origin: *` haría que el
navegador rechazara esa petición. Por eso se refleja el origen concreto y se conservan las
credenciales cuando está en la allowlist (§D3).

**R3 — relajar CORP en `back/public/` abre todo lo que se ponga ahí en el futuro.** Hoy hay un solo
fichero. La cabecera se pone en el montaje del estático, no global, y queda una prueba que lo fija.

## Invariante de seguridad que NO se toca

Abrir CORS sin credenciales **no** debilita el gate `Boolean(test) && Boolean(req.user)` de
`ai.ts:76`; lo aprieta. Sin credenciales no viaja cookie, `req.user` nunca se resuelve, y `test: true`
desde una página ajena sigue siendo imposible. Ya se comprobó en producción: hoy devuelve 403.

## Dependencias

Ninguna nueva. `cors` y `helmet` ya están. No hay migración.
