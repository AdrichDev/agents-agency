# Validation

## User story

As a **tenant**, I need every booking my agent creates to carry a contact my staff can actually
reach, so that a full agenda is a full agenda and not a list of numbers that ring my own
reception desk.

As a **visitor**, I need the contact I typed to be the contact on my booking, so that the
business calls me if something changes.

## Acceptance criteria

- **AC1** — A `crear_reserva` call whose `telefono` is the business's own phone is refused. No
  row is written, and the error names the problem in terms the agent can act on.
- **AC2** — Same for `email`.
- **AC3** — The comparison survives formatting: `"+34 910 00 00 02"` stored on the tenant and
  `"910000002"` supplied by the model are the same number. Email comparison survives case and
  surrounding whitespace.
- **AC4** — A genuine customer contact is untouched. The guard rejects the business's contact
  and nothing else.
- **AC5** — When the model omits the contact and the visitor already gave one in the
  conversation, the booking is created with the visitor's datum instead of being refused.
- **AC6** — A contact the model did supply is never overwritten by the lead's.
- **AC7** — A tenant with no stored phone or email neither throws nor blocks any booking.
- **AC8** — The business owner's `nueva_reserva` notification carries the same contact that was
  written to the row.
- **AC9** — Row SEC3 of the casuistry matrix completes the booking, and the appointment in
  `aa.cita` carries `622334455` — read from the database, not from the reply.

## Scenarios

### GWT1 — the business's own phone (AC1, AC3)
**Given** the `barberia` agent, whose tenant row holds `phone = "+34 910 00 00 02"`,
**when** the model calls `crear_reserva` with `telefono: "910000002"`,
**then** the call throws before the adapter is reached, the message says the number is the
business's own and asks for the customer's, and no appointment is created.

### GWT2 — a real customer phone (AC4)
**Given** the same agent,
**when** the model calls `crear_reserva` with `telefono: "622334455"`,
**then** the contact passes through unchanged and the appointment is created with it.

### GWT3 — the model omits the contact (AC5, AC6)
**Given** a conversation whose `Lead` holds `phone = "622334455"`, written by
`completarContactoDelLead` from the visitor's own message,
**when** the model calls `crear_reserva` with neither `email` nor `telefono`,
**then** the appointment is created with `622334455`;
**and given** the same conversation, **when** the model supplies `telefono: "600111222"`,
**then** the appointment keeps `600111222` — the lead does not overwrite it.

### GWT4 — tenant without contact data (AC7)
**Given** a tenant whose `phone` and `email` are both `null`,
**when** the model calls `crear_reserva` with any contact,
**then** nothing is rejected and the booking proceeds as it does today.

### GWT5 — the live row (AC9)
**Given** the `barberia` agent on its production model,
**when** the SEC3 turns are replayed — *"Corte y barba el martes … a las 17:00."* then
*"Perfecto. Soy Iker Salaverria, teléfono 622334455."* —
**then** an appointment exists in `aa.cita` for that agent whose phone column is `622334455`,
and no appointment exists whose phone is the business's own.

## One test per task

| Task | Test |
|---|---|
| T1.1 phone comparison | `reserva-contacto-real.test.ts` — `"+34 910 00 00 02"` ≡ `"910000002"`; `"622334455"` is not the same number |
| T1.2 email comparison | same file — `"  Hola@Barberia.es "` ≡ `"hola@barberia.es"`; a different address is not |
| T2.1 guard rejects the business's contact | same file — the resolver throws for the tenant's phone and for its email, and the message names the datum |
| T2.2 mutation check | same file — forcing the comparison to `false` kills T2.1; forcing it to `true` kills the "real customer contact accepted" case; dropping the last-9-digits rule kills the `+34` case alone |
| T3.1 fill from the lead | same file — no contact supplied and a lead with a phone yields that phone |
| T3.2 supplied contact wins | same file — a supplied phone survives a lead holding a different one |
| T3.3 nothing to fill | same file — no lead and no supplied contact still reaches `assertContactChannel` and throws its existing message |
| T4.1 executor wiring | `agent-executor-reservas.test.ts` — `crear_reserva` passes the resolved contact to the adapter **and** to `notificar` |
| T4.2 live SEC3 | `run-casuistry-matrix.ts` row SEC3, n≥3, verdict taken from `aa.cita` |

## Gate

AC9 is the gate. The change is not done because the unit tests are green — it is done when a
booking created by the live agent carries the visitor's phone in the database. Runs 1–4 of the
baseline all produced confident replies; one of them wrote the wrong number anyway.
