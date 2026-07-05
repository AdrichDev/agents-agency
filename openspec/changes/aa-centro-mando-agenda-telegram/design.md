# Dise?o ? Centro de Mando, Agenda y Telegram UI en Agents Agency

## Enfoque t?cnico
Agents Agency debe consumir la agenda visual ya estabilizada en OperaOS. La primera capa es navegaci?n (`NAV_GROUPS` + `Sidebar`); la segunda es una p?gina `/agenda` full-screen; la tercera conecta cita, calendario externo y Telegram UI usando los puertos existentes de booking/canales.

## Decisiones de arquitectura

| Decisi?n | Elecci?n | Alternativa descartada | Motivo |
|---------|----------|------------------------|--------|
| Fuente visual de agenda | Clonar/adaptar `AgendaWidget` de OperaOS | Dise?ar una agenda nueva en AA | Evita dos experiencias distintas y cumple ?exactamente igual?. |
| Calendario externo | Puerto com?n con Google inicial | Acoplar cada pantalla a Google API | Permite Outlook u otro proveedor despu?s sin reescribir UI. |
| Ubicaci?n | Link Google Maps desde direcci?n normalizada | Mapa embebido propio | El usuario pidi? Google Maps y reduce coste de integraci?n. |
| Telegram UI | Persistencia + stream/polling sobre conversaciones reales | Solo iframe/enlace a Telegram | Permite escribir desde la aplicaci?n y auditar mensajes. |

## Flujo de datos

```text
Sidebar ? /agenda ? API citas tenant ? detalle cita
                         ?              ?? Google Maps URL
                         ?              ?? CalendarProvider sync
Telegram webhook ? mensajes persistidos ? UI Telegram ? sendMessage Bot API
```

## Cambios de archivos

| Archivo | Acci?n | Descripci?n |
|--------|--------|-------------|
| `front/lib/navigation.ts` | Modificar | T?tulo/grupos: `Centro de Mando`, `?rea de Trabajo`, item `Agenda`. |
| `front/components/Sidebar.tsx` | Modificar | Estilo de t?tulos igual a OperaOS. |
| `front/app/agenda/page.tsx` | Crear | Agenda full-screen basada en widget OperaOS. |
| `front/components/agenda/*` | Crear | Componentes reutilizables de vista, tarjetas y detalle. |
| `back/src/lib/booking/sync.ts` | Modificar | Asegurar CRUD calendario, no solo alta/baja parcial. |
| `back/src/lib/integrations/calendar*` | Modificar/crear | Puerto Google/Outlook-ready. |
| `back/src/lib/channels/telegram-*` | Modificar | Persistencia y env?o manual idempotente. |
| `front/app/telegram/page.tsx` o componente equivalente | Crear | UI de conversaci?n Telegram en directo. |

## Contratos

```ts
type CalendarProvider = {
  createEvent(input: CalendarEventInput): Promise<{ externalId: string }>;
  updateEvent(externalId: string, input: CalendarEventInput): Promise<void>;
  deleteEvent(externalId: string): Promise<void>;
};

type AppointmentContactSummary = {
  commercialName: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
};
```

## Estrategia de pruebas

| Capa | Qu? probar | Enfoque |
|------|------------|---------|
| Unit | Google Maps URL, mapper cliente/cita, idempotencia Telegram | Vitest/node tests. |
| Integraci?n | CRUD cita ? CalendarProvider mock | API tests sin red real. |
| UI | Sidebar, `/agenda`, detalle cita y Telegram UI | Render tests + snapshots. |
| E2E | Crear cita, ver detalle, abrir ubicaci?n, responder Telegram | Playwright si est? disponible. |

## Migraci?n / rollout
No se requiere migraci?n obligatoria para sidebar/agenda. Telegram UI puede requerir tabla/?ndice si no existe persistencia completa de mensajes; debe ser aditiva.

## Preguntas abiertas
- [ ] Confirmar si la UI Telegram vive como nav propio o dentro del detalle de cada agente/conversaci?n.

