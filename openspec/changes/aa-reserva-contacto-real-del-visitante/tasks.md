# Tasks

Source of the defect: row SEC3 of the casuistry matrix, measured during T4.2 of
`aa-agente-no-inventa-datos-ni-politicas`. Baseline and A/B in that change's `tasks.md`,
section *Out of scope*.

## T1 — Comparisons that survive how people write

- [x] **T1.1** `mismoTelefono(a, b)` — digits only, compare the last 9. Nullable on both sides.
      Test: `reserva-contacto-real.test.ts` — `"+34 910 00 00 02"` ≡ `"910000002"`;
      `"622334455"` is not the same number; `null` on either side is never a match.
- [x] **T1.2** `mismoEmail(a, b)` — trim, lowercase, exact.
      Test: same file — `"  Hola@Barberia.es "` ≡ `"hola@barberia.es"`; a different address is
      not; `null` is never a match.

## T2 — The business's own contact is refused (AC1, AC2, AC3, AC4)

- [x] **T2.1** `resolverContactoReserva` throws when the supplied phone or email is the
      tenant's own. Actionable message: name the datum and ask for the customer's.
      Test: same file — one case per channel, asserting the message names the business.
- [x] **T2.2** Mutation check. Pinning the comparison to `false` must kill T2.1; pinning it to
      `true` must kill the accepted-customer-contact case; removing the last-9-digits rule must
      kill the `+34` case and nothing else. A comparison no test can kill is a decoration.
      Result: all three mutants killed, and the third killed **only** the mixed-format cases, as
      the design predicted. Source reverted, no `MUTANT` marker left behind.
- [x] **T2.3** `cargarContactoDelNegocio(agentId)` — `Agent.tenantId → Tenant.phone/email`, one
      read, no cache. Returns `null` for an agent with no tenant.
      Test: same file, with an injected client — no tenant and a tenant with both fields `null`
      both reject nothing (AC7).

## T3 — The missing contact comes from the conversation (AC5, AC6)

- [x] **T3.1** Fill an absent `telefono`/`email` from the `Lead` of this `conversationId`.
      Test: same file — no supplied contact plus a lead with a phone yields that phone.
- [x] **T3.2** Never overwrite what the model supplied.
      Test: same file — a supplied phone survives a lead holding a different one.
- [x] **T3.3** A value taken from the lead passes through T2.1 too.
      Test: same file — a lead holding the business's phone is refused, not silently used.
- [x] **T3.4** No `conversationId` and no lead: nothing is filled, `assertContactChannel` keeps
      its current behaviour and message.
      Test: same file, and it asserts `lead.findUnique` is never called at all.

## T4 — Wiring and verification

- [x] **T4.1** `crear_reserva` resolves the contact **before** `assertContactChannel`, and
      passes the resolved contact to `adapter.crearReserva` and to `notificar` (AC8).
      Test: `agent-executor-reservas.test.ts` — both call sites receive the resolved value.
      The two reads sit **after** `assertValidRange`: they now cost two queries, and a call with
      the dates inverted should not pay for them.
- [x] **T4.2** Row SEC3 re-run on the live `barberia` agent (`gpt-4.1-nano`), verdict read from
      `aa.cita`. Harness: `back/scripts/diag-sec3-contacto.ts`, which logs every tool call and
      its error, reads the row, and cancels it before the next repetition. It adds a third turn
      to the original two, because a rejection costs a turn and without one more there is no way
      to see whether the model recovers.

      **The guard caught the real defect, unforced.** In one repetition the model called
      `crear_reserva({... "telefono":"910000002" ...})` — the business's own number, exactly the
      failure this change exists for. It was refused, and the model's next call wrote
      `622334455`. Before this change that call would have created the appointment.

      | arm | n | appointments carrying the visitor's phone | appointments carrying the business's number |
      |---|---|---|---|
      | with the guard | 9 | 4 | **0** |
      | executor wiring reverted (A/B) | 9 | 4 | 0 |

      Independent confirmation on the matrix itself: `run-casuistry-matrix.ts barberia` closed
      SEC3 with `BAR-HW8R`, and the row reads
      `Iker Salaverria | tel=622334455 | email=null`. The defect wrote `Usuario | tel=910000002`.

      The 4/9 close rate is **identical in both arms**, so it is not caused by this change — see
      *Out of scope*. Note also what the A/B could not show: the model attempted the business's
      number once in 18 live runs, so nine reverted runs were never going to re-exhibit a defect
      that rare. The before/after evidence here is the single live capture plus T2.2's mutants,
      not a corruption-rate delta.
- [x] **T4.3** `npx tsc --noEmit` clean; full vitest suite 175 files / 2107 tests, 0 skipped,
      `EXIT=0`, run with the real `.env` sourced.
- [x] **T4.4** Test fixtures cancelled. Verified by query, not by assumption: zero `scheduled`
      appointments left in the 10–15 Aug window across every agent.

## Final verifications

- [x] **V1** Every AC in `validation.md` has one green test. AC9 is the live measurement in
      T4.2, read from the database.
- [x] **V2** The matrix rows that pass today still pass. Re-ran the two booking blocks:
      SEC2 gives 24 € with its web source, SEC4 keeps the laser in its own cabin, SEC6 gives
      60 minutes. SEC1 asks for a contact, as it did before. SEC5 is discussed below.
- [x] **V3** No claim about a stored contact taken from a transcript. Every one read from
      `aa.cita`, including the rejected repetitions, where the verdict was *no row at all*.

## Out of scope, and why

- **The agent fails to close the booking in about half of the runs.** Measured, 3 turns per run:
  4/9 with the guard, 4/9 with the executor wiring reverted. In the failing runs the model
  answers the second turn by calling `consultar_mis_reservas` or `guardar_lead` instead of
  `crear_reserva`, then tells the visitor there is no reservation — after the visitor gave their
  name and phone. The guard never fires in those runs, and it only ever executes inside the
  `crear_reserva` handler, so it cannot be the cause. This is a real defect and it loses
  bookings, but it is tool selection on `gpt-4.1-nano`, a different problem with a different
  fix, and it needs its own measurement.
- **SEC5 answers "only one appointment per person is allowed"** to two friends asking for
  manicures at the same time, which is not the configured policy. Same class of problem as
  above, same agent family, not touched here.
- **The re-asking** (baseline runs 1–3: the agent asks for a contact the visitor gave in the
  same turn). It corrupts nothing, and T3.1 makes the booking complete with the right number
  even when the model never asks again. Wording work on `avisoContactoEnMensaje` is a separate
  question with its own measurement.
- Rejecting any phone the visitor never typed. It would also reject legitimate cases — a number
  dictated in words, a transport that supplies the number outside the message body — and there
  is no measurement showing the model invents numbers other than the business's own.
- `consultar_mis_reservas` and `cancelar_reserva`: they read by contact, so a wrong contact
  finds nothing rather than writing anything.
