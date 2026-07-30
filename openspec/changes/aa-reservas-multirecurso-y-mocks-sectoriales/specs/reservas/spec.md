# Delta spec — `reservas` capability

Formal contract change for the agent tools and the booking HTTP surface. Everything not
listed here is unchanged.

## UC-1 — Check availability for a party

**Actor:** end guest, through the agent.
**Tool:** `consultar_disponibilidad`

| Field | Before | After |
|---|---|---|
| `servicio` | string, required | unchanged |
| `desde` / `hasta` | ISO date, required | unchanged |
| `comensales` | — | integer ≥ 1, **required** |

The model must ask for the party size before calling when the guest has not stated it. A
default of 1 would silently book a two-person dinner onto a one-seat unit.

> **Given** a service with resources of 2, 4 and 8 seats and a booking already on the 4
> **When** availability is requested for a party of 4 at that instant
> **Then** the instant is still offered, because the 8 fits a party of 4
>
> **Given** the same state
> **When** a party of 6 asks for that instant
> **Then** the instant is offered only if the 8 is free

**AC:** the returned set is exactly the arrivals for which at least one enabled, eligible
resource has no overlapping non-cancelled booking in `[arrival, arrival + duration + buffer)`.

## UC-2 — Create a booking

**Tool:** `crear_reserva`

| Field | Before | After |
|---|---|---|
| `servicio`, `inicio` | required | unchanged |
| `email` / `telefono` | optional | **at least one required** |
| `comensales` | — | integer ≥ 1, required |
| `nombre` | — | string, optional |

Response gains `codigo` (the confirmation code) and `recurso` (assigned unit name and zone).
The model is instructed to read the code back to the guest; a code the guest never hears
cannot be used to cancel.

Requiring a contact is a tightening. Production already holds two bookings with
`email = NULL` and `phone = NULL` — rows nobody can be reached about and nobody can cancel.

> **Given** a party of 2 and both a free two-top and a free eight-top
> **When** the booking is created
> **Then** the two-top is assigned
>
> **Given** a service whose `maxPartySize` is 8
> **When** a party of 14 is requested
> **Then** the tool returns `GroupTooLargeError` naming the groups channel, and creates
> nothing

## UC-3 — List my bookings

**Tool:** `consultar_mis_reservas` *(new)*

Input: `email?`, `telefono?` — at least one. Output: upcoming non-cancelled bookings of this
agent matching that contact, each with `codigo`, `servicio`, `inicio`, `comensales`, `zona`.

**AC:** the query is always filtered by `service.agentId`. A contact that books at two
tenants sees only the bookings of the agent being asked.

## UC-4 — Cancel a booking

**Tool:** `cancelar_reserva` *(new)*

Input: `codigo` required, plus `email?` / `telefono?` — at least one.

> **Given** booking `LAF-7K2Q` made with `ana@example.com`
> **When** cancellation arrives with that code and that email
> **Then** status becomes `cancelled`, the slot row is deleted and the resource is released
>
> **Given** the same booking
> **When** cancellation arrives with that code and a different contact
> **Then** the result is `BookingNotFoundError`, byte-identical to the unknown-code result
>
> **Given** the same code string existing under another agent
> **When** this agent is asked to cancel it
> **Then** `BookingNotFoundError`

**AC:** three conditions must all hold for a cancellation to proceed — the code exists, the
contact matches that booking, and the booking belongs to this agent. Failure of any one
produces the same message. The distinction is never observable from outside.

## UC-5 — Rebooking a released instant

Not a tool. A behavioural guarantee of the engine.

> **Given** a booking at 21:00 on the only table, then cancelled
> **When** availability is requested for 21:00
> **Then** 21:00 is offered, and booking it succeeds

**AC:** cancellation removes the inventory row rather than flagging it, so the unique index on
`(resourceId, startTime)` no longer blocks the next booking. `Appointment.slotId` becomes
nullable and the cancelled appointment retains its status, timestamps and calendar id.

## UC-6 — Every hour spoken to the customer is on the business's clock

Not a tool. A cross-cutting guarantee over UC-2, UC-3 and UC-4.

> **Given** a business in `Europe/Madrid` and a booking at 21:00 local
> **When** the assistant confirms it, lists it or cancels it
> **Then** each of those tool results carries `2026-08-05T21:00:00.000+02:00`, the same
> instant and the same wall clock the customer was offered in UC-1

**AC:**
- `Appointment.startTime` is `timestamp without time zone` and holds a UTC instant, so
  `toISOString()` produced `...T19:00:00.000Z`. Tool results go into the model's context
  verbatim: the assistant read that as the local hour and confirmed a 21:00 dinner as 19:00,
  an hour at which the restaurant has not opened.
- The zone is `AgentSchedule.timezone` for that agent, falling back to `Europe/Madrid` — the
  same default the column declares. It is never the process's local zone.
- The format is not new: it is exactly what `generateSlots` already emits when offering the
  slot. What UC-6 fixes is that confirmation, listing and cancellation spoke a different
  clock from the availability they came from.
- Out of scope: `sync.ts`, which keeps emitting UTC because Google Calendar takes the
  instant, and `ExternalApiAdapter`, whose hours belong to the customer's own API.

## HTTP surface

| Endpoint | Change |
|---|---|
| `GET /booking/slots` | accepts `partySize`, default 1 |
| `POST /booking/reserve` | accepts `partySize` and `customerName`; returns `confirmationCode` and the assigned resource |
| `PATCH /booking/:id/cancel` | unchanged — staff-side, authenticated, id-based |

Defaulting `partySize` to 1 on the HTTP layer keeps every existing caller working; the tool
layer requires it explicitly because the model, unlike a form, will otherwise guess.

## Backend adapters

`AgentBackendAdapter` gains `consultarMisReservas` and `cancelarReserva`. `managed_db`
implements both. `external_api` throws `ExternalApiNotSupportedError`: the CRM public surface
is `availability`, `bookings` and `leads`, with no lookup-by-contact and no cancellation. No
contract is invented for it.
