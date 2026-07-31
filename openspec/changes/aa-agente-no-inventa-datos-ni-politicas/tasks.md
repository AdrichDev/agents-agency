# Tasks

Source of the three defects: the casuistry matrix of
`aa-reservas-multirecurso-y-mocks-sectoriales` (rows H4, C5, SEC5). Verdict and transcripts in
`openspec/changes/aa-reservas-multirecurso-y-mocks-sectoriales/casuistry-verdict.md`.

## T0 — Measure before designing (goes first, on purpose)

- [x] **T0.1** Re-run rows H4, C5 and SEC5 **unchanged** on a larger model (`gpt-5.4-mini`),
      n≥3 each. Record how many of the nine turns invent.
      Done 2026-07-31 with `back/scripts/run-t0-invenciones.ts`. Numbers and transcripts in
      `t0-measurement.md`. H4 3/3 pass, C5 3/3 pass, SEC5 3/3 staggered.
- [x] **T0.2** Decide from the number, and write the decision down: if the larger model passes
      all nine, this change is about model routing and T1-T3 shrink to the deterministic parts
      only. If it invents too, the prompt is not the variable and the deterministic work is the
      whole fix.
      Decision written in `t0-measurement.md#t02--decision`. Two of the three inventions vanish
      on model change; the third was never an invention. **Blocked on a cost decision by Adrián**
      (routing these agents to a larger model) before T1/T2 can be dropped or kept.

      Rationale: `gpt-4.1-nano` is being asked to follow a long instruction set that already
      contains "no inventes" (`engine.ts:577`) and "NUNCA cites una fuente que no te haya sido
      entregada" (`engine.ts:331`). Rewriting rules that are already there, without knowing
      whether the model can follow any of them, is the expensive path.

## T1 — Absence stated, not left blank (AC1)

Decision by Adrián, 2026-07-31: **implement against `gpt-4.1-nano`, no routing to a larger
model.** So T1/T2 ask the model for nothing new — the three anti-invention rules are already in
the prompt (`engine.ts:327-333`, `base-directives.ts:69`) and T0 measured that the larger model
obeys them 3/3 while the small one does not. What ships is turn-facts and deterministic
post-processing, the same pattern as `lead-contact.ts` and `booking-contact.ts`.

- [x] **T1.1** `buildKnowledgeBlock` returned `null` when retrieval came back empty and the
      caller dropped the message, so the model never learned the search had happened. It now
      emits the fact: search done, zero relevant chunks, the datum does not exist, offer the
      direct contact, do not answer with a similar datum, do not cite any source.
      Test: `agent-sin-dato.test.ts`, 4 cases, plus the two inverted legacy tests in
      `engine.test.ts` that pinned the old silence.

      Found while wiring it: `prefetchKnowledge` swallowed a search failure and returned `[]`.
      Since T1.1, an empty list **means** "it was searched and the datum does not exist", so a
      crashed pgvector would have asserted that too — inventing in the other direction. It now
      returns `null` and the turn goes without the block. Pinned by the pre-existing test *"si la
      búsqueda falla, responde igual sin fragmentos"*, which stays at 2 messages.
- [x] **T1.2** Same for the contact block: when the name is not known, `buildContextFactsBlock`
      says so instead of leaving the model to fill the gap.
      **Narrowed while measuring:** the aviso rides only when some contact datum is already
      known. Emitting it on a turn where nothing at all is known — the ordinary first turn, and
      the majority of turns — costs tokens on every one of them and buys nothing, because no
      booking is being composed yet. Row C5 breaks in the opposite case: a phone is already on
      file, the booking is in motion, and the name is the one gap the model fills from thin air.
      Test: `agent-sin-dato.test.ts`, 3 cases including the no-regression one on T4.1 of the
      tokens change.

**Token cost of T1, measured not estimated** (`scripts/diag-coste-bloques.ts`, asking
`gpt-4.1-nano`'s own tokenizer via `usage.prompt_tokens` with `max_completion_tokens: 1`):

| turn | before | after |
|---|---|---|
| ordinary (contact data unknown) | 0 | **0** — no block emitted |
| contact data known, name known | 25 | **25** — byte-identical |
| contact data known, name unknown | 25 | **53** (+28) |
| retrieval returned zero chunks | 0 | **72** |

The 72 rides only on turns that previously sent nothing at all and where the model was inventing
in the silence. Neither block touches the cacheable prefix, so `aa-agentes-economia-tokens`'s
−48% is unaffected on the turns that dominate the bill.

## T2 — A citation must point at a chunk that was delivered (AC2, half)

- [x] **T2.1** Post-processing over the reply: every `(fuente: X)` whose references do not all
      resolve to a delivered chunk loses the citation and keeps the sentence.
      Shipped in `back/src/lib/agent/citation-support.ts`, wired at the end of `runAgent` over
      both paths by which knowledge reaches the model (numbered prefetch, and `search_knowledge`,
      whose chunks are registered with `indice: 0` so an invented `(fuente: [0])` cannot resolve
      against them).
      Test: `agent-citas-respaldadas.test.ts`, 19 cases.

      **The original design was measured and discarded.** It asked for lexical overlap between
      the carrying sentence and the chunk, below a threshold. Measured over the 36 cited replies
      in history (`scripts/diag-citas-respaldadas.ts`), it orders the two Lafayette cases
      **backwards**: the H4 invention — *"la cocina cierra a las 15:45"* against a chunk that
      only gives the RESERVATION schedule — scores **0.78**, because it repeats nearly every word
      of the chunk and changes one; the honest reply — *"no tengo confirmado a qué hora cierra la
      cocina"* — scores **0.33** and would have been stripped. Any threshold that kills the
      invention kills half a dozen true citations first. Recorded as a test that asserts the
      limit, so it cannot be silently assumed covered.

      What resolution-only does buy, measured on the same 36:

      | reference shape | stripped |
      |---|---|
      | index `(fuente: [2])` | **0/6** — no legitimate citation lost |
      | prose (`carta y alérgenos`, `información del negocio`) | 9/9 |
      | internal filename (`carta-alergenos.md`, `proceso.md`) | 6/6 — the leak `publicSource` closes at source |
      | URL | 3/15 |

      Two parsing false positives were found by that measurement and fixed before shipping: a URL
      written as a markdown link (`(fuente: [web](https://…))`) had its capture cut at the first
      `)` and looked invented, and several URLs in one citation were read as one. Both are pinned.
      Caveat on the 3 URL strips: the replay re-retrieves with today's index, so it can only
      **over**-count. At runtime the chunks are the turn's own.
- [x] **T2.2** Mutation check, 4 mutants, all killed, source reverted with zero `MUTANT` markers:
      `citaResuelve` pinned to `true` kills 6 tests (every strip assertion); pinned to `false`
      kills 5 (every keep assertion); `every` → `some` kills exactly the mixed-reference test;
      `n >= 1` → `n >= 0` kills exactly the `[0]` test. The last two killing one test each is the
      point — they are surgical, so the rules they encode are each pinned by their own case.

## T3 — Availability is the tool's answer, not the agent's opinion (AC4, AC5)

Reshaped by T0. It was written as a prompt rule ("never state a capacity a tool did not
return"). The measurement says the rule is not the missing piece — the tool result is.
`computeAvailableSlots` already computes `freeResourceIds`, and `managed-db.ts:184` drops it
on the way to the model, so an hour served by two cabins and an hour served by one look
identical. The agent then spends 11:00 on the first person and staggers the second. It is not
inventing a capacity policy; it is reasoning correctly over a result that never told it how
many places the hour holds.

- [x] **T3.1** Publish the **cardinality** of each slot in `consultarDisponibilidad`, without
      publishing the inventory. `Slot` gains `plazasSimultaneas`, emitted only when it is
      greater than 1 — same convention as `maxComensales` in `listarServicios`, and it keeps
      the common single-resource case at zero extra tokens. Resource ids stay internal.
      Document the field in the `consultar_disponibilidad` tool description, so the model
      knows an instant can be booked more than once.
      Done: `agent-backend/types.ts` (`Slot.plazasSimultaneas`), `managed-db.ts`
      (`consultarDisponibilidad`), `agent/tools.ts` (tool description).
      Test: `managed-db-adapter.test.ts`, describe *"plazasSimultaneas — publica la
      cardinalidad, nunca el inventario"* — 4 cases: two free resources return
      `plazasSimultaneas: 2`; one free resource omits the key (checked on `Object.keys`, not
      `toEqual`, which accepts a key valued `undefined`); the legacy path with no declared
      inventory omits it too; and the serialised payload contains neither the resource ids nor
      `freeResourceIds`.
      Mutation-checked: emitting the field always (`plazas > 0`) kills 3 of the 4; pinning the
      cardinality to 1 kills the first. 29/29 green restored.
- [x] **T3.2** Regression on the engine behind that number: two appointments at the same
      `startTime` on distinct resources both persist, and the second is not refused.
      Already pinned by `booking-multirecurso.test.ts:278` (keeps the slot when one resource
      of two is taken), `:286` (withdraws it when all are taken) and
      `booking-cancelar-y-volver-a-reservar.test.ts:336` (the instant returns after a
      cancellation). Verified independently of the model by `scripts/diag-multirecurso.ts`.
- [x] **T3.3** (found while verifying T3.1, not planned) `GroupTooLargeError` ordered the agent
      to hand off — "NO intentes otras horas", "indicaselo al cliente con los datos de contacto".
      True for a party of 14 in a restaurant, false for `maxPartySize = 1`: two people do fit at
      the same hour, in two appointments. The message now branches, and for a single-place
      service it says to call `crear_reserva` once per person at the same hour and explicitly
      not to hand off.
      Test: `booking-multirecurso.test.ts` — "con maxPartySize 1 manda reservar una vez por
      persona, NO derivar a otro canal". The group-of-14 case still asserts the old text, so the
      two branches pin each other.

## T4 — Verification against production

- [x] **T4.1** Re-run H4, C5 and SEC5, n≥3 each, against the live agents.
      SEC5 closes **only** when the second appointment exists in `aa.cita` — a transcript
      saying "sure, both fit" is not evidence. That is exactly the mistake the parent runner
      made: four rows read as passes while proving nothing.
      **SEC5 done, 3/3**, counted in `aa.cita` before and after each repetition. The two fixes
      were measured separately and both were needed: with `plazasSimultaneas` alone it went
      0/3 → 1/3 (the agent said "hay hueco para dos a la vez" and then handed off to the phone,
      obeying the error message); with the branched `GroupTooLargeError` it went 1/3 → 3/3.
      Checked in the database: 0 rows with `partySize != 1`, distinct names, distinct cabins,
      and no live fixture left behind.

      **H4 and C5 re-run after T1/T2**, `scripts/run-t0-invenciones.ts gpt-4.1-nano 3`:
      - **C5 clean 3/3.** T0's nano baseline invented a first name; with T1.2's fact on the turn
        it stops. This is the row T1.2 was for, and it closes.
      - **H4 invents 3/3, unchanged.** *"La cocina cierra a las 15:45 de lunes a sábado, y en
        domingo a las 13:30 para el brunch y a las 16:00 para la carta."* T1.1 never fires: the
        question retrieves the reservation-schedule chunk, so retrieval is not empty. The
        citation half of the row does close — T2 strips the source — but the hour does not.
        Both deterministic ways to turn H4 into the empty case were measured and rank it above
        the healthy rows; the numbers are in T2.1 and in `validation.md#not-achieved-and-measured`.
        Not closed. It needs either the routing decision T0 raised (`gpt-5.4-mini`: 3/3 clean,
        code unchanged) or a support-judging second pass, which is the same cost decision.
      - SEC5 returned 0/3 in this same run, against the 3/3 recorded above. Out of T1/T2's
        scope — it is T3 territory and the row is documented as staggering on this model — but
        recorded here rather than left unsaid.
- [x] **T4.2** Re-run the AC6 rows (M1, M2, M4, SEC2, SEC6) and confirm the agent still answers
      the facts it does have. Caution must not cost knowledge.
      Done against the live agents on `gpt-4.1-nano`, blocks `mendieta`, `barberia` and
      `estetica` of `scripts/run-casuistry-matrix.ts`. All five still answer with the fact:
      M1 "11,00 €", M2 the three allergens (pescado, moluscos, sulfitos), M4 recommends a real
      dish instead of inventing a vegetarian menu, SEC2 "24 € … (fuente: [2])", SEC6 "60
      minutos". SEC4 still offers slots, so the booking path is not disturbed either.
- [x] **T4.3** `npx tsc --noEmit` clean, full vitest suite green: **177 files, 2135 tests, 0
      failures**. Five suite regressions appeared while wiring T1 and two of them were defects in
      this change, not stale tests — the `prefetchKnowledge` `[]` and the name aviso riding on
      every turn. Both are fixed above; the other three were legacy assertions inverted on
      purpose, each with its reason written in the test.

## Final verifications

- [x] **V1** Every AC has one green test, with AC1 and AC2 **narrowed to what was achieved** and
      the gap written down. AC1's empty-retrieval half, AC2's resolution half, AC3, AC4, AC5 and
      AC6 all have a green test. AC1's neighbouring-chunk half does not, and is not claimed.
- [x] **V2** AC6 rows re-run live (T4.2): M1, M2, M4, SEC2, SEC6 all still answer their fact, and
      SEC4 still offers slots. Caution cost no knowledge. Resolution-only strips 0/6 legitimate
      index citations in history, which is the same claim from the other side.
- [x] **V3** No inventory claim taken from a transcript: SEC5 counted in `aa.cita` before and
      after each repetition, and the `plazasSimultaneas` payload asserted not to leak resource
      ids. H4's failure is quoted from the reply itself, which is where that datum lives.

## Not closed by this change

- **H4 / the second half of AC1** — see T4.1. Blocked on the same cost decision T0.2 raised,
  now with two measurements showing no cheap deterministic substitute exists.
- **The second half of AC2** — a citation can still point at a chunk that does not support the
  sentence. `citation-support.ts` says so in its header and a test pins the limit so nobody
  mistakes the file for a support check.

## Out of scope, and why

- `comensales` not `required` in the booking tools → `aa-reservas-comensales-obligatorios`.
  It is what left row B7 unverifiable (the group of 8 was stored as `partySize = 1`).
- The six soft failures of the same matrix (B3, B4, B5, B6, B8, H3, SEC1). The answers are not
  wrong, only unhelpful. Different problem, lower stakes.
- **SEC3 no longer closes, and it is not this change's doing.** Found while running T4.2. The
  visitor says *"Soy Iker Salaverria, teléfono 622334455"* and the agent asks for the contact
  again; across four runs it failed four different ways, one of which was worse than failing:
  it booked with `910000002` — the **business's own phone** taken from its instructions — as the
  customer's contact, persisting a fake contact under the name "Usuario".
  Ruled out as a regression by an A/B with a single variable: with the new
  `consultar_disponibilidad` text removed and the day cleaned to the same state, `gpt-4.1-nano`
  fails identically. The archived verdict recorded SEC3 as verified (`BAR-CDMW`), which on this
  evidence was one lucky run of a non-deterministic small model rather than a stable pass.
  Same family as the phone-number defect already on record — three prompt rewrites lost to it,
  and it was only fixed by computing the datum outside the model. Needs its own change; the
  fake-contact half is the urgent part, because it writes bad data into a customer's database.
  Note: `BAR-CDMW` was cancelled to give the A/B a controlled starting state, so the fixture the
  archived verdict cites no longer exists.
