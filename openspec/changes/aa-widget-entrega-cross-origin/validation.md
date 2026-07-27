# Validación — aa-widget-entrega-cross-origin

## Historia de usuario

**Como** dueño de un negocio que ha contratado un agente,
**quiero** pegar una línea de `<script>` en mi web y que el asistente aparezca y conteste,
**para** que lo que pago sirva de algo en mi sitio, no sólo en el panel del proveedor.

## Criterios de aceptación

- **AC1** — `GET /widget.js` sale con `Cross-Origin-Resource-Policy: cross-origin`, de modo que un
  navegador lo carga desde cualquier dominio.
- **AC2** — El resto de respuestas de la API conserva `same-origin`. Relajar el estático no relaja la
  API.
- **AC3** — `POST /api/chat` con `Origin` ajeno responde con `Access-Control-Allow-Origin` reflejando
  ese origen y **sin** `Access-Control-Allow-Credentials`.
- **AC4** — El preflight `OPTIONS` de esas mismas rutas responde 2xx, no 500.
- **AC5** — `POST /api/chat` desde un origen **de la allowlist** conserva
  `Access-Control-Allow-Credentials: true`, para que la consola de operador siga funcionando.
- **AC6** — Una ruta **no** incrustable (`POST /api/auth/login`) con `Origin` ajeno sigue rechazada, y
  responde **403**, no 500.
- **AC7** — Toda ruta incrustable es también pública. Ninguna excepción.
- **AC8** — `test: true` desde un origen ajeno sigue sin eximir del gate: sin credenciales no hay
  sesión, y sin sesión no hay exención.
- **AC9** — Ninguna petición sin cabecera `Origin` (servidor a servidor) cambia de comportamiento.

## Escenarios

**E1 — el script se puede incrustar (AC1)**
*Dado* el back en producción,
*cuando* se pide `GET /widget.js`,
*entonces* la respuesta lleva `Cross-Origin-Resource-Policy: cross-origin`.

**E2 — la API no se relaja de rebote (AC2)**
*Dado* el back en producción,
*cuando* se pide `GET /health`,
*entonces* la respuesta **no** lleva `Cross-Origin-Resource-Policy: cross-origin`.

**E3 — el widget puede hablar desde fuera (AC3, AC4)**
*Dado* `NODE_ENV=production` y `https://cliente-cualquiera.com` fuera de la allowlist,
*cuando* llega `OPTIONS /api/chat` con ese `Origin`,
*entonces* responde 2xx con `Access-Control-Allow-Origin: https://cliente-cualquiera.com`
y **sin** `Access-Control-Allow-Credentials`.

**E3b — y la petición REAL también, no sólo el preflight (AC3)**
*Dado* lo mismo que E3,
*cuando* llega el `POST /api/chat` de verdad con ese `Origin`,
*entonces* responde 200 con el origen reflejado y **sin** `Access-Control-Allow-Credentials`.
Escenario añadido durante T2: con las dos capas encadenadas, E3 pasaba y esto fallaba con 403 — el
widget seguía roto un paso más tarde. Un escenario que sólo cubre el preflight no prueba la entrega.

**E4 — la consola de operador no se rompe (AC5)**
*Dado* `FRONT_URL` en la allowlist,
*cuando* llega `POST /api/chat` con `Origin: <FRONT_URL>`,
*entonces* responde con ese origen reflejado **y** `Access-Control-Allow-Credentials: true`.

**E5 — lo que exige sesión sigue cerrado, y con el código correcto (AC6)**
*Dado* `NODE_ENV=production`,
*cuando* llega `POST /api/auth/login` con `Origin: https://cliente-cualquiera.com`,
*entonces* responde **403** y el cuerpo no filtra detalles internos.

**E6 — incrustable implica público (AC7)**
*Dado* el conjunto de reglas de `EMBED_RULES`,
*cuando* se comprueba cada una contra `isPublic()`,
*entonces* todas pasan. Una ruta incrustable que exigiera sesión sería un agujero.

**E7 — abrir CORS no abre el modo prueba (AC8)**
*Dado* un agente publicado y un origen ajeno sin cookie de sesión,
*cuando* se manda `POST /api/chat` con `test: true`,
*entonces* la conversación **no** se marca como de prueba y el consumo se contabiliza igual que una
normal.

**E8 — servidor a servidor intacto (AC9)**
*Dado* una petición sin cabecera `Origin`,
*cuando* llega a cualquier ruta,
*entonces* se comporta exactamente igual que antes del cambio.

**E9 — la prueba que encontró el fallo, en verde (AC1, AC3)**
*Dado* una página servida en `http://127.0.0.1:8899` que embebe el `widget.js` de producción,
*cuando* se abre la burbuja y se manda un mensaje a un agente **publicado**,
*entonces* el widget pinta una respuesta del bot y no hay ningún
`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` en consola.

## Prueba por tarea

| Tarea | Prueba |
|---|---|
| T1 `isEmbeddable()` | `public-routes.test.ts`: tabla de las 6 rutas incrustables + no-incrustables + E6 |
| T2 CORS por ruta | `cors-incrustacion.test.ts`: E3, E3b, E4, E8 |
| T3 rechazo 403 | `cors-incrustacion.test.ts`: E5 |
| T4 CORP estático | `cors-incrustacion.test.ts`: E1, E2 |
| T5 no-regresión | suite completa del back en verde; E7 cubierto por los tests de `ai.ts` ya existentes |
| T6 post-despliegue | E9 con Playwright, tras publicar un agente |
