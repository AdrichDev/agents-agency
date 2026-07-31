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

- [ ] **T1.1** `buildKnowledgeBlock` currently returns `null` when retrieval is empty and the
      caller drops the message. Emit an explicit "nothing relevant was retrieved for this
      question" fact instead, with the handoff channel.
      Test: `agent-sin-dato.test.ts` — given chunks that do not contain the asked fact, the
      composed messages contain the absence statement and the reply carries no number lifted
      from an adjacent chunk.
- [ ] **T1.2** Same for the contact block: when no name is known, say so explicitly rather than
      omitting `buildContextFactsBlock`.
      Test: same file — a turn with no known name renders the "name unknown" fact; a turn with
      a known name renders it unchanged (no regression on T4.1 of the tokens change).

## T2 — A citation must be supported (AC2)

- [ ] **T2.1** Post-processing over the reply: for each `(fuente: X)`, require lexical overlap
      between the carrying sentence and the chunk whose `publicSource` is `X`. Below threshold,
      strip the citation and keep the sentence.
      Test: `agent-citas-respaldadas.test.ts` — the H4 case verbatim (claim "la cocina cierra a
      las 15:45" against the real chunk `HORARIO DE RESERVAS … 13:30 a 15:45 …`) loses its
      citation; a supported claim keeps it.
- [ ] **T2.2** Mutation check: raising the threshold to always-pass must kill T2.1's first
      assertion, and lowering it to always-strip must kill the second. A threshold no test
      pins is a decoration.

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

## T4 — Verification against production

- [ ] **T4.1** Re-run H4, C5 and SEC5, n≥3 each, against the live agents.
      SEC5 closes **only** when the second appointment exists in `aa.cita` — a transcript
      saying "sure, both fit" is not evidence. That is exactly the mistake the parent runner
      made: four rows read as passes while proving nothing.
- [ ] **T4.2** Re-run the AC6 rows (M1, M2, M4, SEC2, SEC6) and confirm the agent still answers
      the facts it does have. Caution must not cost knowledge.
- [ ] **T4.3** `npx tsc --noEmit` clean, full vitest suite green.

## Final verifications

- [ ] **V1** Every AC in `validation.md` has one green test.
- [ ] **V2** The 18 matrix rows that pass today still pass.
- [ ] **V3** No claim about inventory recorded from a transcript alone — every one checked
      against the database.

## Out of scope, and why

- `comensales` not `required` in the booking tools → `aa-reservas-comensales-obligatorios`.
  It is what left row B7 unverifiable (the group of 8 was stored as `partySize = 1`).
- The six soft failures of the same matrix (B3, B4, B5, B6, B8, H3, SEC1). The answers are not
  wrong, only unhelpful. Different problem, lower stakes.
