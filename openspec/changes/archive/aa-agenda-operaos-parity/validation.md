# Validation: aa-agenda-operaos-parity

## Historia de usuario
Como owner de 3A Estudio, quiero que `/agenda` se vea y se comporte igual que
la Agenda/Citas de OperaOS: mismo calendario con selector de periodo y botones
Mes/Semana/Día, mismas tarjetas de cita, mismo modal de alta, edición, detalle
y ficha de cliente — para gestionar mis citas con la misma experiencia madura.

## Regla
Ninguna tarea se marca `[x]` en `tasks.md` sin su test en verde. Front = solo
Playwright (`front/tests/*.spec.ts`). Backend sin cambios (ya verificado en
`aa-agenda-crm-parity`).

## Criterios de aceptación + Given-When-Then + test por tarea

### P0 — CSS del calendario en tokens AA
- AC: existen en `globals.css` las clases del calendario OperaOS traducidas a
  tokens AA (`.agenda-widget`, `.calendar-days-mes`, `.calendar-day(.active/.today/.empty)`,
  `.appointment-dot`, `.agenda-week-*`, `.agenda-hour-*`, `.agenda-dia-panel*`,
  `.cita-full-card(-compact)`), usando `--accent-1`/`--panel`/bordes `white/10`.
- Given la página cargada, When se inspecciona una `.calendar-day.today`, Then
  tiene el `box-shadow inset` de acento; una `.active` tiene fondo/borde acento.
- Test: cubierto indirectamente por P1/P3 (asserts de clases/estado en el grid).

### P1 — AgendaGrid genérico (motor)
- AC: `components/agenda/agenda-grid.tsx` exporta `AgendaGrid<T>` con vistas
  mes/semana/día, navegación prev/next, label de periodo, re-sync de `selected`
  al navegar/cambiar vista, `DiaPanel` con `sidePanel`, `renderCard(item,{compact})`,
  "hoy" resuelto en `useEffect` client-only.
- Given vista mes con día 15 seleccionado, When cambio a semana, Then el 15
  sigue seleccionado (no vuelve a hoy); When navego +1 mes desde el 31, Then no
  hay overflow al mes equivocado (mismo día o clamp).
- Test: `front/tests/agenda-grid.spec.ts` — selección persistente entre vistas +
  navegación sin overflow + "hoy" = fecha real del sistema (mock de reloj).

### P2 — Estados y tarjeta de cita
- AC: `estadoTone(estado)` fija el color del borde-izq (azul Completada, rojo
  Cancelada, acento resto) y `tone(estado)` el tono del badge (green/amber/blue/
  red). `CitaAgendaCard` muestra: hora (acento), cliente (clicable si hay
  contacto → ficha), meta (servicio · owner), `Badge` de estado, `RowActions`
  (Editar/Eliminar) — variante `compact` en semana/día sin meta/acciones.
- Given una cita Cancelada, When se renderiza la tarjeta, Then el borde-izq es
  rojo y el badge tono red con texto "Cancelada".
- Test: `front/tests/agenda-grid.spec.ts` — asserts de color de borde/badge por
  estado y presencia de RowActions.

### P3 — Página /agenda reescrita
- AC: `app/agenda/page.tsx` usa `AgendaGrid<CitaAA>` con `sidePanel`, carga
  desde `GET /api/agenda/appointments` (+ `/api/booking/appointments`), estado
  de carga explícito, sin citas fantasma, header con "Añadir" y estado de
  conexión Google Calendar conservado.
- Given sesión válida y API OK, When abre `/agenda`, Then ve el calendario con
  sus citas reales y el panel del día; sin sesión, modo demo explícito.
- Test: `front/tests/agenda.spec.ts` (reescrito) — render, cambio de vista,
  nav de periodo, panel del día, carga vs demo.

### P4 — Modal de alta
- AC: modal estilo `NuevaCitaModal` con campos cliente/servicio/fecha/hora/
  email/phone/notas/estado (texto libre); valida obligatorios (cliente, fecha,
  hora); `POST /api/agenda/appointments`; cierra y refresca en éxito; conserva
  datos y muestra error sin cerrar en fallo.
- Given cliente vacío, When intento crear, Then bloqueo con mensaje y no llamo
  a la API; Given POST 500, When guardo, Then modal sigue abierto con error y
  datos intactos.
- Test: `front/tests/agenda.spec.ts` — validación + éxito cierra + fallo no cierra.

### P5 — Modal de detalle + edición
- AC: detalle estilo `CitaDetalleModal` (`dl/dt/dd`: Cliente/Persona de
  contacto/Servicio/Fecha/Hora/Estado/Dirección + mapa embed si hay dirección +
  anotaciones + botón Editar). Editar entra a modo edición (mismos campos que
  alta) y guarda vía `PATCH /:id`; cambio rápido de estado y Eliminar
  (`DELETE /:id`, con confirmación).
- Given cita con `contactSummary.address`, When abro detalle, Then veo el iframe
  de Google Maps y el enlace "Abrir en Google Maps"; When cambio estado, Then
  persiste vía PATCH y el badge se actualiza.
- Test: `front/tests/agenda.spec.ts` — detalle muestra contactSummary, editar
  PATCH ok, fallo PATCH conserva datos, delete quita la cita, cambio de estado.

### P6 — Ficha de cliente
- AC: click en el nombre del cliente en la tarjeta/detalle abre una ficha
  (estilo `ClienteInfoModal`) con los datos del `contactSummary` (nombre
  comercial, persona de contacto, teléfono, email, dirección); si no hay
  contacto resuelto, no se ofrece la ficha (o muestra "sin datos" sin romper).
- Given cita cuyo email matchea un Tenant, When abro la ficha, Then veo el
  nombre comercial y datos del Tenant; Given cita sin contacto, When no hay
  match, Then el nombre no es clicable o la ficha dice "sin datos".
- Test: `front/tests/agenda.spec.ts` — ficha con contactSummary y caso sin datos.

### P7 — Verificación final
- AC: `tsc --noEmit` (front) limpio; `npx playwright test` (front) verde;
  backend sin tocar (suite ya verde en el change previo); smoke manual de las 4
  acciones (crear/editar/estado/eliminar) + navegación de vistas + ficha.
- Test: ejecución de las suites completas.
