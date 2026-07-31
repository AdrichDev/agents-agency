# The agent invents data it does not have, and policies the business does not have

## What happened

The casuistry matrix of `aa-reservas-multirecurso-y-mocks-sectoriales` ran 31 conversations
against four live agents (`gpt-4.1-nano`, all `published`). Eighteen rows passed. Three did
something worse than fail: the agent produced confident, well-formed answers that were not
true. Full verdict in
`openspec/changes/aa-reservas-multirecurso-y-mocks-sectoriales/casuistry-verdict.md`.

### 1. Invents an unpublished fact — and cites a source for it

Row `H4`, Brasserie Lafayette:

> 👤 ¿A qué hora cierra la cocina?
> 🤖 La cocina de Brasserie Lafayette cierra a las 15:45 entre lunes y sábado, y a las 13:30
> los domingos para brunch. […] (fuente: [web](https://www.brasserielafayette.es/contacto/))

The kitchen closing time is **not published anywhere**. The agent's whole knowledge base (78
chunks, 59.566 chars) contains exactly one thing resembling it:

```
HORARIO DE RESERVAS
Lunes a Sábado: de 13:30 a 15:45 y de 20:00 a 22:45
```

That is the *booking* window. The model relabelled it as *kitchen closing* and attached a
source link. The citation is the aggravating part: it converts a guess into something the
visitor has no reason to doubt, and it points at a real page that does not say it.

### 2. Invents the customer's name

Row `C5`, Casa Mendieta. The customer introduced herself as **Julia Arriaga** two turns
earlier. The agent replied:

> 🤖 Gracias, **Juan**. No tengo reservas activas con ese teléfono.

### 3. Invents a business policy, and loses a booking with it

Row `SEC5`, Estética Aurea:

> 👤 Somos dos amigas y queremos manicura las dos el jueves a las 11:00.
> 🤖 Lo siento, pero solo se permite una cita por persona y en este centro no se hacen
> reservas para dos a la vez.

The real inventory: `Cabina 1` and `Cabina 2` both serve Manicura (capacity 1-1). Two 11:00
appointments fit. Nothing anywhere states the rule the agent just announced. This is the worst
of the three — it is a refused sale, justified by a rule the business does not have, and it
contradicts the very capability multi-resource booking was built to deliver.

## Why these three belong together

They are one failure mode with three faces: **the model fills a gap instead of admitting it**.
A missing fact becomes an adjacent fact (H4), a missing name becomes a plausible name (C5), a
missing rule becomes a plausible rule (SEC5). Fixing them one prompt line at a time is exactly
what has already failed twice in this repo — see the filename leak in
`aa-widget-3a-en-su-propia-web` and the contact-notice rule in
`aa-servicios-completos-y-enlaces-clicables`, where three prompt rewrites failed at the same
turn and the fix was to compute the fact outside the model.

## Scope

- **Absence must be answerable.** The agent needs a sanctioned way to say "that is not
  something I have" and hand off, instead of reaching for the nearest number.
- **A citation must not be attachable to an unsupported claim.** Today the source link is
  decoration the model adds at will.
- **Never address the customer by a name that was not given in the conversation.** The name is
  known data — it should not be left to the model to remember.
- **Availability is decided by the tool, not by the agent's idea of what a business allows.**
  Capacity, concurrency and party rules come from the resource inventory. The agent may report
  what the tool returned; it may not invent a constraint the tool never expressed.

## Out of scope

- `comensales` not being `required` in the booking tools — that is
  `aa-reservas-comensales-obligatorios`.
- The six soft failures in the same matrix (B3, B4, B5, B6, B8, H3, SEC1): the answers are not
  wrong, only unhelpful. Separate concern, lower stakes.

## Risks

| Risk | Mitigation |
|---|---|
| Making the agent more cautious turns it evasive and it stops answering things it does know | The matrix is the regression net: 18 rows currently pass and must keep passing, including M1/M2/M4/SEC2/SEC6, which are all "answer the fact you do have" |
| Prompt-only fixes look green on one run and regress on the next | Judged against the same matrix rows, re-run n≥3 per row. A rule that survives one turn is not evidence — that is the lesson already recorded in this repo |
| `gpt-4.1-nano` may simply be too small for the instruction-following this needs | Measure before redesigning: if the same rows pass on a larger model with the same prompt, the finding is about routing, not about wording |
