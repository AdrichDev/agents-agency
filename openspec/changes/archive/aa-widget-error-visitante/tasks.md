# Tareas — aa-widget-error-visitante

Nivel 2. Toca la respuesta de una ruta pública y un fichero servido a webs de terceros. Reversible.
Una tarea está hecha sólo cuando su prueba está verde.

## T1 — El visitante deja de leer nuestros errores

- [x] **T1.1** `src/lib/agent/visitor-error.ts`: tabla cerrada de D2 y `visitorError(e)`. La entrada
      sólo elige fila; su texto nunca se copia.
      *Test:* E7 ✅ (4 casos, incluido el invariante sobre la tabla entera).
- [x] **T1.2** Catch de `/api/chat`: status conservado, texto de la tabla si no hay `req.user`,
      mensaje real si lo hay.
      *Test:* E1 ✅, E2 ✅, E3 ✅ (visitante) y E4 ✅ (operador, 2 casos).
- [x] **T1.3** El 404 temprano sale por el mismo helper.
      *Test:* E5 ✅.

## T2 — Los fallos reales dejan de ser invisibles

- [x] **T2.1** `captureError` en el catch para `status >= 500`, con `agentId` y `requestId`. Los
      `4xx` a `logger.warn` sin stack.
      *Test:* E6 ✅ (y el negativo: un 402 NO se captura).

## T3 — El widget no confía a ciegas

- [x] **T3.1** No pintar `data.error` sin más: `r.json()` protegido y texto propio de respaldo.
      *Test:* E8 ✅ (2 casos), E9 ✅ (4 casos, incluida la no-regresión del camino feliz).

## T4 — Verificación

- [x] **T4.1** Rojo-verde comprobado. Contra el `ai.ts` de HEAD: **5 rojos** (E1, E2, E3, E5, E6).
      Contra el `widget.js` de HEAD (`git show HEAD:./public/widget.js`): **3 rojos** de E9.
      E4 y E7 ya pasaban, y debían: E4 describe lo que NO se rompe y E7 prueba el helper nuevo.
      E8 también pasaba con el widget viejo — mide el back, no el widget; es E9 la que mide el
      widget. Anotado para que nadie lea E8 como demostración de T3.1.
- [x] **T4.2** `npx tsc --noEmit` EXIT=0. Suite completa: **142/142 ficheros, 1624 pruebas verdes**,
      0 fallos. Los `market-study*` pasaron esta vez.
- [x] **T4.3** Revisión antes de commitear. Ver "Hallazgos de la revisión".
- [x] **T4.4** Corregida la anotación falsa en `aa-widget-entrega-cross-origin/tasks.md` y la deuda
      de `aa-widget-saludo-identidad/tasks.md`.

## Hallazgos de la revisión (T4.3)

- **Un test existente afirmaba lo contrario de este cambio.** `metering-chat-route.test.ts:105`
  exigía `expect(res.body.error).toMatch(/límite de uso/i)` para un visitante **sin sesión**. No se
  ha borrado ni relajado: se ha reescrito conservando lo que H1 protegía de verdad —el **status**
  402, para que un corte por cupo no parezca una caída— y trasladando la comprobación del motivo a
  `code`. El motivo textual sigue probado, pero en E4, donde hay operador.
- **`/api/prompt/improve` (`ai.ts:50`) también devuelve `e.message` crudo del proveedor.** Se deja
  como está: **no** figura en la allowlist de `public-routes.ts`, así que exige sesión de operador y
  el que lo lee es de la casa. Si algún día se hiciera pública, hereda el bug.
- **`/api/widget/config` sí es pública y no se toca.** Sus 400/404 son constantes fijas, y el 404 de
  agente no publicado es una decisión anti-enumeración de H3 (un 403 confirmaría que la clave
  existe). Meterlo por el helper daría el mismo texto y borraría esa razón del código.
- **Consecuencia aceptada en el 400.** Un integrador sin sesión que olvide `message` recibe ahora
  "No he podido procesar ese mensaje." en vez del motivo. Es el precio del deny-by-default de §D2;
  el `code` (`BAD_REQUEST`) le dice qué mirar y el ejemplo de `curl` de `DeployPanel` es correcto.
- **El 429 del SDK no se reenvía como 429.** Un `APIError` de OpenAI trae `.status = 429`, pero es
  el ritmo del *proveedor*: propagarlo diría al visitante que ha escrito demasiado rápido cuando
  quien no tiene saldo somos nosotros. `visitorError` sólo confía en `HttpError`. Con prueba propia.
- **Identificadores en inglés en `widget.js`** (`FALLBACK_ERROR`), como el resto del fichero;
  comentarios en español. En el back, castellano, como sus vecinos.

## G — Gates humanos

- [x] **G1** Aprobación para desplegar. ✅ Aprobado y desplegado el 27/07/2026 (`b25ce18` en
      `master`). Verificado contra producción real, con `Origin: https://cliente.example` — es
      decir, como lo ve el visitante de la web de un cliente, no contra el test:

      | Caso | `aa-back-jmyo.onrender.com` |
      |---|---|
      | `widget.js` servido | contiene `FALLBACK_ERROR` (fichero nuevo en el CDN) |
      | `POST /api/chat`, `publicKey` desconocida | `404` · `{"error":"Este asistente no está disponible en este momento.","code":"AGENT_NOT_FOUND"}` |
      | `POST /api/chat` sin `message` | `400` · `{"error":"No he podido procesar ese mensaje.","code":"BAD_REQUEST"}` |
      | `POST /api/chat` a un agente en `draft` (DorsIA) | `403` · `{"error":"Este asistente no está disponible en este momento.","code":"AGENT_UNAVAILABLE"}` |
      | `POST /api/chat` a **AiAs** publicado | `200` · `"Hola, soy AiAs 😊 ¿En qué puedo ayudarte hoy?"` — sin regresión del camino feliz |

      Ni una de las cuatro respuestas contiene proveedor, cupo, pago, estado del agente ni la frase
      "Agente no encontrado". El `code` conserva el diagnóstico.

## Orden crítico

```
T1.1 → T4.1 → T1.2 → T1.3 → T2.1 → T3.1 → T4.2 → T4.3 → T4.4 → [G1 desplegar]
```

## Fuera de alcance, anotado como deuda

- La cuota de la cuenta OpenAI de la plataforma (facturación, gate humano). Este cambio hace que el
  fallo no se vea feo; **no** hace que el agente responda.
- `Access-Control-Max-Age`: cada carga del widget en una web de cliente paga un preflight extra.
