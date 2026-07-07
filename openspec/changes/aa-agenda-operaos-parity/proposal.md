# Proposal: aa-agenda-operaos-parity

## Intent
Replicar en `/agenda` de agents-agency el **UI/UX y la lógica de negocio
completos** del módulo Agenda/Citas de OperaOS (creador_CRM): el motor de
calendario `AgendaGrid` (selector de mes/año, botones Mes/Semana/Día, grid
visual, panel de citas del día), la tarjeta de cita `CitaAgendaCard`, el modal
de alta, el modal de edición, el modal de detalle y la ficha de cliente. No es
un parche sobre el prototipo actual: es portar la experiencia real de OperaOS,
adaptada al modelo de datos plano de AA.

## Contexto y por qué (corrección de alcance)
El change previo `aa-agenda-crm-parity` (ya cerrado) añadió CRUD backend
(PATCH/DELETE/contactSummary) y arregló bugs, pero mantuvo la **UI-prototipo**
propia de AA (`MonthView`/`WeekView`/`DayView` inline, `AppointmentCard`,
`AddTaskModal`, `DetailModal` caseros). El usuario pidió explícitamente
replicar el look, la interacción y la lógica de OperaOS — eso no se hizo. Este
change lo corrige.

## Referencia: OperaOS (creador_CRM) — mapeado exhaustivamente
- `front/components/panel/widgets/agenda-grid.tsx` — motor `AgendaGrid<T>`
  genérico (mes/semana/día, nav, re-sync de `selected` al navegar, `DiaPanel`
  panel del día, `onRangeChange`, `renderCard` como punto de extensión, "hoy"
  client-only anti-SSR-mismatch).
- `front/app/(crm)/citas/page.tsx` — página completa + `CitaAgendaCard`
  (borde-izq color por estado, hora acc, cliente clicable → ficha, meta,
  `Badge` de estado, `RowActions` editar/eliminar).
- `front/components/crm/nueva-cita-modal.tsx` — modal de alta.
- `front/components/crm/cita-detalle-modal.tsx` — detalle (`dl/dt/dd`, mapa
  embed Google, anotaciones, botón Editar).
- `front/components/agenda/shared.tsx` — `estadoTone` (borde), `tone` (badge),
  4 estados canónicos.
- `front/components/crm/cliente-info-modal.tsx` — ficha de cliente.

## Decisiones cerradas (confirmadas por el usuario)
1. **Fidelidad de datos = adaptar al modelo plano.** AA (`PlatformAppointment`)
   no tiene `Booking`/servicios-catálogo/empleados/slots/entidad Cliente. Se
   replica UI/UX/interacción 1:1, pero `service`/profesional = **texto libre**
   y hora = **input normal** (sin catálogo ni `GET /slots`). Cero modelos
   nuevos. La "ficha de cliente" = el `contactSummary` (Tenant → ProspectContact
   por email/phone) que ya devuelve el backend.
2. **Estilos = traducir a tokens de AA.** Mismo layout/estructura visual de
   OperaOS pero con los tokens ya existentes en AA (`--accent-1` ≙ `--acc`,
   `--panel`, `--edge`, bordes `white/10`, `slate-*` para muted) para integrar
   con el resto de la app. Nota: el chasis `.opera-modal`/`.btn-primary` ya
   está portado en `globals.css`.

## Scope
- **Front (grueso del trabajo):**
  - Portar `AgendaGrid<T>` genérico a `front/components/agenda/agenda-grid.tsx`
    (mes/semana/día, nav, re-sync `selected`, `DiaPanel`, `renderCard`).
  - Portar CSS del calendario a `globals.css` con tokens AA (clases
    `.agenda-widget`, `.calendar-*`, `.agenda-week-*`, `.agenda-hour-*`,
    `.agenda-dia-panel`, `.cita-full-card`).
  - `shared` de estados: `estadoTone`/`tone` + los 4 estados
    (Pendiente/Confirmada/Completada/Cancelada) con sus colores.
  - Reescribir `front/app/agenda/page.tsx` para consumir `AgendaGrid` +
    `CitaAgendaCard`.
  - Modal alta adaptado (cliente/servicio/fecha/hora/email/phone/notas/estado,
    texto libre) → `POST /api/agenda/appointments`.
  - Modal detalle adaptado (`dl/dt/dd`, mapa embed, anotaciones, botón Editar) +
    ficha cliente desde `contactSummary`.
  - Modal edición → `PATCH /api/agenda/appointments/:id`; eliminar →
    `DELETE /api/agenda/appointments/:id` (hard-delete, ya existe).
- **Backend:** SIN cambios de contrato. Se reusan los endpoints ya creados en
  `aa-agenda-crm-parity` (GET/POST/PATCH/DELETE + `email`/`phone`/`contactSummary`).

## Estados de cita (copiados exactos de OperaOS)
| Etiqueta | Badge tone | Borde tarjeta |
|---|---|---|
| Pendiente | amber | `--accent-1` |
| Confirmada | green | `--accent-1` |
| Completada | blue | azul (#6aa8ff) |
| Cancelada | red | rojo (#ff4757) |

## Riesgos
- El grid de OperaOS asume semana empieza lunes y "hoy" client-only — replicar
  ambos o rompe hidratación/resaltado.
- El `to` del rango es inclusivo en front pero el back filtra `lte`; AA usa un
  solo `GET /api/agenda/appointments` sin rango (trae todo), así que
  `onRangeChange` es opcional aquí (no hay paginación server-side). Se conserva
  el hook para futura escalada pero no se cablea a la API.
- Reescribir `page.tsx` completo: los tests Playwright existentes
  (`agenda.spec.ts`, 22) asumen la UI vieja (testids `agenda-event-card`,
  `agenda-add-task-*`, `agenda-detail-*`). Habrá que reescribirlos contra la
  nueva UI, no solo extenderlos.

## Model routing
- Orquestación + spec: Opus (sesión actual).
- Port de `AgendaGrid` + CSS + modales (denso, visual, criterio de diseño):
  builders **Fable**, paso a paso.
- Cableado mecánico / tests: sonnet/opus.
