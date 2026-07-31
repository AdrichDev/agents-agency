# T0 — Measurement before design

Run on 2026-07-31 against the live mock tenants, with `back/scripts/run-t0-invenciones.ts`.
Model forced per row via a temporary DB flip, restored in a `finally`. n=3 per row.

Baseline being compared against: the same three rows on `gpt-4.1-nano`, recorded in
`../aa-reservas-multirecurso-y-mocks-sectoriales/casuistry-verdict.md`.

## Result

| Row | Tenant | `gpt-4.1-nano` (baseline) | `gpt-5.4-mini` (this run) | Nature of the defect |
|---|---|---|---|---|
| H4 | Brasserie Lafayette | invents a kitchen closing time | **3/3 pass** | model |
| C5 | Mendieta | invents a first name | **3/3 pass** | model |
| SEC5 | Estética Aurea | claims only one fits | **3/3 staggered, 0/3 parallel** | **not invention — tool contract** |

## H4 — kitchen closing time (3/3 pass)

All three replies open with "no lo tengo confirmado" and then offer the booking hours
*labelled as booking hours*. The aggravating factor written into the criterion — attaching
`(fuente: …)` to a claim the chunk does not support — does not occur: the citation accompanies
the datum that genuinely is in the chunk.

## C5 — name on the reservation (3/3 pass)

The model does not risk a name at all. It answers with the confirmation code, the date and the
party size. The invented first name of the baseline run does not reappear in any repetition.

## SEC5 — two friends, same hour (the interesting one)

SEC5 does **not** fail on invention, and two rounds of measurement were thrown away before that
was visible. Both discarded rounds failed for reasons in the harness, not in the agent:

1. **The scenario sat on the tenant's own holiday closure.** It was planted on Thursday
   2026-08-13, and `politicas.md` of Estética Aurea says "Cerramos … del 10 al 24 de agosto".
   The repetition that answered *"el centro está cerrado del 10 al 24 de agosto"* — the only
   correct answer available — was being scored as a failure. Moved to 2026-09-03.
2. **The harness burned the slot it was trying to free.** Its cleanup marked
   `TimeSlot.available = true` instead of deleting the row. `createAppointment` always inserts
   a fresh `TimeSlot` and the unique is `(resourceId, startTime)`, so the leftover row made that
   `(cabin, instant)` unbookable forever, while `computeAvailableSlots` — which only subtracts
   `available: false` — kept offering the hour. Every repetition after the first died in P2002.
   Product cancellation is not affected: `cancelAppointment` **deletes** the slot. The harness
   now calls that same function.

With both fixed, the result is stable and identical across all three repetitions:

> The agent books **both** appointments and states the policy correctly ("dos citas separadas,
> una por persona" — accurate, `maxPartySize = 1` on Manicura). But it places the second at
> **11:30**, never in parallel at 11:00.

### Why, verified against the engine

`back/scripts/diag-multirecurso.ts` measures the booking engine directly, with no model in the
loop. On a clean day, Manicura, 2 cabins:

```
[1] día vacío                    → a las 11:00: 1 franja
[2] tras ocupar UNA cabina       → a las 11:00: 1 franja   (asigna Cabina 2)
[3] tras ocupar LAS DOS          → a las 11:00: 0 franjas
```

The engine is correct: it keeps offering 11:00 with one cabin taken, assigns the free one, and
withdraws the hour only when both are gone. Two appointments at the same `startTime` on distinct
resources both persist.

The gap is in what reaches the model. `managed-db.ts:184`:

```ts
// Los ids de recurso son inventario interno: no viajan al prompt del modelo.
return slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
```

`computeAvailableSlots` collapses to one entry per instant and the adapter drops
`freeResourceIds`. The model sees `11:00` exactly once, spends it on the first person, and looks
for the next free time for the second. It is not inventing a capacity policy — it is reasoning
correctly over a tool result that never told it how many places the hour holds.

Withholding resource ids is right; they are inventory. Withholding **cardinality** is what
breaks the case.

## T0.2 — Decision

**Two of the three "inventions" disappear on model change alone. The third was never an
invention.**

Consequences for this change:

- **T1 and T2 lose their justification as written.** They rewrite instructions that
  `gpt-5.4-mini` already follows (`engine.ts:331`, `engine.ts:577`). Neither H4 nor C5 reproduces
  on the larger model, so there is no measured defect left for a prompt rewrite to fix. Keeping
  them would be paying for a fix to a problem that only exists on a model we can choose not to
  use for these agents.
- **T3 changes nature.** It was written as a prompt rule ("never state a capacity a tool did not
  return"). The measurement says the rule is not the missing piece: the tool result is. The work
  is to expose per-instant capacity in `consultarDisponibilidad`, without leaking inventory ids.
- **T3.2 is already satisfied by the engine** and confirmed by `diag-multirecurso.ts`. It still
  deserves a regression test, because nothing pins it today.

## SEC5 — fixed and re-measured (T3 + T4.1)

Two defects, measured one at a time. Neither alone closes the row.

| State | SEC5, n=3, counted in `aa.cita` |
|---|---|
| Baseline | **0/3** — books both, but staggers the second to 11:30 |
| `+ plazasSimultaneas` | **1/3** — sees the capacity, then hands off to the phone |
| `+ branched GroupTooLargeError` | **3/3** — both at 11:00, distinct cabins |

The second defect only became visible once the first was fixed. With the cardinality published,
the agent opened with *"hay hueco para dos a la vez"* — exactly the reasoning that was missing —
and then tried a single appointment for two people. That hit `maxPartySize = 1` on Manicura and
raised `GroupTooLargeError`, whose message read:

> Los grupos mas grandes se gestionan por el canal de grupos y eventos del negocio: indicaselo
> al cliente con los datos de contacto de tus instrucciones y **NO intentes otras horas**.

The agent obeyed, to the letter. That text is right for a party of 14 in a restaurant and wrong
for a single-place service, where two people fit at the same hour in two appointments. It was
not the model failing to follow instructions — it was the product instructing it to hand off a
case it could solve. The message now branches on `maxPartySize === 1` and says to call
`crear_reserva` once per person at the same hour.

Worth recording as method: the first fix looked like a failure (1/3) and was in fact working.
Reading only the pass count would have led to reverting it.

### Open gate — Adrián decides

Routing these agents to a larger model is a **cost** decision, not a correctness one, and it is
not mine to take. The measurement says it fixes H4 and C5; it does not say it is worth the
money. Current production spread is on record in Engram (no agent runs `gpt-4.1-mini`;
`gpt-4.1-nano` is on 4 agents).

Until that is decided, this change should not be archived: the SEC5 half is real work regardless
of routing, the H4/C5 half depends entirely on the answer.
