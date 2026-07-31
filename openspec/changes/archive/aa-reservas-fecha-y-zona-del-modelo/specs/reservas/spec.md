# Delta spec — reservas: the model's clock

## UC-7 — A date the model emits means what the customer said

**Actor:** the agent's LLM, on behalf of a customer.

**Precondition:** the agent has the `reservas` capability and an `AgentSchedule` with a
`timezone` (default `Europe/Madrid`).

### Requirement R7.1 — Present anchor

The system prompt SHALL state the current date in the agent's timezone, including the
weekday, and SHALL instruct the model to resolve relative dates against it.

The anchor SHALL be emitted at day granularity and placed last in the system prompt, so
that the cacheable prefix rotates at most once per day.

**Given** an agent in `Europe/Madrid`
**When** the system prompt is built at `2026-07-30T22:10:00Z`
**Then** it states `31 de julio de 2026` — the date on the business's clock, not the
server's

### Requirement R7.2 — Naive means local

A date-time string supplied by the model without an offset SHALL be interpreted in the
agent's timezone. A string that carries an offset or `Z` SHALL be interpreted verbatim.

**Given** the model emits `startIso: "2026-08-07T20:30:00"` for an agent in Madrid
**When** the booking tool runs
**Then** the instant used is `18:30Z`, and the exact-match guard of `createAppointment`
finds the slot that `consultar_disponibilidad` offered as `20:30+02:00`

**Given** the model echoes back `2026-08-07T20:30:00.000+02:00`
**When** the booking tool runs
**Then** the instant is still `18:30Z` — an explicit offset is never reinterpreted

### Requirement R7.3 — Availability is floored at the present

`generateSlots` SHALL NOT emit a slot whose start is before the current instant,
regardless of the range requested.

**Given** the current date is 2026-07-30 and a range in August 2023 is requested
**When** availability is computed
**Then** no slots are returned

## Rationale

`consultar_disponibilidad` and `crear_reserva` already agreed on the format they exchange
(zoned ISO, since `02512d3`). What they did not agree on was the *reader*: the executor
parsed whatever the model sent in the server's zone, which on Render is UTC. Against a
Madrid restaurant that is a two-hour shift on input, enough to move a range onto the next
day and to make every `crear_reserva` miss its slot. The agent therefore told every
customer the restaurant was full.
