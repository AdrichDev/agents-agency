# Validation

## User story

As a business owner using an AI agent, I need every booking the agent creates to land in a
real free slot of my schedule and to carry a way of contacting the customer, and I need the
agent to answer the questions my customers actually ask (shipping, returns), so that the
agent is something I can put in front of my customers.

## Acceptance criteria

- **AC1** — A booking whose start/end does not match a free slot generated from the agent's
  schedule is rejected, both from the agent tool and from the public `POST /reserve`.
- **AC2** — A booking for a slot that is inside business hours but already taken is rejected.
- **AC3** — A booking for a real free slot still succeeds (no regression).
- **AC4** — `crear_reserva` fails with an actionable message when neither `email` nor
  `telefono` is supplied, and the failure is returned to the model so it can ask.
- **AC5** — Page discovery ranks policy pages (shipping, returns, FAQ, terms, contact)
  above catalogue pages, regardless of their position in the DOM.
- **AC6** — When the site publishes `sitemap.xml`, its URLs are used for discovery.
- **AC7** — The page cap is 25 and the landing URL is always processed first.

## Scenarios and tests

### T1 — Out-of-hours slot rejected (AC1)

**Given** a service whose agent schedule is Mon-Fri 09:00-18:00
**When** `createAppointment` is called with `slotStart = 2026-08-03T00:00:00Z`
**Then** it throws `SlotUnavailableError` and no `TimeSlot` or `Appointment` row is created

→ `back/tests/booking-slot-validation.test.ts` :: `rechaza un slot fuera del horario`

### T2 — Taken slot rejected (AC2)

**Given** a free slot at 10:00 that already has a `TimeSlot` with `available=false`
**When** `createAppointment` is called for 10:00
**Then** it throws `SlotUnavailableError`

→ `back/tests/booking-slot-validation.test.ts` :: `rechaza un slot ya reservado`

### T3 — Valid slot still books (AC3)

**Given** a service with a free slot at 10:00 inside the schedule
**When** `createAppointment` is called for exactly that slot
**Then** the appointment is created and returned with its service

→ `back/tests/booking-slot-validation.test.ts` :: `crea la cita cuando el slot es válido`

### T4 — Booking without contact rejected (AC4)

**Given** a `crear_reserva` call with `servicio`, `startIso`, `endIso` and no `email` and
no `telefono`
**When** the executor runs the tool
**Then** it throws before reaching the adapter, with a message naming the missing contact

→ `back/tests/booking-slot-validation.test.ts` :: `crear_reserva exige un canal de contacto`

### T5 — Policy pages outrank catalogue pages (AC5)

**Given** a link list where `/collections/all` and `/products/x` appear before
`/politica-de-envios` and `/devoluciones` in DOM order
**When** the candidate list is ranked
**Then** `/politica-de-envios` and `/devoluciones` come before the catalogue URLs

→ `back/tests/scraper-page-ranking.test.ts` :: `prioriza páginas de políticas sobre catálogo`

### T6 — Sitemap used when present (AC6)

**Given** an origin serving a `sitemap.xml` with three `<loc>` entries
**When** discovery runs
**Then** those three URLs are among the candidates

→ `back/tests/scraper-page-ranking.test.ts` :: `usa sitemap.xml cuando existe`

### T7 — Cap and landing page (AC7)

**Given** 60 ranked candidate URLs
**When** the cap is applied
**Then** 25 remain and the landing URL is the first

→ `back/tests/scraper-page-ranking.test.ts` :: `respeta el tope y conserva la URL raíz primera`

## Out of scope for this validation

The end-to-end booking success rate (currently 2/5) is the *product* metric this change
targets, but it is measured against the live provider and is not a unit test. It is
re-measured manually after deploy; the unit tests above guarantee that the two defects
that corrupted both successful bookings can no longer occur.
