# Diseño — aa-widget-error-visitante

## D1 — El criterio es QUIÉN LEE, no qué falló

Rechazado: decidir por el flag `test` del cuerpo. Ese flag lo manda el cliente y ya está atado a
sesión por otro motivo (H1). Mezclar "es una prueba" con "puedo enseñar el motivo" acopla dos cosas
que cambian por separado.

**Elegido:** `req.user` presente ⇒ hay sesión de operador ⇒ mensaje real. Ausente ⇒ es un visitante
en la web de un tercero ⇒ mensaje genérico. Una sola condición, y es exactamente la pregunta que
importa.

Consecuencia buscada: la consola del operador (`ChatTester.tsx`, que recibe el motivo por excepción
de `api<>`) sigue viendo "Se ha agotado el cupo…" y sabe qué arreglar. El visitante nunca.

## D2 — Deny by default: el texto del error original NUNCA se copia

Rechazado: sanear el mensaje (quitar URLs, recortar). Un filtro por lista negra falla en cuanto el
proveedor cambia el texto, y falla en silencio.

**Elegido:** el mensaje al visitante sale de una **tabla cerrada** indexada por status. La entrada
(`e`) sólo se usa para elegir la fila. Ni un carácter del error original viaja al visitante.

| status entrante | `code` | texto al visitante |
|---|---|---|
| 400 | `BAD_REQUEST` | "No he podido procesar ese mensaje." |
| 402 | `SERVICE_LIMIT` | "Este asistente no está disponible en este momento." |
| 403 | `AGENT_UNAVAILABLE` | "Este asistente no está disponible en este momento." |
| 404 | `AGENT_NOT_FOUND` | "Este asistente no está disponible en este momento." |
| 429 | `RATE_LIMITED` | "Estás enviando mensajes muy rápido. Espera un momento." |
| resto 4xx | `AGENT_UNAVAILABLE` | "Este asistente no está disponible en este momento." |
| 5xx / desconocido | `INTERNAL` | "Ahora mismo no puedo responder. Inténtalo de nuevo en un momento." |

Tres motivos distintos comparten frase a propósito: al visitante le da igual si es cupo, impago o
agente despublicado — no puede hacer nada con esa diferencia, y cada matiz es una fuga. El `code`,
que es máquina y no frase, conserva la distinción para soporte (R2).

**Ninguna fila menciona** proveedor, cupo, pago, clave, cliente ni tenant. Ese es el invariante que
prueba E7.

## D3 — El status NO cambia

`webhook-shared.ts:34` corta por `e.status === 402` y `service-telegram.ts:141` depende del mismo
hecho. Tocar el status por "limpieza" dejaría los canales diciendo "ha ocurrido un error" en un corte
por cupo, que es justo lo que H1 arregló. Se conserva el status y se cambia sólo el texto.

Excepción que sí es un arreglo: un error **no** `HttpError` seguirá siendo `500`, pero ahora se
registra (D4). Antes salía como `500` y desaparecía.

## D4 — Los 5xx de esta ruta van a Sentry

Hoy no van: el catch responde con `res.json()` sin `next(e)`, así que `errorHandler`
(`observability.ts:80`) nunca los ve. Se llama `captureError` explícitamente en el catch para
`status >= 500`, con `agentId` y `requestId`.

Los `4xx` no se capturan — son estado de servicio esperado, misma regla que `errorHandler`. Se
registran con `logger.warn` sin stack para no llenar el log de cortes por cupo.

## D5 — El helper vive en `src/lib/agent/visitor-error.ts`

Módulo propio, sin dependencias de Express, para que E7 lo pruebe como función pura:

```ts
export type VisitorError = { status: number; error: string; code: string };
export function visitorError(e: unknown): VisitorError;
```

No se mete en `http.ts` (genérico del transporte) ni en `webhook-shared.ts` (política de canales de
mensajería, que es distinta por decisión de H1: allí el 402 sí se propaga literal).

## D6 — El 404 temprano también pasa por el helper

`ai.ts:60` responde `{ error: "Agente no encontrado" }` **antes** del `try`. Es la respuesta que ve
un widget mal instalado, en la web de un tercero. Pasa por la misma tabla para que no haya dos
caminos de salida con dos políticas.

## D7 — El widget deja de confiar a ciegas

`widget.js` hace hoy `data.text || data.error || "Error"`. Con el back saneado ya no filtra, pero se
añade defensa en profundidad, que es barata en un fichero que se sirve a webs ajenas:

- Si la respuesta no es `ok` y no trae `error`, se pinta un texto propio del widget en vez de la
  cadena `"Error"` pelada.
- `r.json()` se protege: un `502` de Render en arranque en frío devuelve HTML y hoy revienta el
  `.then`, cayendo en "Error de conexión" — mensaje equivocado para un fallo del servidor.

No se toca el flujo feliz ni el `conversationId`.

## Ficheros

| Fichero | Cambio |
|---|---|
| `back/src/lib/agent/visitor-error.ts` | **nuevo** — tabla cerrada + `visitorError()` |
| `back/src/routes/ai.ts` | catch de `/api/chat` y 404 temprano; `captureError` en 5xx |
| `back/public/widget.js` | no pintar `data.error` a ciegas; `r.json()` protegido |
| `back/tests/visitor-error.test.ts` | **nuevo** — E1-E7 |
| `back/tests/widget-js-error.test.ts` | **nuevo** — E8-E9 (jsdom, patrón de `widget-js-identidad`) |

## Estrategia de prueba

Router real montado con el patrón ya existente en `metering-chat-route.test.ts`
(`buildApp({authenticated})` + `rawRequest`), con `chatWithAgent` mockeado para inyectar cada tipo de
fallo. El widget se prueba en jsdom cargando el fichero real, como en `widget-js-identidad.test.ts`.

Rojo-verde: E1 y E2 deben **fallar** contra el `ai.ts` actual. Se comprueba antes de dar por hecha
ninguna tarea.
