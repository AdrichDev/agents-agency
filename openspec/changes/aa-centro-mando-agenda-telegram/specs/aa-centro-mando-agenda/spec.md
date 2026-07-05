# Spec ? Centro de Mando, Agenda y Telegram UI en Agents Agency

## UC-1 ? Sidebar Centro de Mando
**DADO** un usuario autenticado en Agents Agency
**CUANDO** se renderiza el sidebar
**ENTONCES** el sistema DEBE mostrar el t?tulo `Centro de Mando` y secciones con tipograf?a/estilo equivalente a OperaOS.

- AC-1.1 `Nombre grupal` DEBE renombrarse a `?rea de Trabajo`.
- AC-1.2 `?rea de Trabajo` DEBE incluir `Agenda` adem?s de los items actuales.

## UC-2 ? Agenda full-screen clonada de OperaOS
**DADO** la vista de agenda definida en el widget principal de OperaOS
**CUANDO** el usuario abre `/agenda` en Agents Agency
**ENTONCES** la UI DEBE mostrar la misma experiencia visual a pantalla completa.

- AC-2.1 Mes, semana, d?a, tarjetas de cita y navegaci?n DEBEN conservar el patr?n OperaOS.
- AC-2.2 La vista DEBE cargar citas reales del tenant, no solo mock local.

## UC-3 ? Detalle enriquecido de cita
**DADO** una cita con cliente asociado
**CUANDO** el usuario abre el detalle
**ENTONCES** el sistema DEBE mostrar nombre comercial, persona de contacto, tel?fono, direcci?n y luego los datos existentes.

- AC-3.1 El bot?n `?? Ubicaci?n` DEBE estar debajo de `Anotaciones`.
- AC-3.2 Si hay direcci?n v?lida, DEBE abrir Google Maps; si no, DEBE estar desactivado.

## UC-4 ? Sincronizaci?n calendario tenant-aware
**DADO** un tenant con Google Calendar u otro proveedor conectado
**CUANDO** se crea, edita o cancela una cita
**ENTONCES** el sistema DEBE reflejar el cambio en el calendario externo conectado.

- AC-4.1 Google Calendar es el proveedor inicial obligatorio.
- AC-4.2 Outlook u otro proveedor DEBER?A quedar detr?s de un puerto com?n.

## UC-5 ? Telegram como UI operativa
**DADO** una conversaci?n Telegram conectada a un agente
**CUANDO** entran o salen mensajes
**ENTONCES** la app DEBE mostrar la conversaci?n en directo y permitir responder manualmente.

- AC-5.1 Los mensajes manuales DEBEN enviarse por Telegram Bot API y registrarse con idempotencia.
- AC-5.2 La UI NO DEBE romper el bot ni duplicar respuestas autom?ticas.

