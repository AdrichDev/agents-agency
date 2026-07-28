# Validation: aa-espejo-movil-operador-telegram

**Historia**: Como Adrián (operador), quiero que un mensaje que escribo en la web (AA) llegue
también a mi Telegram, para poder seguir la conversación con el Minion desde el móvil sin
depender de haber abierto Telegram antes.

**AC1**: Enviar un mensaje vía `POST /api/operator-chat/send` (AA back) hace que el mismo texto
aparezca en el chat de Telegram del bot operador, en un plazo razonable (< 10s asumiendo
proveedor de modelo disponible).
**AC2**: Si el espejo NO es automático, el fix (`message send --channel telegram` tras
`chatSend`) lo hace posible sin duplicar el turno original en el historial (`chat.history`
sigue filtrando delivery-mirrors como ya hace `operator-chat.ts`).
**AC3**: El fallo del proveedor de IA (Gemini u otro) no debe romper silenciosamente el
resultado — si `chatSend` fallara, el front ya maneja 502/503 (`useOperatorChat`), sin cambios
necesarios ahí.

## Por tarea (Given-When-Then)

### Confirmar/forzar espejo web→Telegram

- **Given** una sesión de operador compartida (`agent:main:main`) con Telegram enlazado,
- **When** se envía un mensaje desde la web (AA) vía `chatSend`,
- **Then** el mismo mensaje (o su respuesta del agente) aparece en el chat de Telegram del móvil.
  _Test: smoke manual con proveedor de modelo sano — enviar desde `/api/operator-chat/send` y
  verificar en la app de Telegram del bot operador._

- **Given** el espejo confirmado como NO automático,
- **When** se añade la llamada a `message send --channel telegram` en `operator-chat.ts` tras
  un `chatSend` exitoso,
- **Then** el test manual anterior pasa a ser verde sin regresión en `chat.history`
  (delivery-mirrors siguen filtrados, historial no duplica turnos).
  _Test: back test unitario de `operator-chat.test.ts` + smoke manual._
