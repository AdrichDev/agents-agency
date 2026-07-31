# Proposal — The model's dates must mean what the customer meant

## Intent

Make the agent resolve customer dates against the real present, in the business's own
timezone, so that a booking the customer agrees to is the booking that gets created.

## Why now

A real conversation against production (agent `cms6pnui80002ccfx5roehwb8`, Lafayette,
`POST /api/chat`, anonymous, 2026-07-30) failed to create a single booking in four
attempts. Every attempt came back to the customer as *"esa hora ya no está disponible"*,
which reads as "we are full" — the customer hangs up and the business never learns it
lost the table. The stored `tool_calls` show why:

```
consultar_disponibilidad  input  {"desde":"2023-08-08T20:00:00","hasta":"2023-08-08T22:45:00"}
                          output [{"startTime":"2023-08-09T20:00:00.000+02:00", ...}]
crear_reserva             input  {"startIso":"2023-08-08T21:00:00", ...}
                          error  "El slot ya no esta disponible"
```

Two independent defects, plus a third the first two were masking.

## Scope

**D1 — The agent does not know today's date.** Nothing in the system prompt states it.
Asked for "sábado 8 de agosto" the model emitted `2023-08-08`: with no anchor it falls
back to its training era. Every date in the conversation above is three years stale.

**D2 — A naive ISO string from the model is parsed in the server's timezone.**
`executor.ts` does `new Date("2023-08-08T20:00:00")`, which on Render (UTC) means 22:00
in Madrid. Consequences, both observed in the transcript above:

- `consultar_disponibilidad` for 20:00–22:45 on the 8th returned slots on the **9th**,
  because `hasta` 22:45Z is 00:45 of the next day in Madrid.
- `crear_reserva` for 21:00 looked for a 23:00 slot. There is none, so **every** booking
  was rejected as `SlotUnavailableError`, whatever hour the customer picked.

This is the mirror image of the defect fixed in `02512d3`: that one translated the hours
the agent *speaks*; this one translates the hours the agent *hears*.

**D3 — Availability is only floored at the requested `desde`, never at the present.**
`generateSlots` filters `slotStart >= tz`, where `tz` is the start of the requested
range, not now. Asked for 2023 it happily offered slots in 2023. Fixing D1 makes this
hard to reach through the model, but the invariant belongs in the slot generator, which
is also what `POST /reserve` and `GET /slots` go through.

## Out of scope

- `booking/sync.ts` and `ExternalApiAdapter` keep speaking UTC, for the reasons recorded
  in the change `aa-reservas-multirecurso-y-mocks-sectoriales` (T7.3).
- Time-of-day precision in the prompt anchor: the anchor is emitted at **day**
  granularity on purpose (see `design.md`).

## Risks

- The prompt anchor is new text inside the cached system prefix. Emitted per message it
  would invalidate the provider cache on every turn. Mitigated by day granularity and by
  placing it last (`design.md`).
- Changing `parseIsoDate` affects every date-taking tool. An ISO string that already
  carries an offset or `Z` must keep meaning exactly what it says; only naive strings
  change meaning.

## Dependencies

`getAgentTimezone` (`lib/booking/timezone.ts`), added in `02512d3`.
