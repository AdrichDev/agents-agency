# Design

## Where the guards live

Both in `src/lib/agent/executor.ts`, in the `crear_reserva` branch, **before**
`adapter.crearReserva`. That is where `assertContactChannel` already sits, and it is the last
point common to every backend adapter (`managed_db` and `external_api`): putting the check in
one adapter would leave the other open.

Order matters, and it is the opposite of the obvious one:

```
1. contacto = await resolverContactoReserva(agentId, conversationId, i)   // fills gaps
2. assertContactChannel(contacto.email, contacto.telefono)                // then demand one
```

Filling first is what turns run 4 into a completed booking rather than a refused one. If the
model omits the phone, the visitor's real phone is already known and the booking should
succeed with it; failing first and filling never would keep the current behaviour, in which the
model is pushed to produce *something* — which is exactly how `910000002` got in.

## Guard 1 — the business's own contact is not a customer contact

```
Agent.tenantId → Tenant.phone, Tenant.email
```

A single `findUnique` on `agent`, selecting the tenant's two fields. Same shape as
`getAgentTimezone`: one small read per tool call, no cache, because a stale cache here would be
a stale *rejection*.

Comparison must survive how the two sides are written. The tenant row holds
`"+34 910 00 00 02"`; the model wrote `"910000002"`.

- **Phone** — reduce both to digits, then compare the **last 9**. Spanish numbers are 9 digits
  and the `+34` prefix is optional on both sides. Comparing full digit strings would miss the
  observed case; comparing a shorter suffix would start matching unrelated numbers.
- **Email** — trim and lowercase, then compare exactly. No suffix logic: an email either is the
  business's or is not.

Nullable on both sides. A tenant with no phone compares against nothing and rejects nothing.

When it matches, throw. The message is written for the model, because the agentic loop hands it
back as `{ error }`:

> Ese teléfono es el del propio negocio, no el del cliente. Pídele al usuario SU teléfono o su
> email y vuelve a llamar a `crear_reserva` con el dato suyo.

## Guard 2 — fill from what the visitor typed

Source of truth, in order:

1. what the model supplied — never overwritten, same rule as `completarContactoDelLead`
   (correcting a datum is a decision; that one is the model's);
2. `Lead.phone` / `Lead.email` of this `conversationId` — written deterministically by
   `completarContactoDelLead` from the visitor's own messages.

Not the current message: by the time a tool executes, `completarContactoDelLead` has already
run for this turn, so the lead row is the same datum with the extraction already done once.

A value taken from the lead is passed through guard 1 as well. The lead cannot normally hold
the business's own number — it is filled from visitor messages — but "normally" is not a
guarantee worth writing a hole for.

No `conversationId`, or no lead row: nothing to fill, and `assertContactChannel` then throws as
it does today. Fail-open on the *filling*, fail-closed on the *demand*.

## Files

| File | Change |
|---|---|
| `src/lib/agent/booking-contact.ts` | new — `mismoTelefono`, `mismoEmail`, `cargarContactoDelNegocio`, `resolverContactoReserva` |
| `src/lib/agent/executor.ts` | `crear_reserva` calls the resolver before `assertContactChannel`; passes the resolved contact on to the adapter and to `notificar` |
| `back/tests/reserva-contacto-real.test.ts` | new — the guards, unit |
| `back/tests/agent-executor*.test.ts` | extend if an existing `crear_reserva` test asserts the old argument flow |

New file rather than more functions in `executor.ts`: the executor is already the longest file
in the agent lane, and these are pure comparisons that deserve to be tested without a backend
adapter in the way.

## Data flow

```
crear_reserva(i)
  ├─ cargarContactoDelNegocio(agentId)        → { telefono, email } | null
  ├─ leadDeLaConversacion(conversationId)     → { telefono, email } | null
  ├─ resolverContactoReserva(...)             → { telefono?, email? }
  │     ├─ rechaza el contacto del negocio    → Error accionable
  │     └─ rellena huecos desde el lead
  ├─ assertContactChannel(...)                → Error accionable si sigue vacío
  └─ adapter.crearReserva(..., contacto)
```

`notificar("nueva_reserva", …)` receives the **resolved** contact, not the raw input. The
business owner's notification would otherwise show the phone the model made up while the row
held the real one.

## Test strategy

Unit, no database. The two comparisons and the resolver are pure once the two reads are
injected, so the tests pass the tenant contact and the lead contact as arguments.

Mutation checks, because a comparison nobody can kill is a decoration:

- pinning the phone comparison to `false` must kill the rejection test;
- pinning it to `true` must kill the "a real customer phone is accepted" test;
- removing the last-9-digits normalisation must kill the `"+34 910 00 00 02"` vs `"910000002"`
  case specifically — that is the whole reason the normalisation exists.

Then the live measurement: SEC3 re-run n≥3 on `barberia`, and the created row **read from
`aa.cita`** — the contact column, not the transcript. A reply saying "te he apuntado el
622334455" is not evidence that the row holds it.
