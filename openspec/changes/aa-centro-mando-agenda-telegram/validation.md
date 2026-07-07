# Validación — aa-centro-mando-agenda-telegram

Historia: como usuario de Agents Agency quiero un `Centro de Mando` con agenda completa, Telegram integrado y creación de agentes respaldada por OpenClaw, para gestionar citas, ubicación, conversaciones y agentes sin salir de la aplicación.

## Criterios de aceptación (AC)
- **AC1:** el título del sidebar muestra `Centro de Mando` y los títulos de sección usan la misma tipografía/estilo que OperaOS.
- **AC2:** `Nombre grupal` pasa a `Área de Trabajo` e incluye `Dashboard` y `Agenda`. `Mi Cuenta` y `Configuración` permanecen en la rosca de ajustes junto a la cuenta logeada. Telegram NO es entrada de navegación: se accede vía widget flotante global (patrón creador_CRM).
- **AC3:** `/agenda` replica exactamente la vista del widget principal de OperaOS, pero a pantalla completa, con citas reales del tenant.
- **AC4:** el detalle de cita muestra cliente comercial, persona de contacto, teléfono, dirección y después los datos actuales.
- **AC5:** debajo de anotaciones existe botón `📍 Ubicación`, desactivado si no hay dirección y activo si puede abrir Google Maps.
- **AC6:** el CRUD completo de agenda (crear, EDITAR, cancelar) sincroniza con Google Calendar del tenant o proveedor conectado, incluida la cuenta Google personal del usuario vía OAuth.
- **AC7:** el widget flotante de Telegram (única UI, sin página dedicada — Telegram es un bot) muestra mensajes en directo y permite escribir desde AA sin duplicar envíos.
- **AC8:** la conversación Telegram es la MISMA en creador_CRM y AA: un mensaje entrante aparece en ambas apps; una respuesta desde cualquiera llega UNA sola vez al cliente (hub único de salida).
- **AC9:** AA notifica mensajes nuevos (badge no-leídos + toast).
- **AC10:** el wizard de creación de agente ofrece desplegable de nombres comerciales de clientes existentes con sector autocompletado, y el agente queda creado REALMENTE en OpenClaw con verificación read-back; AA solo lo muestra.

## Por tarea (Dado-Cuando-Entonces + test)
- **WU1 navegación** — **DADO** el sidebar abierto, **CUANDO** se renderiza, **ENTONCES** muestra `Centro de Mando`, `Área de Trabajo` (con Agenda y Telegram) con estilo OperaOS. Test: `front/tests/navigation.spec.ts` (existe, hoy ROJO — debe quedar verde).
- **WU2 agenda full-screen** — **DADO** la agenda OperaOS, **CUANDO** se abre `/agenda`, **ENTONCES** AA muestra la misma estructura visual con citas reales. Test: `front/tests/agenda.spec.ts`. ✅
- **WU3 detalle cita** — **DADO** una cita con cliente y dirección, **CUANDO** se abre el detalle, **ENTONCES** muestra los datos enriquecidos y el botón de Google Maps activo (desactivado sin dirección). Test: `front/tests/agenda.spec.ts:73-119`. ✅
- **WU4 calendario** — **DADO** un tenant con Google Calendar conectado, **CUANDO** se crea/EDITA/cancela una cita, **ENTONCES** el evento remoto queda sincronizado (update hoy sin cablear) y visible en la cuenta Google personal (OAuth). Test: `back/tests/calendar-sync.test.ts` + nuevo test de ruta reschedule + smoke OAuth real.
- **WU5 Telegram UI** — **DADO** mensajes entrantes de Telegram, **CUANDO** llegan vía hub, **ENTONCES** aparecen en la UI en directo y permiten respuesta manual idempotente. Test: `back/tests/telegram-ui.test.ts`, `front/tests/telegram.spec.ts`. ✅ (UI local)
- **WU5.4 puente CRM↔AA** — **DADO** un mensaje generado en creador_CRM (o en AA), **CUANDO** el hub hace fan-out, **ENTONCES** ambas apps muestran la conversación completa en ≤5s y el cliente recibe cada respuesta UNA vez. Test: contract cross-app con hub mock + smoke real.
- **WU6 wizard OpenClaw** — **DADO** el wizard de nuevo agente, **CUANDO** el usuario selecciona un nombre comercial del desplegable, **ENTONCES** el sector se autocompleta, el agente se crea con `runtime=openclaw` y `tenantId` existente (sin Tenant duplicado), OpenClaw lo confirma vía read-back y la UI muestra `provisioned`. Test: front (desplegable), API (tenantId existente), integración (provision + read-back con RPC mock).

> Regla del repo: una tarea está DONE solo cuando su test está verde. Sin spec, no hay implementación válida.
