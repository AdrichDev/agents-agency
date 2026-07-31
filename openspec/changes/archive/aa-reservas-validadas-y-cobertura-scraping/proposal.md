# Proposal — Reservas validadas en servidor y cobertura real del scraping

## Intent

Two measured failures block the product from being sellable:

1. **Bookings are not trustworthy.** In a controlled 6-turn conversation (n=5) the agent
   completed a booking 2/5 times, and **both** completed bookings were wrong: one had
   `email=null, telefono=null` after the user had given both, and one was created at
   `00:00` while the agent's schedule is Mon-Fri 09:00-18:00.

2. **The knowledge base does not contain the answers users actually ask for.** For an
   indexed e-commerce site, "how long does shipping to Spain take?" and "can I return
   these if they don't fit?" both returned "I don't have that confirmed". The retrieval
   returned customer reviews for a shipping query.

## Root causes (verified in code, not inferred)

### A. Bookings

- `createAppointment` (`back/src/lib/booking/appointments.ts:139`) writes the `TimeSlot`
  with whatever `slotStart`/`slotEnd` it receives. It **never** checks the slot against
  the agent's schedule or against `computeAvailableSlots`. The only protection is the
  `(servicio_id, inicio)` unique constraint, which stops a double booking of the exact
  same instant and nothing else.
- The only validation upstream is `assertValidRange` (`back/src/lib/agent/executor.ts:350`),
  which checks that the dates parse and that `end > start`. A hallucinated 00:00 passes.
- This is **not** agent-only: `routes/booking.ts POST /reserve` shares `createAppointment`,
  so the public booking endpoint accepts out-of-hours slots too.
- `crear_reserva` (`back/src/lib/agent/tools.ts:264`) marks only
  `["servicio","startIso","endIso"]` as required. Name, email and phone are optional, so
  the model can occupy a slot with no way to contact the customer.

### B. Scraping coverage

- `ingestWebsite` (`back/src/lib/scraper/web.ts:193,207`) builds its URL list as
  `discoverLinks(url, 8)` capped by `urls.slice(0, 9)`. `discoverLinks` returns the
  **first 8 internal links in DOM order** — i.e. the header menu. Shipping, returns,
  warranty and FAQ pages live in the footer, so they are never even fetched.
- Raising the cap alone does not fix it: the selection criterion is "first N in DOM
  order", which stays wrong at any N on a site with a large menu.
- Consequence: the chunk that answers the question is **absent from the index**. No
  retrieval tuning can recover content that was never ingested.

## Scope

**In scope**
- Server-side slot validation in `createAppointment` (covers agent tool *and* public endpoint).
- Require at least one contact channel for `crear_reserva`.
- Sitemap-aware, relevance-ranked page discovery in the scraper, with a higher page cap.

**Out of scope** (tracked separately, not touched here)
- The 4 tenants returning 402 on first message.
- Google Calendar two-way sync.
- The 10M token quota sizing.
- Retrieval threshold tuning (`MAX_DISTANCE`, `RELATIVE_MARGIN`, `k`) — revisit only
  after coverage is fixed, since the current evidence of "bad retrieval" is explained by
  missing content.

## Risks

| Risk | Mitigation |
|---|---|
| Slot validation breaks existing legitimate bookings (e.g. imported/manual ones) | Validation applies to `createAppointment` only; seeding and imports that bypass it are unaffected. Regression test on the happy path. |
| Agents with no schedule configured can no longer book at all | `ScheduleNotConfiguredError` is already the documented behaviour of `computeAvailableSlots`; surface it as a clear tool error, not a 500. |
| Higher page cap increases ingest time and embedding cost | Cap is bounded and explicit; ranked ordering means the valuable pages are fetched first, so a timeout degrades gracefully instead of losing policies. |

## Dependencies

None. All changes are inside `back/src/lib`.
