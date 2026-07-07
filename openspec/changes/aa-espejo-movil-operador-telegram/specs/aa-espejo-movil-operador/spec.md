# Spec delta: espejo móvil del chat operador

## UC-1: Turno enviado desde la web aparece en Telegram

**Actor**: operador (Adrián), usando la web AA.
**Precondición**: sesión `agent:main:main` con canal Telegram enlazado y proveedor de modelo
disponible.

**Given** el operador escribe un mensaje en el chat operador de la web,
**When** el mensaje se envía vía `POST /api/operator-chat/send`,
**Then** el mismo turno (o la respuesta del agente a ese turno) aparece en el chat de Telegram
del bot operador, sin que el operador tenga que interactuar primero desde Telegram.

**AC-1.1**: El mensaje llega a Telegram en menos de 10s con proveedor de modelo sano.
**AC-1.2**: El turno espejado no depende de que el móvil abra Telegram antes.

## UC-2: El historial web no duplica turnos espejados

**Actor**: operador, usando la web AA.
**Precondición**: UC-1 satisfecho (fix de fan-out aplicado, si hizo falta).

**Given** un turno que ya fue espejado hacia Telegram (marcado `openclawDeliveryMirror`),
**When** el operador recarga `GET /api/operator-chat/history`,
**Then** el turno espejado NO aparece duplicado en la transcripción normalizada.

**AC-2.1**: `isDeliveryMirror()` sigue filtrando estos turnos (regresión sobre 5.5a).
**AC-2.2**: El conteo de mensajes visibles en la web no cambia por el hecho de espejar a
Telegram.

## UC-3: Fallo del proveedor de IA no rompe el contrato existente

**Actor**: operador, usando la web AA.

**Given** el proveedor de modelo (Gemini u otro) no disponible,
**When** el operador envía un mensaje,
**Then** `POST /api/operator-chat/send` responde con el código de error ya contratado (502/503)
y el front lo maneja igual que hoy, sin introducir un nuevo modo de fallo por el espejo.

**AC-3.1**: No se añade lógica de reintento ni fallback silencioso específico para el espejo.
**AC-3.2**: `useOperatorChat` no requiere cambios para este caso.
