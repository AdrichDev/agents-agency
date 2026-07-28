# Tasks: aa-agenda-operaos-parity

Orden crítico: P0→P1→P2 (cimientos) antes de P3 (page). P4/P5/P6 dependen de P3.
P7 al final. Backend NO se toca (endpoints ya existen de `aa-agenda-crm-parity`).

- [x] P0 — CSS del calendario OperaOS traducido a tokens AA en
  `front/app/globals.css` (`.agenda-widget`, `.calendar-grid-header`,
  `.calendar-days-mes`, `.calendar-day` + `.active/.today/.empty`,
  `.appointment-dot`, `.agenda-week-grid/-col/-col-head/-col-body`,
  `.agenda-hour-grid/-row/-label/-slot`, `.agenda-dia-panel*`,
  `.cita-full-card(-compact)` + `.time/.client/.meta`). — Fable

- [x] P1 — Portar `AgendaGrid<T>` genérico a
  `front/components/agenda/agenda-grid.tsx`: vistas mes/semana/día, `navegar`,
  `cambiarVista`, `seleccionar`, re-sync de `selected` al navegar (patrón
  `agenda-grid.tsx:155-174`), `DiaPanel`, `renderCard`, "hoy" client-only,
  utilidades de calendario (semana empieza lunes). Test:
  `front/tests/agenda-grid.spec.ts` (selección persistente + nav sin overflow +
  hoy real). — Fable

- [x] P2 — `front/components/agenda/status.ts` (o `shared`): `estadoTone`,
  `tone`, los 4 estados; adaptar/usar `Badge` y `RowActions` con tokens AA.
  Test: incluido en `agenda-grid.spec.ts` (color borde/badge por estado). — Fable

- [x] P3 — Reescribir `front/app/agenda/page.tsx` para consumir `AgendaGrid` +
  `CitaAgendaCard` (tarjeta estilo OperaOS). Conservar carga real vs demo,
  estado de conexión Google Calendar, header "Añadir". Reescribir
  `front/tests/agenda.spec.ts` contra la nueva UI (render/vista/nav/panel/carga).
  — Fable

- [x] P4 — Modal de alta estilo `NuevaCitaModal` (cliente/servicio/fecha/hora/
  email/phone/notas/estado texto libre), validación obligatorios,
  `POST /api/agenda/appointments`, éxito cierra + refresca, fallo conserva +
  error. Test en `agenda.spec.ts`. — Fable

- [x] P5 — Modal de detalle estilo `CitaDetalleModal` (`dl/dt/dd` +
  mapa embed Google + anotaciones + botón Editar) + modo edición
  (`PATCH /:id`) + cambio rápido de estado + Eliminar (`DELETE /:id`,
  confirmación). Eventos Google (`source==="google"`) sin acciones de edición.
  Test en `agenda.spec.ts`. — Fable

- [x] P6 — Ficha de cliente estilo `ClienteInfoModal` alimentada por
  `contactSummary` (nombre comercial/persona/teléfono/email/dirección); nombre
  clicable solo si hay contacto resuelto. Test en `agenda.spec.ts`. — sonnet/opus

- [x] P7 — Verificación final: `tsc --noEmit` front limpio + `npx playwright test`
  front verde (62/62) + smoke manual (crear/editar/estado/eliminar + vistas + ficha).
  Backend sin tocar. — Opus (orquestador)
