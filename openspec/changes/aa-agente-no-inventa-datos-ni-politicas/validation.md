# Validation

## User story

As a **visitor talking to a tenant's agent**, I need the agent to tell me when it does not
know something, so that I do not act on a closing time, a name, or a booking rule that nobody
at the business ever stated.

As the **tenant**, I need the agent to never invent a restriction, so that it does not turn
away a booking my inventory could have taken.

## Acceptance criteria

- **AC1** — Asked about a fact that is not in the agent's knowledge base, the agent says it
  does not have it and offers the direct contact channel. It does not answer with an adjacent
  fact.
- **AC2** — The agent never attaches a source citation to a statement that is not supported by
  the cited chunk. If there is no supporting chunk, there is no citation.
- **AC3** — The agent never addresses the customer by a name that was not given in the
  conversation.
- **AC4** — The agent never states a capacity, concurrency or party-size rule that the booking
  tool did not return. When the tool reports availability, the agent reports availability.
- **AC5** — Two customers can book the same service at the same hour when two resources serve
  that service. The agent offers it; the second appointment is created.
- **AC6** — The 18 matrix rows that pass today still pass. Caution must not cost knowledge.

## Scenarios

### GWT1 — unpublished fact (AC1, AC2)
**Given** the Lafayette agent, whose knowledge base contains `HORARIO DE RESERVAS Lunes a
Sábado: de 13:30 a 15:45 y de 20:00 a 22:45` and no kitchen closing time,
**when** the visitor asks *"¿A qué hora cierra la cocina?"*,
**then** the reply does not contain a kitchen closing hour, does not present the booking window
as one, and carries no source link for a claim the chunks do not make.

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
| T1.1 refusal path for absent facts | `agent-sin-dato.test.ts` — given chunks without the asked fact, the composed answer contains the handoff and no number from an adjacent chunk |
| T1.2 citation gated on support | `agent-citas-respaldadas.test.ts` — a reply whose claim has no matching chunk is emitted without a source link |
| T2.1 customer name supplied as data | `agent-nombre-cliente.test.ts` — the name reaches the turn as a computed field, and a turn with no known name renders no greeting-by-name |
| T3.1 availability rules come from the tool | `agent-sin-politica-inventada.test.ts` — given a tool result with two free resources, the composed reply offers both |
| T3.2 two concurrent bookings | extend `booking-multirecurso.test.ts` — two appointments at the same `startTime` on distinct resources both persist |
| T4.1 matrix re-run | `run-casuistry-matrix.ts` rows H4, C5, SEC5 n≥3 each, plus the AC6 rows, verdict recorded per row against the database |

## Gate

Row SEC5 is closed only when the **second appointment exists in `aa.cita`**. A transcript in
which the agent says "sure, both fit" is not evidence — that is precisely the mistake the
parent change's runner made.
