# Proposal — the contact on a booking must be the visitor's

## Intent

`crear_reserva` writes into a tenant's agenda whatever string the model puts in `telefono` or
`email`. There is a guard, `assertContactChannel`, but it only checks that *some* channel is
present. It cannot tell a real contact from a made-up one, and a made-up one is worse than none:
an empty field is visibly empty, while a plausible phone number looks like a customer.

Measured on 2026-07-31 while running T4.2 of `aa-agente-no-inventa-datos-ni-politicas`, row SEC3
of the casuistry matrix, agent `barberia`, model `gpt-4.1-nano`, n=4:

| Run | Outcome |
|---|---|
| 1 | asks for the contact again, one turn after the visitor gave it |
| 2 | asks for the contact again |
| 3 | asks for the contact again |
| 4 | **books with `910000002`** — the *business's own phone*, taken from its instructions — under the customer name `Usuario` |

The visitor's message is *"Perfecto. Soy Iker Salaverria, teléfono 622334455."* The datum is
right there, in the same turn.

Ruled out as a regression of the sibling change by an A/B with a single variable: with the new
`consultar_disponibilidad` text removed and the day cleaned to the same starting state,
`gpt-4.1-nano` fails identically.

Run 4 is the reason this is a change and not a note. It puts a row in a paying customer's
agenda with a phone number that reaches the customer's own reception desk. Nobody can call the
person who booked, and nothing in the row says so.

## Scope

Two deterministic guards, both computed **outside the model** — the pattern already proven in
this codebase by `lead-contact.ts`, after three prompt rewrites failed at the same job.

1. **A booking may not carry the business's own contact.** The agent's tenant already stores
   `Tenant.phone` and `Tenant.email`. If the phone or the email the model supplies is the
   business's own, the call is refused with an actionable error and nothing is written.
2. **A missing contact is taken from the conversation, not invented.** The visitor's phone and
   email are already extracted deterministically per turn (`extraerTelefono`, `extraerEmail`)
   and persisted on the conversation's `Lead`. When the model omits the channel,
   `crear_reserva` fills it from there instead of failing — the datum the visitor typed, never
   a datum the model composed.

Both are cheap, both are checked before the database is touched, and neither depends on the
model obeying prose.

## Out of scope

- **The re-asking (runs 1–3).** The agent asking again for a contact it was just given is
  annoying, not corrupting: no wrong row reaches the database, and guard 2 means the booking
  now completes with the right number even when the model never asks. Prompt work on the
  wording is a separate, measurable question.
- Rejecting *any* unrecognised phone (one the visitor never typed). It would also reject
  legitimate cases — a phone dictated in words, a channel where the number comes from the
  transport rather than the message body — and there is no measurement saying the model invents
  numbers other than the business's own.
- `consultar_mis_reservas` / `cancelar_reserva`. They read by contact; a wrong contact there
  finds nothing rather than writing anything.

## Risks

- **False rejection.** A visitor whose own phone genuinely is the business's phone — a member
  of staff booking for themselves. Rare, and the failure is a refused tool call that the agent
  can resolve by asking, not a lost booking.
- **Tenant with no stored contact.** `Tenant.phone` and `Tenant.email` are both nullable. Guard
  1 then has nothing to compare against and does nothing; it must not throw or block.

## Dependencies

None. `Agent.tenantId`, `Tenant.phone`, `Tenant.email`, `Lead.phone`, `Lead.email` and the
extractors in `src/lib/agent/lead-contact.ts` all exist today. No migration.
