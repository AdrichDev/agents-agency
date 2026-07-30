# Design

## D1 — Date anchor in the system prompt

`buildSystemPrompt` gains an optional last parameter:

```ts
fechaActual?: { instante: Date; timezone: string }
```

The function stays pure — deterministic given its inputs — so the anchor is pinned in
tests instead of depending on the wall clock. The caller in `engine.ts` supplies
`{ instante: new Date(), timezone: await getAgentTimezone(agentId) }`.

Rendered line, in the business's zone:

```
Hoy es jueves, 30 de julio de 2026 (zona horaria del negocio: Europe/Madrid).
Resuelve SIEMPRE las fechas relativas del cliente ("mañana", "el sábado", "el 8 de
agosto") contra esa fecha. Nunca uses otro año.
```

**Granularity is the day, not the minute, and this is deliberate.** The provider cache
matches on an exact prefix. A timestamp that changes every turn would miss the cache on
every message of every conversation — the same failure mode already recorded for the
contact-details block (`aa-agentes-economia-tokens`, T4.1). At day granularity the prefix
is stable for 24 h and shared by every conversation of the agent. The anchor answers
*which date* the customer means; *what time it is right now* is not needed for that, and
the availability floor (D3) enforces the present server-side, where it belongs.

**Position: last of `systemParts`.** Everything before it is stable per agent, so the
one block that rotates daily sits at the end of the cacheable prefix rather than in the
middle of it.

The weekday name is part of the anchor: "el sábado" cannot be resolved from a date alone
without the model doing calendar arithmetic it gets wrong. Rendered with luxon's `es`
locale, which is the language these agents speak.

## D2 — Naive ISO resolves in the agent's timezone

New export in `lib/booking/timezone.ts`:

```ts
export function parseIsoInZone(value: string, timezone: string): DateTime
```

Rules:

- The string carries an offset or `Z` ⇒ respected verbatim. It is already unambiguous and
  reinterpreting it would move the instant.
- The string is naive (`2026-08-08T21:00:00`, or a bare `2026-08-08`) ⇒ read in
  `timezone`. This is the whole fix: `21:00` from a customer talking to a Madrid
  restaurant is 21:00 in Madrid, never 21:00 UTC.
- Unparseable ⇒ the caller raises the same readable error as today, so the agentic loop
  can retry.

`executor.ts` resolves the timezone once per tool call via `getAgentTimezone(agentId)`
and threads it into:

- `consultar_disponibilidad` — `desde` / `hasta`, passed on as `Date`.
- `crear_reserva` — `startIso` / `endIso`. These are handed to the adapter **as strings**,
  so they are normalised to zoned ISO (`...T21:00:00.000+02:00`) before being passed.
  Downstream `new Date(...)` in `managed-db.ts` then yields the right instant without any
  further change, and `assertValidRange` compares two normalised strings.

`withBackendAdapter` passes `agentId` to its callback so the handler can resolve the
zone; existing callbacks that ignore it are unaffected.

An agent with no `AgentSchedule` falls back to `DEFAULT_TIMEZONE` — the same fallback
`getAgentTimezone` already applies everywhere else.

## D3 — Availability floor at the real present

`generateSlots` gains an optional `now: Date = new Date()` parameter and filters
`slotStart >= max(rangeStart, now)`. The existing filter (relative to the requested
range) stays: it is what stops "today at 09:00" from being offered at 23:20. The new
term is what stops a slot in a past *year* from being offered at all.

Injectable so tests pin it; defaulted so no call site changes.

## Files

| File | Change |
|---|---|
| `back/src/lib/booking/timezone.ts` | + `parseIsoInZone` |
| `back/src/lib/booking/slots.ts` | `generateSlots` floors at `now` |
| `back/src/lib/agent/executor.ts` | zone-aware parsing for the two booking tools |
| `back/src/lib/agent/engine.ts` | date anchor in `buildSystemPrompt` + caller |
| `back/tests/booking-timezone.test.ts` | new |
| `back/tests/booking-slots.test.ts` | + past-year floor |
| `back/tests/agent-backend-tools.test.ts` | + naive-ISO cases |

## Test strategy

Unit, vitest, no live provider. The three defects are all deterministic given a pinned
`now` and a pinned agent timezone, so each gets a test that fails against the current
code. The end-to-end proof is a real conversation against production after deploy,
recorded in `validation.md` under V1.
