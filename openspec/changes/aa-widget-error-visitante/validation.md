# Validación — aa-widget-error-visitante

## Historia de usuario

> Como **dueño del negocio que paga la plataforma**, quiero que un fallo del asistente le diga a mi
> visitante "ahora mismo no puedo responder" y nada más, para que un problema de facturación o una
> caída del proveedor no se convierta en información sobre mi negocio delante de un cliente
> potencial.

> Como **operador**, quiero seguir viendo el motivo exacto cuando pruebo mi agente desde la consola,
> para saber si tengo que subir el cupo o publicar el agente.

## Criterios de aceptación

- **AC1** — Ningún fallo de `POST /api/chat` devuelve a un cliente sin sesión texto procedente del
  error original. El cuerpo sale íntegramente de la tabla de D2.
- **AC2** — El `status` HTTP se conserva: un `HttpError(402)` sigue siendo `402`. Sólo cambia el
  texto.
- **AC3** — Con sesión de operador (`req.user`), el mensaje real llega intacto.
- **AC4** — Los `5xx` de esta ruta se registran en Sentry con `agentId` y `requestId`. Los `4xx` no.
- **AC5** — El widget nunca pinta `undefined`, ni la cadena pelada `"Error"`, ni revienta si la
  respuesta no es JSON.

## Escenarios

### E1 — El error del proveedor no llega al visitante *(AC1, AC2)*

**Dado** un agente con `publicKey` válida y `chatWithAgent` que lanza un error corriente con el
mensaje `429 You exceeded your current quota, please check your plan and billing details.
https://platform.openai.com/docs/guides/error-codes/api-errors`
**Cuando** un cliente **sin sesión** hace `POST /api/chat`
**Entonces** el status es `500`, `body.code` es `INTERNAL`, y `body.error` **no contiene** `quota`,
`openai`, `billing` ni `429`.
*Test:* `visitor-error.test.ts` → "no filtra el error del proveedor".
*Rojo esperado contra el código actual.*

### E2 — El impago no se le cuenta al visitante *(AC1, AC2)*

**Dado** `chatWithAgent` que lanza `HttpError(402, MSG_IMPAGO)`
**Cuando** un cliente sin sesión hace `POST /api/chat`
**Entonces** el status sigue siendo `402`, `body.code` es `SERVICE_LIMIT` y `body.error` **no
contiene** `pago`, `suscripción` ni `Regulariza`.
*Test:* "no filtra la condición de pago".
*Rojo esperado contra el código actual.*

### E3 — Estado del agente tampoco *(AC1)*

**Dado** `HttpError(403, "Este asistente todavía no está publicado. Contacta con el administrador.")`
**Cuando** un cliente sin sesión hace `POST /api/chat`
**Entonces** status `403`, `code` `AGENT_UNAVAILABLE`, y el texto es el genérico de la tabla.

### E4 — El operador sigue viendo el motivo *(AC3)*

**Dado** el mismo `HttpError(402, MSG_IMPAGO)`
**Cuando** la petición llega **con sesión** (`buildApp({authenticated: true})`)
**Entonces** `body.error` es el mensaje real, palabra por palabra.
*Este escenario es la red de seguridad de R1: si se cae, hemos cegado la consola.*

### E5 — Agente inexistente *(AC1, D6)*

**Dado** una `publicKey` que no existe
**Cuando** un cliente sin sesión hace `POST /api/chat`
**Entonces** status `404` y `code` `AGENT_NOT_FOUND`, con el texto genérico — no `"Agente no
encontrado"`.

### E6 — Los 5xx se ven en Sentry, los 4xx no *(AC4)*

**Dado** un espía sobre `captureError`
**Cuando** llega primero un fallo corriente (500) y después un `HttpError(402)`
**Entonces** `captureError` se llamó **una** vez, con el primero, y el contexto lleva `agentId`.

### E7 — Invariante de la tabla *(AC1)*

**Dado** la tabla de D2 completa
**Entonces** ningún texto contiene `openai`, `token`, `cupo`, `pago`, `suscripción`, `clave`,
`cliente` ni `tenant` (sin distinguir mayúsculas); y `visitorError(new Error(SECRETO))` no contiene
`SECRETO` para un secreto arbitrario.
*Prueba la política, no una llamada concreta: una fila nueva mal redactada la rompe.*

### E8 — El widget pinta el genérico, no `undefined` *(AC5)*

**Dado** el `widget.js` real en jsdom y `/api/chat` respondiendo `500` con
`{"error":"Ahora mismo no puedo responder. Inténtalo de nuevo en un momento.","code":"INTERNAL"}`
**Cuando** el visitante envía un mensaje
**Entonces** la burbuja del asistente muestra ese texto, y no queda ningún `...` pendiente.

### E9 — Respuesta que no es JSON *(AC5)*

**Dado** `/api/chat` respondiendo `502` con cuerpo HTML (arranque en frío de Render)
**Cuando** el visitante envía un mensaje
**Entonces** la burbuja muestra el texto de fallo del propio widget y no la palabra `undefined` ni un
`[object Object]`.

## Mapa tarea → prueba

| Tarea | Escenario |
|---|---|
| T1.1 tabla + helper | E7 |
| T1.2 catch de `/api/chat` | E1, E2, E3, E4 |
| T1.3 404 temprano | E5 |
| T2.1 Sentry en 5xx | E6 |
| T3.1 widget defensivo | E8, E9 |
