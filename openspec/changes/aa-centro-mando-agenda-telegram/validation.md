# Validaci?n ? aa-centro-mando-agenda-telegram

Historia: como usuario de Agents Agency quiero un `Centro de Mando` con agenda completa y Telegram integrado, para gestionar citas, ubicaci?n y conversaciones sin salir de la aplicaci?n.

## Criterios de aceptaci?n (AC)
- **AC1:** el t?tulo del sidebar muestra `Centro de Mando` y los t?tulos de secci?n usan la misma tipograf?a/estilo que OperaOS.
- **AC2:** `Nombre grupal` pasa a `?rea de Trabajo` e incluye `Dashboard`, `Mi cuenta`, `Configuraci?n` y `Agenda`.
- **AC3:** `/agenda` replica exactamente la vista del widget principal de OperaOS, pero a pantalla completa.
- **AC4:** el detalle de cita muestra cliente comercial, persona de contacto, tel?fono, direcci?n y despu?s los datos actuales.
- **AC5:** debajo de anotaciones existe bot?n `?? Ubicaci?n`, desactivado si no hay direcci?n y activo si puede abrir Google Maps.
- **AC6:** el CRUD de agenda sincroniza con Google Calendar del tenant o proveedor equivalente conectado.
- **AC7:** la UI de Telegram muestra mensajes en directo y permite escribir desde AA sin duplicar env?os.

## Por tarea (Dado-Cuando-Entonces + test)
- **WU1 navegaci?n** ? **DADO** el sidebar abierto, **CUANDO** se renderiza, **ENTONCES** muestra `Centro de Mando`, `?rea de Trabajo` y `Agenda` con estilo OperaOS. Test: navegaci?n/UI.
- **WU2 agenda full-screen** ? **DADO** la agenda OperaOS, **CUANDO** se abre `/agenda`, **ENTONCES** AA muestra la misma estructura visual adaptada a pantalla completa. Test: snapshot visual.
- **WU3 detalle cita** ? **DADO** una cita con cliente y direcci?n, **CUANDO** se abre el detalle, **ENTONCES** muestra los datos enriquecidos y el bot?n de Google Maps activo. Test: modal/detail.
- **WU4 calendario** ? **DADO** un tenant con Google Calendar conectado, **CUANDO** se crea/edita/cancela una cita, **ENTONCES** el evento remoto queda sincronizado. Test: contract/e2e con mock proveedor.
- **WU5 Telegram UI** ? **DADO** mensajes entrantes de Telegram, **CUANDO** llegan al webhook, **ENTONCES** aparecen en la UI en directo y permiten respuesta manual idempotente. Test: websocket/polling + API.

> Regla del repo: una tarea est? DONE solo cuando su test est? verde. Sin spec, no hay implementaci?n v?lida.

