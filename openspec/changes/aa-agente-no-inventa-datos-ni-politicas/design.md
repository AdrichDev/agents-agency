# Design

## The rules already exist, and they already failed

Before proposing wording, it is worth reading what the agent was already told.

`back/src/lib/agent/engine.ts:576-578`, attached to every retrieved chunk:

> `Usa los fragmentos que sean relevantes y cita la fuente del que la traiga. Si ninguno`
> `responde a lo que pregunta el usuario, dilo con franqueza y no inventes.`

`back/src/lib/agent/engine.ts:331`:

> `NUNCA cites una fuente que no te haya sido entregada.`

Both instructions were live during the matrix run. H4 violated the first and slipped past the
second. **A fourth rewrite of "do not invent" is not the design.** This repo has already
learned that twice: the filename leak in `aa-widget-3a-en-su-propia-web` held until the first
direct question, and the contact notice in `aa-servicios-completos-y-enlaces-clicables` needed
three rewrites before the fix became a computed per-turn fact.

## Why H4 slipped past the citation rule

The rule forbids citing a source **that was not handed to the model**. In H4 the source *was*
handed over: `https://www.brasserielafayette.es/contacto/` is a real chunk source. What the
chunk does not contain is a kitchen closing time.

So the guarantee currently enforced is *"the URL exists"*. The guarantee actually needed is
*"the cited chunk supports this claim"*. That gap is not a wording problem — nothing in the
pipeline ever compares the answer against the chunk it cites.

## Three defects, three different mechanisms

| # | Defect | Where it can be fixed outside the model |
|---|---|---|
| H4 | Cites a real source for an unsupported claim | Post-hoc check: the sentence carrying `(fuente: X)` must overlap the chunk whose source is `X`. If it does not, strip the citation |
| C5 | Invents the customer's first name | The name is data. `buildContextFactsBlock` already injects known contact facts — **but each matrix row opens a fresh `conversationId`, so in C5 the agent had no name at all and produced one anyway.** The fix is to make "no name known" an explicit fact instead of an absence the model fills |
| SEC5 | Invents a capacity policy | The tool already knows the answer. The agent should never be the one deciding whether two bookings fit |

C5 deserves emphasis: this is not a memory failure. The agent had **no** name and invented one.
An absent field is not neutral — the model treats it as something to complete.

## Approach

### A. Absence as an explicit fact, not a hole

The pattern that has worked in this repo is computing the fact outside the model and handing it
over as a statement. Applied here: when a retrieval returns nothing relevant, or when the
contact name is unknown, the turn carries an explicit line saying so, rather than silently
omitting the block. Same shape as `buildContextFactsBlock`, opposite polarity.

Where: `buildKnowledgeBlock` and `buildContextFactsBlock`, `back/src/lib/agent/engine.ts`.
Both already return `null` on empty input and the caller simply drops the message — that `null`
is the hole to close.

### B. Citation stripped when unsupported

A deterministic post-processing step over the reply: for each `(fuente: X)`, require lexical
overlap between the sentence and the chunk whose `publicSource` is `X`. Below threshold, remove
the citation and leave the sentence.

This does not stop the model from being wrong. It stops it from being **credibly** wrong, which
is the part that actually harms the visitor. Deliberately conservative: removing a citation is
reversible and cheap; suppressing an answer is not.

### C. Availability answers come only from the tool

The booking tools already return the free resources. What is missing is a statement that the
agent has no authority over concurrency. This is the one place where a prompt rule is the right
instrument — but it is a *narrow, testable* rule ("never state a capacity or concurrency limit
that a tool did not return"), not another "do not invent", and it is validated by counting
appointments in the database, never by reading the transcript.

### D. Measure the model before redesigning the prompt

`gpt-4.1-nano` is a small model being asked to follow a long instruction set. Before investing
in wording, run H4, C5 and SEC5 unchanged on a larger model. If they pass, the finding is about
routing and default model choice, and the prompt work shrinks accordingly. This is the cheapest
experiment available and it goes first.

## Test strategy

Unit tests cover the deterministic parts (A, B) — they are pure functions over chunks and
strings, which is why the work is pushed there in the first place. C is covered end-to-end,
because a rule about model behaviour cannot be unit-tested honestly.

The matrix is the regression net. Rows are re-run n≥3 (a single green turn proves nothing —
see the parent change's verdict) and **every claim about inventory is checked against
`aa.cita`**, not against what the bot said. The parent runner already produced four rows that
read as passes while proving nothing; that failure mode is the one to design against.
