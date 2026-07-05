# Propuesta ? Centro de Mando, Agenda y Telegram UI en Agents Agency

**Nivel Gru: 4 ? Cr?tica.** Cruza navegaci?n, agenda, integraciones calendario, detalle de cita y canal Telegram en vivo.
**Estado: SPEC (pendiente implementaci?n).**

## Contexto
Agents Agency ya tiene navegaci?n agrupada, contactos, canales Telegram/WhatsApp y sincronizaci?n de citas con Google Calendar. El usuario pide alinear la experiencia con OperaOS: t?tulo `Centro de Mando`, secci?n `?rea de Trabajo`, agenda a pantalla completa clonada del widget principal de OperaOS y UI de Telegram dentro de la aplicaci?n.

## Intenci?n
1. Cambiar el t?tulo del sidebar a `Centro de Mando` y aplicar tipograf?a/estilo OperaOS a todos los t?tulos de secci?n.
2. Renombrar `Nombre grupal` a `?rea de Trabajo` y a?adir `Agenda` dentro de ese grupo.
3. Crear vista `Agenda` full-screen id?ntica al widget principal de OperaOS.
4. En detalle de cita, enriquecer datos de cliente y a?adir bot?n de ubicaci?n con chincheta que abra Google Maps.
5. Conectar agenda con Google Calendar y dejar preparado Outlook u otro proveedor.
6. Implantar una UI tipo Telegram para leer/escribir en directo desde Agents Agency.

## Decisiones
- La agenda visual se define primero en OperaOS y se replica/adapta en Agents Agency para evitar dos dise?os divergentes.
- El bot?n `?? Ubicaci?n` puede estar activo o desactivado seg?n exista direcci?n v?lida.
- Calendar debe ser tenant-aware: cada cliente/tenant usa su proveedor conectado.
- Telegram UI debe mostrar conversaci?n en vivo y permitir respuesta manual desde la app sin romper el bot.

## Alcance
- Sidebar y navegaci?n de AA.
- P?gina `/agenda` full-screen.
- Modal/detalle de cita con cliente comercial, persona de contacto, tel?fono, direcci?n, anotaciones y ubicaci?n.
- Sincronizaci?n calendario Google/Outlook-ready.
- UI de Telegram vinculada a conversaciones reales.

## Fuera de alcance
- Redise?ar todo Agents Agency fuera del sidebar/agenda.
- Automatizaciones nuevas de calendario no pedidas.
- Sustituir Telegram Bot API; se reutiliza el canal existente.

## Riesgos
- Duplicar l?gica visual entre OperaOS y AA si no se crea primero la referencia.
- Desincronizaci?n calendario si no hay fuente ?nica de CRUD.
- Mensajes Telegram duplicados si UI y bot escriben sin idempotencia.

## Dependencias
- Depende de `crm-operaos-agenda-contactos-fichaje-telegram` para clonar la agenda visual desde OperaOS.
- Reutiliza `agents-agency/back/src/lib/booking/sync.ts` y canales Telegram existentes.

