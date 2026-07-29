# Proposal: buffer de entrada y respuesta partida en canales de mensajería

> Origen: auditoría del vídeo de demostración de Forja (Santiago Muñoz,
> 26/07/2026). De todo lo que muestra, dos funciones son reales, baratas y no
> existen en AA. El resto ya lo teníamos igual o mejor (WhatsApp por Graph API
> oficial con HMAC fail-closed frente a su puente de pago vía Twilio).

## Intent

Que un agente de AA en Telegram o WhatsApp **conteste como una persona**:

1. **Buffer de entrada.** Un cliente rara vez escribe un párrafo. Escribe
   "hola", "oye", "una pregunta", "¿abrís los sábados?" en cuatro mensajes
   seguidos. Hoy el agente responde cuatro veces, y las tres primeras respuestas
   son ruido porque contestan a un mensaje incompleto. Con buffer, el agente
   espera N segundos, agrupa lo recibido y responde **una vez** a la intención
   completa.
2. **Respuesta partida.** Un muro de texto en WhatsApp se lee como un panfleto.
   Partir la respuesta en 2-3 mensajes con una pausa entre ellos es lo que
   separa un bot de un contacto.

## Scope

- `back/src/lib/channels/` — nuevo módulo de buffer, nuevo módulo de troceo, y
  su enganche en los dos webhooks (`telegram-webhook.ts`, `whatsapp-webhook.ts`).
- `back/prisma/schema.prisma` — tres columnas nuevas en `Agent`, **aditivas y
  con default que reproduce el comportamiento actual**.
- Front: control de configuración en la ficha del agente.
- Tests unitarios de ambos módulos + test de integración del webhook.

## Fuera de scope

- Widget web y API REST. El buffer no tiene sentido en un chat con caja de
  texto y botón de enviar: allí el usuario ya agrupa su mensaje. Se aplica
  **sólo** a canales de mensajería asíncrona.
- Persistir el buffer en BD (ver `design.md`, AD1).
- Indicador de "escribiendo…" (`sendChatAction`). Es el siguiente paso natural,
  no éste.

## Efecto lateral deseado: coste

Agrupar 4 mensajes en 1 turno es **1 llamada al LLM en vez de 4**, y con un
historial más corto. Va en la misma dirección que `aa-agentes-economia-tokens`.
No se reclama ninguna cifra hasta medirlo contra `aa.uso_tokens`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Buffer en memoria: un reinicio durante la ventana deja al cliente **sin respuesta** (peor que responder dos veces) | Flush en `SIGTERM`/`SIGINT` (AD3) + ventana con tope duro de 30 s |
| Multi-instancia: dos réplicas del back parten el buffer y responden dos veces | Documentado (AD1). El peor caso es el comportamiento de HOY, no una regresión |
| Latencia percibida: el cliente espera N segundos extra | Default OFF. Se activa por agente y la ventana la elige el dueño |
| Meta/Telegram reintentan el webhook y duplican la entrada en el buffer | `markProcessed` se ejecuta ANTES de bufferizar (AD6) |
| Trocear rompe markdown, enlaces o listas | Corte sólo en frontera de párrafo, nunca a mitad de frase (AD4) |

## Dependencias

- Migración Prisma aditiva → **gate humano** antes de aplicar en producción
  (`prisma migrate status` antes de dar nada por hecho — ver
  `crm-migraciones-sin-aplicar-gotcha`).
- Ninguna dependencia externa nueva.
