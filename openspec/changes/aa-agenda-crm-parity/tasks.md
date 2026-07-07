# Tasks: aa-agenda-crm-parity

Modelo pedido por el usuario: T1-T3 con Opus. T4-T9 paso a paso con Fable.

- [x] T1 — Fecha "hoy" real (quitar `DEMO_TODAY` como cursor inicial / criterio de "hoy"; patrón client-only `new Date()` para evitar mismatch SSR) — Opus
- [x] T2 — Quitar fallback silencioso a `DEMO_APPOINTMENTS` (loading explícito en vez de datos de mentira indistinguibles) — Opus
- [x] T3 — Reducir tamaño de `AppointmentCard` en `SelectedDayPanel` — Opus
- [x] T4 — Vista mes/semana/día: persistir día seleccionado al cambiar de vista (patrón OperaOS `agenda-grid.tsx:150-174`) — Fable
- [x] T5 — Modal Añadir completo: validación de campos obligatorios, manejo de error sin cerrar modal — Fable
- [x] T6 — Backend `PATCH /api/agenda/appointments/:id` (editar campos + estado, sync Google si `gcalEventId`) — Fable
- [x] T7 — Backend `DELETE /api/agenda/appointments/:id` (hard-delete real + borrar evento Google si aplica) — Fable
- [x] T8 — Front: acciones rápidas por cita (cambiar estado sin abrir modal completo) usando T6 — Fable
- [x] T9 — Backend + front: detalle/contacto por cita, mismo patrón que `GET /api/booking/appointments` (`booking.ts:173-200`): añadir `email`/`phone` opcionales a `PlatformAppointment` + al modal de alta; en el detalle, buscar `Tenant` por email/phone y si no hay match caer a `ProspectContact`, devolver `contactSummary` igual que booking.ts — Fable
- [x] T10 — Verificación final: `tsc --noEmit` (front) + suite `vitest` (back) en verde, smoke manual de las 4 acciones (editar/cancelar/estado/detalle)

## Decisiones (cerradas)
- Delete = hard-delete real en `PlatformAppointment` (no soft-delete/`eliminadoEn`).
- Contacto = mismo patrón que OperaOS/booking.ts: cruzar por email/phone contra `Tenant` → fallback `ProspectContact`, mismo `contactSummary` shape. Requiere migración: añadir `email`/`phone` opcionales a `PlatformAppointment`.
