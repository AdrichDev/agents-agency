# Design: buffer de entrada y respuesta partida

## Modelo de datos

Tres columnas nuevas en `Agent`. Los defaults **reproducen exactamente el
comportamiento actual**, así que ningún agente ya publicado cambia de conducta
al aplicar la migración.

```prisma
/// Ventana de agrupación de mensajes entrantes, en ms. 0 = desactivado
/// (responde a cada mensaje, comportamiento previo a este cambio).
/// Tope duro en código: INBOUND_BUFFER_MAX_MS.
inboundBufferMs   Int @default(0) @map("buffer_entrada_ms")

/// Máximo de mensajes en los que se parte una respuesta. 1 = sin partir.
replyMaxMessages  Int @default(1) @map("respuesta_max_mensajes")

/// Pausa entre mensajes de una respuesta partida, en ms.
replySplitPauseMs Int @default(0) @map("respuesta_pausa_ms")
```

Se añaden a `Agent` y no a `ChannelConnection` porque es una decisión de **voz
del agente**, no de transporte: el mismo agente debe sonar igual en Telegram y
en WhatsApp.

## AD1 — El buffer vive en memoria, no en BD

`dedup.ts` ya asume estado en memoria con un tradeoff declarado (AD4 de aquel
change). Se sigue el mismo criterio: escribir y leer una fila por **cada
mensaje entrante** para aplazar una respuesta N segundos no se paga solo.

Consecuencias que se aceptan explícitamente:

- **Reinicio del proceso durante la ventana** → los mensajes pendientes se
  pierden. Mitigado por AD3.
- **Multi-instancia** → si Render escala a 2 réplicas, dos mensajes del mismo
  cliente pueden caer en instancias distintas y generar dos respuestas. Eso es
  literalmente el comportamiento de hoy: es una mejora que degrada al estado
  anterior, nunca por debajo.

Si algún día hay volumen que lo justifique, la promoción natural es una tabla
`PendingInbound` con lock por conversación, igual que se anotó para dedup.

## AD2 — Default OFF, activación por agente

`inboundBufferMs = 0` y `replyMaxMessages = 1` dejan el código nuevo en una
rama muerta. Un agente en producción no cambia hasta que su dueño lo enciende.
Esto convierte el despliegue en reversible sin rollback de migración.

## AD3 — Flush en apagado

Sin esto, un deploy (que en Render es rutina) durante la ventana deja al
cliente **esperando una respuesta que nunca llega**. Eso es peor que el
problema que resolvemos.

En `SIGTERM`/`SIGINT`: se vacía el buffer disparando todos los flushes
pendientes y se espera a que terminen, con un tope. No se garantiza entrega —
se garantiza que el fallo es raro y no silencioso (se loguea).

## AD4 — Troceo por frontera de párrafo

El corte se hace **sólo** entre párrafos (`\n\n`) y, si no hay, entre frases
(`.`/`?`/`!` seguidos de espacio). Nunca a mitad de frase, nunca dentro de una
URL, nunca partiendo `*negrita*` de WhatsApp ni una etiqueta HTML de Telegram.

Si tras el troceo hay más trozos que `replyMaxMessages`, **el sobrante se
concatena en el último**. Se prefiere un último mensaje largo a perder texto.

El formateo por canal (`toWhatsAppText` / `toTelegramHtml`) se aplica **a cada
trozo ya cortado**, no antes: cortar sobre el texto ya convertido a HTML podría
dejar una etiqueta abierta.

## AD5 — Topes duros en código

La configuración del dueño no puede degradar el servicio:

- `INBOUND_BUFFER_MAX_MS = 30_000` — techo de la ventana.
- `INBOUND_BUFFER_MAX_MESSAGES = 10` — al décimo mensaje acumulado se dispara
  el flush aunque la ventana no haya vencido. Un cliente que escribe sin parar
  no puede diferir su respuesta indefinidamente.
- `REPLY_MAX_MESSAGES_CAP = 5` — nadie configura un agente que suelte 40
  mensajes seguidos y le tiren el número por spam.

Los valores configurados se recortan a estos topes al leerlos, no al guardarlos:
así un tope que baje en el futuro se aplica a los agentes ya configurados.

## AD6 — Orden respecto al dedup

`markProcessed(dedupKey)` pasa a ejecutarse **al aceptar el mensaje en el
buffer**, no al responder. Motivo: Meta y Telegram reintentan el webhook si no
ven un 200 rápido; si el dedup se marcase al flush, un reintento durante la
ventana metería el mismo texto dos veces en el buffer.

## AD7 — Identidad del turno agregado

Al agrupar N mensajes, el turno resultante necesita un id:

- Telegram: se usa el `updateId` **del último** mensaje del grupo para
  `fanOutTelegramToCrm` (`tg-update-<id>` / `aa-auto-<id>`).
- El texto que recibe `chatWithAgent` es el join de los mensajes con `\n`, en
  orden de llegada.

## Flujo

```
webhook recibe mensaje
  ├─ valida firma/secreto, dedup, credenciales     (SIN CAMBIOS)
  ├─ casos especiales (no-texto, /start pairing)   (SIN CAMBIOS, no bufferizan)
  ├─ inboundBufferMs == 0 ──> camino actual, intacto
  └─ inboundBufferMs > 0
       ├─ push(text) en buffer[canal:agentId:externalId]
       ├─ markProcessed + res 200                  (inmediato)
       └─ timer reiniciado
            └─ al vencer (o al llegar al tope de mensajes):
                 ├─ chatWithAgent(join(textos))    (1 sola vez)
                 ├─ splitReply(texto, max, ...)
                 └─ enviar trozos con pausa entre ellos
```

## Ficheros

| Fichero | Cambio |
|---|---|
| `back/prisma/schema.prisma` | 3 columnas en `Agent` |
| `back/prisma/migrations/*_agent_inbound_buffer/` | migración aditiva |
| `back/src/lib/channels/inbound-buffer.ts` | **nuevo** — buffer + timers + flush |
| `back/src/lib/channels/reply-split.ts` | **nuevo** — troceo puro, sin I/O |
| `back/src/lib/channels/telegram-webhook.ts` | enganche |
| `back/src/lib/channels/whatsapp-webhook.ts` | enganche |
| `back/src/index.ts` | registro del flush en SIGTERM/SIGINT |
| `back/tests/reply-split.test.ts` | **nuevo** |
| `back/tests/inbound-buffer.test.ts` | **nuevo** |
| front — ficha del agente | controles de configuración |

## Estrategia de test

- `reply-split.ts` es una función pura: se testea directa, sin mocks. Casos:
  sin partir (`max=1`), corte por párrafo, corte por frase, sobrante al último
  trozo, texto sin fronteras (una frase larga → un solo trozo), URL intacta.
- `inbound-buffer.ts` se testea con timers falsos de vitest: N mensajes dentro
  de la ventana → **una** llamada al flush con el texto unido; tope de mensajes
  dispara antes; mensajes de conversaciones distintas no se mezclan; el flush
  de apagado vacía lo pendiente.
- Regresión: los tests existentes de webhook deben seguir verdes **sin
  tocarlos**. Es la prueba de que el default no cambia nada.
