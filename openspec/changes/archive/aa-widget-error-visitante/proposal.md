# Propuesta — aa-widget-error-visitante

## Intención

Cuando `/api/chat` falla, el widget pinta el error **tal cual** en la web del cliente, delante de un
visitante que no tiene nada que ver con nuestra relación comercial. Es lo último que puede ver un
cliente potencial del negocio que nos paga.

## Evidencia

Observado en producción durante E9 de `aa-widget-entrega-cross-origin`, en un dominio ajeno:

```
429 You exceeded your current quota, please check your plan and billing details.
https://platform.openai.com/docs/guides/error-codes/api-errors
```

Pintado en la burbuja del asistente, con enlace y todo. Le cuenta al visitante: (a) que por debajo
hay OpenAI, (b) que la cuenta que lo paga no tiene saldo.

## Causa

Dos capas que se confían la una a la otra y ninguna filtra.

**`back/src/routes/ai.ts:88-93`** — el catch devuelve el mensaje del error, sea de quien sea:

```ts
const status = e instanceof HttpError ? e.status : 500;
res.status(status).json({ error: e instanceof Error ? e.message : "Error interno" });
```

Un `429` del SDK de OpenAI no es `HttpError` ⇒ sale como **`500`** con el texto crudo del proveedor.

**`back/public/widget.js`** — el widget lo pinta sin mirar:

```js
renderText(thinking, data.text || data.error || "Error");
```

## Lo que también sale hoy, y es peor que el error de OpenAI

Los `4xx` **sí** llevan mensaje redactado, pero redactado para **el tenant que nos paga**, no para el
visitante de su web. En particular `token-metering.ts:54`:

> "El servicio está suspendido porque hay un pago pendiente. Regulariza la suscripción para
> reactivarlo."

Eso le dice a un cliente potencial de la peluquería que la peluquería nos debe dinero. Comercialmente
es más caro que el error del proveedor. Mismo problema con `openai.ts:205`, que menciona "la clave
propia del cliente" — expone el modelo de facturación.

## Corrección de un diagnóstico anterior

En `aa-widget-entrega-cross-origin/tasks.md:96` se anotó que estos errores "van a Sentry como avería
propia". **Es falso, y es al revés.** `errorHandler` (`observability.ts:80`) sólo hace `captureError`
cuando el error llega por `next(e)`; el catch de `/api/chat` responde directo, así que **ningún fallo
del chat llega nunca a Sentry**. Un `500` real en la ruta que sostiene el producto es hoy invisible.

## La política ya existe en el proyecto — esta ruta se la saltó

`channels/webhook-shared.ts:33` ya resuelve esto para los canales de mensajería:

```ts
if (e instanceof HttpError && e.status === 402) return e.message;
return "Lo siento, ha ocurrido un error.";
```

No se inventa política nueva. Se extiende a la ruta pública que nunca la aplicó, con un matiz que el
canal de Telegram no necesita: en el widget el que lee es **siempre** un tercero.

## Alcance

**Dentro:**
- `back/src/routes/ai.ts` — separar la cara pública de la interna en el catch de `/api/chat`.
- Un helper con la traducción a mensaje de visitante y su `code`.
- `captureError` para los `5xx` de esa ruta, que hoy no se registran.
- `back/public/widget.js` — dejar de pintar `data.error` a ciegas.

**Fuera:**
- Los mensajes de `token-metering.ts` y `lifecycle.ts` **no se tocan**: son correctos para el
  destinatario que se decidió en H4/H6/H1 (el operador) y los consumen `webhook-shared` y la consola.
  Lo que cambia es qué se le enseña **al visitante del widget**.
- La cuota de la cuenta OpenAI (facturación, gate humano).
- `Access-Control-Max-Age` (deuda aparte).

## Riesgos

- **R1 — cegar al operador.** Si el genérico se aplica a todo el mundo, quien prueba su agente en la
  consola deja de ver "no tienes cupo" y no sabe qué arreglar. Se acota decidiendo por **presencia de
  sesión** (`req.user`), no por el flag `test` que manda el cliente.
- **R2 — perder el diagnóstico en soporte.** Si el visitante describe "me sale un error", nadie sabe
  cuál. Se acota devolviendo un `code` estable (máquina, no frase) junto al mensaje genérico, y
  registrando el `5xx` en Sentry con `requestId`.
- **R3 — cambiar un status hacia atrás.** Los `4xx` deben seguir siendo `4xx`: `webhook-shared` corta
  por `status === 402` y romperlo dejaría los canales diciendo "ha ocurrido un error" en un corte por
  cupo. El status no se toca; sólo el texto que va al visitante.
