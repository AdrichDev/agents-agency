# Validation: aa-agenda-crm-parity

## Historia de usuario
Como owner de 3A Estudio, quiero que `/agenda` muestre siempre la fecha real
de hoy, no cite citas fantasma al refrescar, tenga tarjetas de tamaño
razonable en el panel del día, y me deje crear/editar/cancelar/cambiar
estado de mis citas igual de bien que el módulo de Agenda de OperaOS.

## Criterios de aceptación (AC) + Given-When-Then + test por tarea

### T1 — Fecha "hoy" real
- AC: al abrir `/agenda` sin querystring, el cursor inicial es la fecha real
  del sistema, no `2026-07-05`. El día resaltado como "hoy" en `MonthView`
  coincide con `new Date()`.
- Given hoy es 2026-07-07, When se abre `/agenda`, Then el mes visible es
  julio 2026 con el día 7 resaltado como hoy (no el 5).
- Test: `front/tests/agenda-today.spec.ts` (Playwright, patrón de `agenda.spec.ts`) —
  navega a `/agenda`, assert `agenda-period-label` con el mes/año reales del
  sistema (no julio 2026 fijo si la fecha real cambia) y el día resaltado.

### T2 — Sin citas fantasma
- AC: mientras no hay token o la API tarda, la UI muestra un estado de carga
  explícito ("Cargando agenda…" o skeleton), nunca `DEMO_APPOINTMENTS`
  indistinguible de datos reales.
- Given token aún no resuelto, When se monta `AgendaPage`, Then no se
  renderiza ninguna tarjeta con `client === "Clínica Norte"` ni
  `"Innova Legal"` salvo que el usuario esté explícitamente en modo demo
  (sin sesión / storybook).
- Test: extender `front/tests/agenda.spec.ts` (Playwright) — con fetch de
  `/api/booking/appointments`/`/api/agenda/appointments` retrasado (`route`
  con delay), assert estado de carga visible y ausencia de "Clínica Norte"/
  "Innova Legal" mientras carga, salvo el caso ya cubierto sin sesión.

### T3 — Tarjeta más pequeña en panel del día
- AC: `AppointmentCard` dentro de `SelectedDayPanel` usa paddings/tipografía
  reducidos respecto al actual (p.ej. `p-2`/`text-xs` en vez de `p-4`/
  `text-lg`).
- Given el panel de citas del día con ≥1 cita, When se renderiza, Then el
  alto de cada tarjeta es visualmente menor que el actual (verificar por
  snapshot de clases, no pixel-perfect).
- Test: extender `front/tests/agenda.spec.ts` (Playwright) — assert clase/
  tamaño reducido en `agenda-event-card` dentro de `agenda-day-list`.

### T4 — Vista mes/semana/día + selección de día persistente
- AC: cambiar de vista (mes→semana→día) conserva el día seleccionado cuando
  es posible (patrón OperaOS `agenda-grid.tsx:150-174`).
- Given día 15 seleccionado en vista mes, When cambio a vista semana, Then
  el día 15 sigue siendo el seleccionado (no vuelve a "hoy").
- Test: `front/tests/agenda-view-switch.test.tsx`.

### T5 — Modal Añadir completo
- AC: modal de alta con validación de campos obligatorios (cliente, fecha,
  hora), guarda vía `POST /api/agenda/appointments`, cierra y refresca lista
  al éxito, mantiene datos y muestra error al fallo (no cierra en error).
- Given formulario con cliente vacío, When se intenta guardar, Then se
  bloquea con mensaje de validación, no se llama a la API.
- Test: `back/tests/agenda-appointments.test.ts` (ya existe parcialmente,
  ampliar) + `front/tests/add-task-modal.test.tsx`.

### T6 — Acciones por cita: editar
- AC: `PATCH /api/agenda/appointments/:id` actualiza campos editables
  (cliente, servicio, fecha/hora, notas, estado); si tiene `gcalEventId`,
  también actualiza el evento en Google (`updateEvent`, ya existe en
  `calendar.ts`).
- Given cita con `gcalEventId`, When se edita la hora, Then el evento de
  Google refleja la nueva hora (mock en test) y la fila en BD se actualiza.
- Test: `back/tests/agenda-appointments-patch.test.ts`.

### T7 — Acciones por cita: cancelar/eliminar
- AC: `DELETE /api/agenda/appointments/:id` borra la fila (o marca
  cancelada, según design.md) y si tiene `gcalEventId` borra el evento de
  Google (`deleteEvent`, ya existe en `calendar.ts`).
- Given cita sincronizada con Google, When se cancela, Then desaparece de
  la lista y del Google Calendar (mock en test).
- Test: `back/tests/agenda-appointments-delete.test.ts`.

### T8 — Acciones por cita: cambiar estado
- AC: cambio de estado (Confirmada/Pendiente/Completada/Cancelada) posible
  desde la tarjeta sin abrir el modal completo (patrón `RowActions`/select
  rápido), persiste vía el mismo `PATCH`.
- Test: incluido en T6 (mismo endpoint, distinto payload).

### T9 — Ver detalle/contacto
- AC: click en la tarjeta abre un panel/modal con notas, teléfono, email si
  existen; sin ellos, muestra solo lo disponible (no rompe).
- Test: `front/tests/appointment-detail-modal.test.tsx`.

## Regla
Ninguna tarea se marca `[x]` en `tasks.md` sin su test en verde.
