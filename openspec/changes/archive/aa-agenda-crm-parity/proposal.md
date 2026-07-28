# Proposal: aa-agenda-crm-parity

## Intent
Cerrar 3 bugs de `/agenda` y llevar el módulo a paridad funcional real con el
"Agenda" de OperaOS (creador_CRM), en vez del prototipo demo actual a medias.

## Contexto
`/agenda` (agents-agency) es la agenda personal del owner (3A Estudio),
single-tenant, ya con Google Calendar sincronizado (aa-agenda-google-import)
y persistencia propia (`PlatformAppointment`). Pero:
- Arrastra una constante `DEMO_TODAY = "2026-07-05"` hardcodeada usada como
  fecha inicial y como criterio de "hoy" en el grid — desalineada con la
  fecha real.
- El fallback a `DEMO_APPOINTMENTS` (datos de mentira: "Clínica Norte",
  "Innova Legal", ambas fechadas en `DEMO_TODAY`) se muestra cada vez que
  `getToken()`/las llamadas API tardan o fallan momentáneamente — en un
  refresco rápido esto se percibe como "aparecen 2 citas fantasma el día 5".
- El resto del módulo (vista mes/semana/día, panel de citas del día, modal
  Añadir, acciones por cita) está a medio construir comparado con OperaOS.

## Referencia: OperaOS (creador_CRM)
Módulo equivalente ya maduro, mapeado en investigación previa:
- `front/components/panel/widgets/agenda-grid.tsx` — `AgendaGrid<T>` (motor
  de calendario genérico: mes/semana/día, nav, hoy real vía `useEffect` solo
  en cliente para evitar mismatch SSR, `DiaPanel<T>` panel lateral del día).
- `front/app/(crm)/citas/page.tsx` — página completa API-backed: tarjeta de
  cita (`CitaAgendaCard`) con `RowActions` (editar/cancelar), modal de alta
  (`NuevaCitaModal`/`EntityModal`), modal de detalle (`CitaDetalleModal`).
- Backend `back/src/routes/bookings.ts` sobre modelo `Booking`: `GET/POST
  /bookings`, `PATCH /:id` (editar), `POST /:id/cancel|complete|no-show`
  (cambio de estado), `DELETE /:id` (soft-delete vía `eliminadoEn`) — todas
  con sync a Google Calendar y `BookingStatusHistory` para auditoría.
- Patrón a copiar explícitamente: "hoy" se calcula con `new Date()` SOLO tras
  montar en cliente (evita SSR mismatch), nunca una constante fija.

agents-agency no tiene `Booking`/multi-servicio — las citas de `/agenda` son
`PlatformAppointment` (single-tenant, sin `serviceId`/`employeeId`). Se porta
el patrón de UI e interacción de OperaOS, adaptado al modelo de datos ya
existente aquí; no se importa el modelo `Booking` completo.

## Scope (4 puntos)
1. **Fix fecha "hoy"**: sustituir `DEMO_TODAY` por `new Date()` real (patrón
   OperaOS: cliente-only para evitar SSR mismatch) como cursor inicial y como
   criterio de "hoy" en `MonthView`/grid.
2. **Fix citas fantasma**: eliminar el fallback silencioso a
   `DEMO_APPOINTMENTS` como datos que se muestran indistinguibles de datos
   reales. Mientras no hay token/carga, mostrar estado de carga explícito, no
   datos de mentira con fecha fija. `DEMO_APPOINTMENTS` puede seguir
   existiendo solo para Storybook/tests, no como fallback de runtime.
3. **UI**: reducir tamaño de `AppointmentCard` en `SelectedDayPanel`
   (`page.tsx:657`, ajustar los ternarios `compact` de las líneas
   719/722/725/728 o añadir una variante más pequeña para el panel lateral).
4. **Paridad de funcionalidad completa** (patrón OperaOS, adaptado a
   `PlatformAppointment`):
   - Vista mes/semana/día ya existe — completar transiciones/estado real de
     "hoy" y selección de día tras cambiar de vista (patrón `agenda-grid.tsx`
     líneas ~150-174: re-sync de `selected` al navegar).
   - Botón Añadir + modal: ya existe `AddTaskModal` parcial — completar
     campos y validación al nivel de `NuevaCitaModal`/`EntityModal` de
     OperaOS (servicio, notas, estado inicial).
   - Acciones por cita (definidas por el usuario): **editar**, **cancelar/
     eliminar**, **cambiar estado** (Confirmada/Pendiente/Completada/
     Cancelada), **ver detalle/contacto**. Requiere:
     - Backend: `PATCH /api/agenda/appointments/:id` (editar campos +
       cambiar estado, patrón `PATCH /bookings/:id` de OperaOS) y
       `DELETE /api/agenda/appointments/:id` (soft o hard delete; si tiene
       `gcalEventId`, cancelar/borrar también el evento de Google).
     - Prisma: `PlatformAppointment` ya tiene `status`; puede necesitar
       campo de soft-delete (`eliminadoEn`) si se decide soft-delete en vez
       de hard-delete — a decidir en design.md.
     - Front: `RowActions`-equivalente en `AppointmentCard`, modal de
       detalle/edición reutilizando el modal de Añadir en modo edición.

## Decisiones cerradas
- Cancelar/eliminar = hard-delete real (no soft-delete).
- Contacto = mismo patrón que `GET /api/booking/appointments`
  (`booking.ts:173-200`): añadir `email`/`phone` opcionales a
  `PlatformAppointment`, cruzar contra `Tenant` → fallback `ProspectContact`,
  mismo shape de `contactSummary`.

## Riesgos
- Cambiar `DEMO_TODAY` a `new Date()` real puede requerir un patrón
  client-only (como OperaOS) para evitar mismatch de hidratación Next.js.

## Model routing (pedido explícito por el usuario)
- Puntos 1-3 (bugs + ajuste UI): implementar con Opus.
- Punto 4 (paridad funcional completa): implementar paso a paso con Fable.
