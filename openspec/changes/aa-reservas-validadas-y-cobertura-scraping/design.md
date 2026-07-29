# Design — Reservas validadas y cobertura de scraping

## A. Server-side slot validation

### Where the check goes

In `createAppointment`, **inside** the existing `Serializable` transaction, before the
`timeSlot.create`. Reasons:

- It is the single choke point shared by the agent tool (`ManagedDbAdapter.crearReserva`)
  and the public endpoint (`routes/booking.ts POST /reserve`). Validating in the adapter
  would leave the HTTP endpoint open.
- Inside the transaction the availability read and the slot write are serialized against
  concurrent bookings, so the check cannot go stale between read and write.

### The check

```
candidates = computeAvailableSlots(serviceId, { desde: slotStart, hasta: slotEnd })
match = candidates.find(c => c.startTime === slotStart.toISOString()
                          && c.endTime   === slotEnd.toISOString())
if (!match) throw new SlotUnavailableError(slotStart.toISOString())
```

`computeAvailableSlots` already does exactly the right thing: it generates the theoretical
slots from the agent's schedule and timezone, subtracts blocked ranges, and subtracts slots
already taken. Reusing it means the agent can never book something the UI would not offer.

`SlotUnavailableError` is reused rather than adding a new error type: the caller-visible
outcome is identical ("that slot is not bookable, offer alternatives"), the tool
description already tells the model to offer alternatives on that signal, and
`routes/booking.ts` already maps it to a 409.

**Exact-match, not containment.** A slot is valid only if it matches a generated slot on
both ends. Accepting "any interval inside business hours" would let the model invent
09:07-09:37 and desynchronize the grid from what `GET /slots` offers.

### Prisma client inside the transaction

`computeAvailableSlots` currently takes no client argument and uses the module-level
`prisma`. It gains an optional last parameter `client: Prisma.TransactionClient = prisma`
so the validation reads through `tx`. Default value ⇒ every existing call site is
unchanged.

## B. Contact requirement for `crear_reserva`

Two layers, because each catches a different failure:

1. **Schema** (`tools.ts`): `required: ["servicio","startIso","endIso","nombre"]` and the
   description states that either `email` or `telefono` is mandatory. JSON Schema `anyOf`
   is not reliably honoured across providers, so the hard guarantee is layer 2.
2. **Executor** (`executor.ts`): before calling the adapter, reject when both `email` and
   `telefono` are empty, with a message the model can act on ("ask the customer for a
   phone or an email before booking"). A tool error is fed back into the loop, so the
   model asks and retries in the same conversation instead of silently booking a ghost.

## C. Scraper page selection

### Discovery order

1. `sitemap.xml` (and `sitemap_index.xml`) at the origin. Shopify/WooCommerce/Wix all
   publish one; it is the complete URL list, not a DOM-order sample.
2. Fallback / supplement: internal `<a href>` links, as today, but **all** of them
   (no early `limit` cut) so ranking sees the footer.

`discoverLinks`'s `limit` currently truncates *during* collection, which is what discards
the footer. It becomes a cap applied *after* ranking.

### Ranking

Score each candidate URL by keyword hits in the path and anchor text, in both Spanish and
English. High-value pages first:

- tier 1: shipping, returns, warranty, faq, terms, privacy, contact, prices
- tier 2: about, services, booking
- tier 3: everything else (products, collections, blog, reviews)

The landing URL always stays first. Ties keep DOM order, so behaviour is deterministic.

### Cap

`MAX_PAGES = 25` (from 9), exported as a named constant. Rationale: the ranked list puts
policy pages in the first few positions, so the cap now controls *cost*, not *whether the
answer exists*. 25 keeps a full ingest inside the existing timeout budget.

## Files changed

| File | Change |
|---|---|
| `back/src/lib/booking/appointments.ts` | `computeAvailableSlots` accepts a tx client; `createAppointment` validates the slot inside the transaction |
| `back/src/lib/agent/tools.ts` | `crear_reserva`: `nombre` required, contact stated in description |
| `back/src/lib/agent/executor.ts` | `crear_reserva`: reject when no contact channel |
| `back/src/lib/scraper/web.ts` | sitemap discovery, ranked ordering, `MAX_PAGES = 25` |
| `back/tests/booking-slot-validation.test.ts` | new |
| `back/tests/scraper-page-ranking.test.ts` | new |

## Test strategy

Unit tests against the real functions with a mocked Prisma, following the existing
`back/tests` patterns. The ranking function and the contact guard are pure and tested
directly. Slot validation is tested through `createAppointment` with a stubbed schedule.
