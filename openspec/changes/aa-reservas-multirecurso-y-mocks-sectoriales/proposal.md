# Multi-resource bookings and sector mock tenants

## Intent

Make the booking engine model what appointment-driven businesses actually sell — a finite
pool of typed inventory (tables, chairs, cabins) reserved for an interval by a party of a
given size — and prove it with four production-grade mock tenants, one per delivery mode.

Today the engine can represent exactly one bookable unit per service, has no notion of how
many people are coming, and gives the bot no way to cancel anything. A restaurant cannot be
sold on it. Neither can a barbershop with three barbers or a beauty centre with four cabins.

## Why now

The previous change (`aa-reservas-validadas-y-cobertura-scraping`) made booking work
end-to-end for the trivial case: one agent, one implicit unit, one person. Measuring it
exposed that the trivial case is the only case the schema can express:

- `TimeSlot @@unique([serviceId, startTime])` — **one reservation per service per instant**.
  A restaurant with twelve tables can accept one booking at 21:00.
- `Appointment` has no party size. "Mesa para 4" is not expressible, so no table can be
  matched to a party.
- The `reservas` capability exposes three tools — `listar_servicios`,
  `consultar_disponibilidad`, `crear_reserva`. **There is no cancel tool and no way to look
  up an existing booking**, so a guest who wants to cancel has to phone the restaurant. The
  HTTP route `PATCH /booking/:id/cancel` exists but the bot cannot reach it and would not
  know the id.
- `cancelAppointment` sets `available = true` but leaves the `TimeSlot` row, while
  `createAppointment` uses `timeSlot.create`. A cancelled slot is offered again and then
  collides with the unique index. **A cancelled slot can never be rebooked.**

## Scope

### In

1. **Resource inventory.** New `Resource` (table / barber / cabin) with capacity range and
   zone, linked to the services it can serve. Availability becomes "is at least one eligible
   resource free for the whole interval", not "is this instant taken".
2. **Party size and best-fit assignment.** `Appointment.partySize`; the booking transaction
   picks the smallest free resource that fits, the way a host seats a room.
3. **Per-service schedules (turnos).** A service may override the agent schedule, so lunch,
   dinner and Sunday brunch are three services with three windows instead of one blurred day.
4. **Arrival granularity and turnaround buffer** per service, replacing the hardcoded 30-min
   grid and giving the kitchen/cleaning gap between sittings.
5. **Bot-side cancellation and lookup.** `consultar_mis_reservas` and `cancelar_reserva`,
   identified by a short confirmation code plus a matching email or phone — never by code
   alone, never across agents.
6. **Rebooking a cancelled slot.** Fix the create-vs-unique collision.
7. **Four mock tenants**, each a complete, sellable configuration:
   - `Lafayette` — restaurant, two sittings, tables by zone, knowledge fed from
     `brasserielafayette.es` (carta, allergens, hours, groups).
   - `Barbería` — staff-as-resource, per-service duration, choice of professional.
   - `Centro de estética` — cabins with treatment-specific eligibility.
   - A fourth tenant **with no website**, fed exclusively from attached documents (FAQ,
     carta with allergens, policies) to prove the file ingestion path.
8. **A casuistry matrix** exercised against the real agents: availability, party too large,
   outside the sitting, closed day, full house, cancel, cancel with the wrong code, cancel
   someone else's booking, allergens, dish price, gluten-free, asking for the menu, hours.

### Out

- Table combining for large parties (two 4-tops into an 8). Parties above `maxPartySize` are
  routed to the groups-and-events flow, which is what the reference restaurant does.
- Pacing / covers-per-quarter-hour limits.
- Card guarantee, deposits, no-show charging.
- Two-way Google Calendar sync and the broken calendar token read
  (`booking/sync.ts` reads `integration.metadata.accessToken`, which is never written).
  Tracked separately; it does not block this change because no tenant has ever linked a
  calendar (0 integrations in production).
- Waiting lists.

## Risks

| Risk | Mitigation |
|---|---|
| Migration touches the live booking tables on the shared production Supabase | Additive only; the destructive step is a single index swap. Every existing agent gets one implicit resource so current behaviour is byte-identical. Requires explicit human approval before applying. |
| Availability goes from an index lookup to an overlap query | Overlap is bounded by the requested range and indexed on `(resourceId, startTime)`. Measured before/after on the mock tenants. |
| Bot cancellation is an unauthenticated write | Two-factor by domain convention: confirmation code **and** matching contact. Scoped to the agent's own services. Negative tests are acceptance criteria, not afterthoughts. |
| Four mock tenants in the production database | They are tenants like any other and must be created disabled/test-flagged, with a documented teardown. Explicitly approved before creation. |

## Dependencies

- `aa-reservas-validadas-y-cobertura-scraping` (merged in `b5c2daf`) — the day-key and
  instant-comparison fixes are the floor this builds on.
- pgvector knowledge ingestion, already working: web discovery reaches 144 sitemap URLs and
  retrieval answers policy questions at cosine distance ~0.30.
