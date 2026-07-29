# Validation

## Historia de usuario

> Como **dueño de un negocio** con un agente de AA en WhatsApp, quiero que el
> bot **espere a que termine de escribir** mi cliente y le conteste **en varios
> mensajes cortos**, para que la conversación se lea como la de una persona y
> no como un formulario automático.

## Criterios de aceptación

- **AC1** — Varios mensajes seguidos del mismo cliente dentro de la ventana
  producen **una sola** respuesta, generada sobre el texto completo.
- **AC2** — Con la configuración por defecto (`inboundBufferMs = 0`,
  `replyMaxMessages = 1`) el comportamiento es **idéntico** al anterior a este
  change: los tests de canal existentes pasan sin modificarse.
- **AC3** — Una respuesta configurada para partirse llega en varios mensajes,
  cortados en frontera de párrafo o frase, **sin perder ni un carácter** del
  texto original.
- **AC4** — La ventana y el número de mensajes acumulados están acotados por
  los topes de código, aunque la configuración del agente pida más.
- **AC5** — Al apagar el proceso, los mensajes pendientes en el buffer se
  procesan en vez de perderse en silencio.
- **AC6** — Mensajes de conversaciones distintas nunca se mezclan en el mismo
  turno.
- **AC7** — Un reintento del webhook (mismo `messageId`/`updateId`) no duplica
  el texto en el buffer.
- **AC8** — El troceo no rompe el formato del canal: enlaces, negritas y
  etiquetas llegan íntegros.

## Escenarios Given-When-Then

### GWT1 — Agrupación (AC1) → `T2`

> **Given** un agente con `inboundBufferMs = 3000`
> **When** el mismo cliente envía "hola", "oye" y "¿abrís hoy?" en 1 segundo
> **Then** `chatWithAgent` se invoca **una vez** con `"hola\noye\n¿abrís hoy?"`
> y se envía **una** respuesta.

### GWT2 — Default intacto (AC2) → `T2`

> **Given** un agente con `inboundBufferMs = 0`
> **When** llega un mensaje por el webhook de WhatsApp
> **Then** se responde en la misma petición, sin temporizador, exactamente como
> antes del change.

### GWT3 — Troceo (AC3) → `T1`

> **Given** `replyMaxMessages = 3` y una respuesta de cuatro párrafos
> **When** se trocea
> **Then** se obtienen 3 trozos, el cuarto párrafo va concatenado en el tercero,
> y la concatenación de los trozos contiene todo el texto original.

### GWT4 — Tope de mensajes (AC4) → `T1`

> **Given** `inboundBufferMs = 30000` y el tope
> `INBOUND_BUFFER_MAX_MESSAGES = 10`
> **When** el cliente envía 10 mensajes sin que venza la ventana
> **Then** el flush se dispara al décimo, sin esperar los 30 segundos.

### GWT5 — Flush en apagado (AC5) → `T3`

> **Given** un buffer con mensajes pendientes
> **When** el proceso recibe `SIGTERM`
> **Then** se dispara el flush de todo lo pendiente antes de terminar.

### GWT6 — Aislamiento por conversación (AC6) → `T1`

> **Given** dos clientes distintos escribiendo al mismo agente a la vez
> **When** vencen sus ventanas
> **Then** cada uno recibe una respuesta construida **sólo** con sus mensajes.

### GWT7 — Reintento del webhook (AC7) → `T2`

> **Given** un mensaje ya aceptado en el buffer
> **When** el proveedor reintenta el mismo `messageId`
> **Then** el texto no se añade una segunda vez y se responde 200.

### GWT8 — Formato íntegro (AC8) → `T1`

> **Given** una respuesta con una URL y texto en negrita
> **When** se trocea y se formatea por canal
> **Then** ningún trozo contiene una URL partida ni una marca de formato
> desemparejada.

## Test por tarea

| Tarea | Test | Fichero |
|---|---|---|
| T1 — troceo + buffer (lógica pura) | GWT3, GWT4, GWT6, GWT8 | `back/tests/reply-split.test.ts`, `back/tests/inbound-buffer.test.ts` |
| T2 — enganche en webhooks | GWT1, GWT2, GWT7 | `back/tests/channel-inbound-buffer.test.ts` |
| T3 — flush en apagado | GWT5 | `back/tests/inbound-buffer.test.ts` |
| T4 — migración | `prisma migrate status` limpio + suite verde | — |
| T5 — front | verificación visual del panel | — |

## Gate humano

- Aplicación de la migración en producción.
- Encendido del buffer en cualquier agente con tráfico real.
