# Validation

## User story

As a **visitor talking to a tenant's agent**, I need the agent to tell me when it does not
know something, so that I do not act on a closing time, a name, or a booking rule that nobody
at the business ever stated.

As the **tenant**, I need the agent to never invent a restriction, so that it does not turn
away a booking my inventory could have taken.

## Acceptance criteria

- **AC1** — Asked about a fact **for which retrieval returns nothing**, the agent says it does
  not have it and offers the direct contact channel. It does not answer with an adjacent fact.
  **Narrowed on evidence** (see *Not achieved* below): the original wording said "not in the
  knowledge base", which is a different set. Retrieval returning a neighbouring chunk is the
  common case and the one H4 falls into, and no deterministic signal distinguishes it.
- **AC2** — The agent never attaches a source citation whose reference does not resolve to a
  chunk that was delivered to it in that turn. If nothing was delivered under that reference,
  the citation is stripped and the sentence stays.
  **Narrowed on evidence**: the original also demanded the cited chunk *support* the statement.
  That half is measured and not achieved — no cheap deterministic check separates a supported
  claim from an invented one, and every proxy tried ranks the known invention **above** the
  honest answer.
- **AC3** — The agent never addresses the customer by a name that was not given in the
  conversation.
- **AC4** — The agent never states a capacity, concurrency or party-size rule that the booking
  tool did not return. When the tool reports availability, the agent reports availability.
- **AC5** — Two customers can book the same service at the same hour when two resources serve
  that service. The agent offers it; the second appointment is created.
- **AC6** — The 18 matrix rows that pass today still pass. Caution must not cost knowledge.

## Scenarios

### GWT1 — unpublished fact (AC1, AC2) — **FAILS on `gpt-4.1-nano`, 3/3**
**Given** the Lafayette agent, whose knowledge base contains `HORARIO DE RESERVAS Lunes a
Sábado: de 13:30 a 15:45 y de 20:00 a 22:45` and no kitchen closing time,
**when** the visitor asks *"¿A qué hora cierra la cocina?"*,
**then** the reply does not contain a kitchen closing hour, does not present the booking window
as one, and carries no source link for a claim the chunks do not make.

Measured after T1/T2 against the live agent, n=3: still invents 3/3, e.g. *"La cocina cierra a
las 15:45 de lunes a sábado, y en domingo a las 13:30 para el brunch y a las 16:00 para la
carta."* The half about the source link does hold — the citation is stripped. The half about
the hour does not. `gpt-5.4-mini` passes this row 3/3 unchanged, which is what T0 measured and
what the routing decision set aside.

### GWT1b — retrieval genuinely empty (AC1) — passes
**Given** any agent asked about something no chunk is close to,
**when** retrieval returns zero fragments,
**then** the turn now carries the explicit fact that the search happened and found nothing, and
the agent says it does not have the datum and hands off to the direct contact instead of
answering with a neighbour. This is the part of AC1 that ships.

### GWT2 — invented name (AC3)
**Given** a conversation where the customer said *"Nombre Julia Arriaga"*,
**when** the agent addresses her by name in any later turn,
**then** the name used is `Julia`, and no other first name appears in the reply.

### GWT3 — invented policy (AC4, AC5)
**Given** Estética Aurea with `Cabina 1` and `Cabina 2` both serving Manicura (1-1) and both
free at 11:00,
**when** the visitor asks for two manicures at 11:00 on the same day,
**then** the agent offers both, and after confirmation **two** appointments exist at that hour
on distinct resources — checked in the database, not in the transcript.

### GWT4 — knowledge not lost (AC6)
**Given** the same four agents,
**when** the matrix rows M1, M2, M4, SEC2 and SEC6 are re-run,
**then** each still returns its documented fact (11,00 €; the three allergens; menestra and
risotto; 24 € / 45 min; 60 min).

## One test per task

| Task | Test |
|---|---|
| T1.1 empty retrieval is stated, not silent | `agent-sin-dato.test.ts` — `buildKnowledgeBlock([])` returns the absence fact, not `null`; plus the two inverted legacy tests in `engine.test.ts` that pinned the old silence, and the pre-existing failure test that pins `prefetchKnowledge` returning `null` on a crashed search |
| T1.2 unknown name is stated | `agent-sin-dato.test.ts` — with contact data and no name, the block says the name does not exist and forbids inventing it; with a known name the text is byte-identical to before; with no contact data at all the block stays `null` |
| T2.1 citation must resolve | `agent-citas-respaldadas.test.ts`, 19 cases — prose, internal filename and `[0]` references are stripped; `[n]` and delivered URLs are kept; all references in one citation must resolve; markdown-wrapped and comma-separated URLs parse correctly |
| T2.2 the rule is pinned | 4 mutants over `citation-support.ts`, 4 killed, source reverted |
| T3.1 availability cardinality comes from the tool | `managed-db-adapter.test.ts` — two free resources return `plazasSimultaneas: 2`, one omits the key, and the payload leaks no resource id; 3 mutants killed |
| T3.2 two concurrent bookings | `booking-multirecurso.test.ts:278/:286` and `booking-cancelar-y-volver-a-reservar.test.ts:336` — two appointments at the same `startTime` on distinct resources both persist |
| T3.3 single-place service does not hand off | `booking-multirecurso.test.ts` — with `maxPartySize: 1` the error tells the agent to book once per person; the group-of-14 case still asserts the handoff text, so the branches pin each other |
| T4.1 matrix re-run | `run-t0-invenciones.ts` rows H4, C5, SEC5 n≥3 each, plus the AC6 rows via `run-casuistry-matrix.ts`, verdict recorded per row against the database |

## Not achieved, and measured

**GWT1's hour is still invented on `gpt-4.1-nano`.** T1.1 only fires when retrieval is empty,
and H4 is not that case: *"¿A qué hora cierra la cocina?"* retrieves the reservation-schedule
chunk and the model serves it as the answer. Two deterministic ways out were measured and both
rank the broken case **above** the healthy ones:

- **By lexical overlap** (would have been T2.1's original design, over the 36 cited replies in
  history): the H4 invention scores **0.78** — it repeats almost every word of the chunk and
  changes one — and the honest *"no tengo confirmado a qué hora cierra la cocina"* scores
  **0.33**. Any threshold that strips the invention strips half a dozen true citations first.
- **By retrieval distance** (`scripts/diag-distancia-h4.ts`): H4 retrieves at **d=0.5552**;
  M1 — an AC6 row that answers correctly today — retrieves at **d=0.5757**, and M2 at 0.5385.
  Tightening the cut kills the working rows before the broken one.

So the remaining half of AC1, on this model, is a model-capability gap, not a missing guard.
The two options that remain are routing this row's agents to a larger model (T0's measurement:
3/3 clean, unchanged code) or a second retrieval pass that judges support — which is another
model call, i.e. the same cost decision by a different route. Left open on purpose rather than
closed with a threshold whose own measurement says it does the wrong thing.

## Gate

Row SEC5 is closed only when the **second appointment exists in `aa.cita`**. A transcript in
which the agent says "sure, both fit" is not evidence — that is precisely the mistake the
parent change's runner made.
