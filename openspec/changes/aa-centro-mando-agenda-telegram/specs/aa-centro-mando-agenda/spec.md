# Spec — Centro de Mando, Agenda y Telegram UI en Agents Agency

## UC-1 — Sidebar Centro de Mando
**DADO** un usuario autenticado en Agents Agency
**CUANDO** se renderiza el sidebar
**ENTONCES** el sistema DEBE mostrar el título `Centro de Mando` y secciones con tipografía/estilo equivalente a OperaOS.

- AC-1.1 `Nombre grupal` DEBE renombrarse a `Área de Trabajo`.
- AC-1.2 `Área de Trabajo` DEBE incluir `Dashboard` y `Agenda`. `Mi Cuenta` y `Configuración` DEBEN permanecer en el dropdown de ajustes junto a la cuenta logeada. Telegram NO DEBE aparecer como entrada de navegación (acceso vía widget flotante global, patrón creador_CRM).
- AC-1.3 El título DEBE venir de `NAV_TITLE` (fuente única), no de headings hardcodeados.

## UC-2 — Agenda full-screen clonada de OperaOS
**DADO** la vista de agenda definida en el widget principal de OperaOS
**CUANDO** el usuario abre `/agenda` en Agents Agency
**ENTONCES** la UI DEBE mostrar la misma experiencia visual a pantalla completa.

- AC-2.1 Mes, semana, día, tarjetas de cita y navegación DEBEN conservar el patrón OperaOS.
- AC-2.2 La vista DEBE cargar citas reales del tenant, no solo mock local.
- AC-2.3 Con datos reales, la UI NO DEBE anunciar «datos demostrativos».

## UC-3 — Detalle enriquecido de cita
**DADO** una cita con cliente asociado
**CUANDO** el usuario abre el detalle
**ENTONCES** el sistema DEBE mostrar nombre comercial, persona de contacto, teléfono, dirección y luego los datos existentes.

- AC-3.1 El botón `📍 Ubicación` DEBE estar debajo de `Anotaciones`.
- AC-3.2 Si hay dirección válida, DEBE abrir Google Maps; si no, DEBE estar desactivado.

## UC-4 — Sincronización calendario tenant-aware
**DADO** un tenant con Google Calendar u otro proveedor conectado
**CUANDO** se crea, edita o cancela una cita
**ENTONCES** el sistema DEBE reflejar el cambio en el calendario externo conectado.

- AC-4.1 Google Calendar es el proveedor inicial obligatorio.
- AC-4.2 Outlook u otro proveedor DEBERÍA quedar detrás de un puerto común (`CalendarProvider`).
- AC-4.3 La EDICIÓN de cita DEBE propagarse al calendario externo (no solo alta/baja).
- AC-4.4 La cita DEBE ser visible en la cuenta Google Calendar personal del usuario conectada por OAuth.

## UC-5 — Telegram como UI operativa compartida
**DADO** una conversación Telegram conectada a un agente
**CUANDO** entran o salen mensajes
**ENTONCES** la app DEBE mostrar la conversación en directo y permitir responder manualmente, EXCLUSIVAMENTE mediante widget flotante global (patrón creador_CRM). NO DEBE existir página dedicada ni entrada de navegación de Telegram.

- AC-5.1 Los mensajes manuales DEBEN registrarse con idempotencia (`clientMessageId`) y los entrantes deduplicarse por `providerMessageId`.
- AC-5.2 La UI NO DEBE romper el bot ni duplicar respuestas automáticas.
- AC-5.3 La conversación DEBE ser la MISMA en creador_CRM y Agents Agency: OpenClaw + mcp-plataforma actúan de hub único; inbound se fan-outea a ambas apps y el outbound sale SOLO por el hub (`TELEGRAM_SEND_URL`).
- AC-5.4 El cliente final DEBE recibir cada respuesta exactamente UNA vez, responda quien responda (CRM o AA).
- AC-5.5 AA DEBE notificar mensajes nuevos (badge de no-leídos y toast) con latencia de polling ≤5s.

## UC-6 — Creación de agente respaldada por OpenClaw
**DADO** el wizard de creación de agente en Agents Agency
**CUANDO** el usuario completa Cliente → Sector → Canal → Personalidad → Skills → Revisar
**ENTONCES** el agente DEBE crearse realmente en OpenClaw y Agents Agency DEBE limitarse a mostrarlo.

- AC-6.1 El paso Cliente DEBE ser un desplegable con los nombres comerciales de los clientes existentes (`GET /api/clients`), con opción explícita de crear cliente nuevo.
- AC-6.2 Al seleccionar cliente, el sector DEBE autocompletarse desde `Tenant.sector` (editable).
- AC-6.3 El agente DEBE crearse con `runtime=openclaw` y vincularse al `tenantId` seleccionado sin crear Tenant duplicado.
- AC-6.4 El provisioning DEBE sincronizar identity, systemPrompt y parámetros en `config.agents.list` con clave estable `aa-<agentId>`, y el canal Telegram DEBE ser por agente (sin sobrescribir un token global).
- AC-6.5 Tras provisionar, el sistema DEBE verificar con read-back (`config.get`) y exponer estado `provisioned|pending|failed` en la UI; NO DEBE asumirse éxito (provisioning fail-soft).
- AC-6.6 El diseño DEBE ser multitenant-ready: escritura serializada a OpenClaw (sin clobber concurrente) y deuda de token único documentada antes de multi-tenant real.
