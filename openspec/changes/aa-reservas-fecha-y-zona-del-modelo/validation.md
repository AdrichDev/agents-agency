# Validation

## User story

As a customer talking to a restaurant's agent, when I say "a table for Saturday the 8th
at nine", I want the booking that gets created to be Saturday the 8th at nine of this
year, in the restaurant's own local time — not a date three years ago, and not two hours
off — so that I actually get the table I agreed to.

## Acceptance criteria

- **AC1** — A naive ISO string is read in the business's timezone; one that already
  carries an offset or `Z` keeps its instant unchanged.
- **AC2** — `consultar_disponibilidad` called with naive `desde`/`hasta` returns the slots
  of the day the customer asked for, not of the following day.
- **AC3** — `crear_reserva` called with a naive `startIso` matching a slot the tool just
  offered creates the booking instead of failing with `SlotUnavailableError`.
- **AC4** — The system prompt states today's date and the business's timezone, at day
  granularity, and is unchanged when no date is supplied.
- **AC5** — Availability never offers a slot that is already in the past, whatever range
  was requested.

## Scenarios and tests

### T1 — Naive ISO reads in the business's zone (AC1)

**Given** the timezone `Europe/Madrid` and the string `2026-08-08T21:00:00`
**When** `parseIsoInZone` parses it
**Then** the resulting instant is `2026-08-08T19:00:00.000Z`, not `21:00Z`

→ `back/tests/booking-timezone.test.ts` :: `un ISO naive se lee en la zona del negocio`

### T2 — An explicit offset is not reinterpreted (AC1)

**Given** the string `2026-08-08T21:00:00+02:00` and the timezone `Atlantic/Canary`
**When** `parseIsoInZone` parses it
**Then** the instant is still `2026-08-08T19:00:00.000Z`

→ `back/tests/booking-timezone.test.ts` :: `un ISO con offset se respeta tal cual`

### T3 — Availability answers for the day asked (AC2)

**Given** an agent in `Europe/Madrid` and a dinner service open 20:00-22:45
**When** `consultar_disponibilidad` is called with `desde: "2026-08-07T20:00:00"` and
`hasta: "2026-08-07T22:45:00"` (naive, as the model emits them)
**Then** the adapter receives the range 18:00Z-20:45Z of the 7th — the evening the
customer asked about — and not a range that spills into the 8th

→ `back/tests/agent-backend-tools.test.ts` :: `consultar_disponibilidad lee un ISO naive en la zona del negocio (AC2)`

### T4 — A naive startIso still books (AC3)

**Given** the model emits `startIso: "2026-08-07T20:30:00"` for a slot offered as
`2026-08-07T20:30:00.000+02:00`
**When** `crear_reserva` runs
**Then** the adapter receives `2026-08-07T20:30:00.000+02:00`, so the exact-match guard in
`createAppointment` finds the slot

→ `back/tests/agent-backend-tools.test.ts` :: `crear_reserva normaliza un startIso naive a la zona del negocio (AC3)`

### T5 — The prompt carries the date (AC4)

**Given** `fechaActual = { instante: 2026-07-30T22:10:00Z, timezone: "Europe/Madrid" }`
**When** `buildSystemPrompt` runs
**Then** the prompt contains `31 de julio de 2026` — the date in Madrid, where it is
already past midnight — and names the timezone

→ `back/tests/agent-backend-tools.test.ts` :: `el prompt ancla la fecha de hoy en la zona del negocio (AC4)`

### T6 — No anchor, no change (AC4)

**Given** no `fechaActual`
**When** `buildSystemPrompt` runs
**Then** the prompt contains no date line

→ `back/tests/agent-backend-tools.test.ts` :: `sin fechaActual el prompt no cambia (AC4)`

### T7 — Past slots are never offered (AC5)

**Given** `now = 2026-07-30` and a requested range in August **2023**
**When** `generateSlots` runs
**Then** it returns no slots

→ `back/tests/booking-slots.test.ts` :: `no ofrece huecos de un año pasado (AC5)`

## V1 — End-to-end against production

Not a unit test: a real anonymous conversation through `POST /api/chat` against the
Lafayette agent on `https://aa-back-jmyo.onrender.com`, after deploy. Passes when a
booking is created and the row persisted in `aa.cita` is the same instant the bot spoke
to the customer. Result recorded here.

**Pre-fix baseline (2026-07-30, before this change):** 0 bookings in 4 attempts, every
one rejected as `SlotUnavailableError`, every date emitted in 2023.

**Post-fix:** _pending_
