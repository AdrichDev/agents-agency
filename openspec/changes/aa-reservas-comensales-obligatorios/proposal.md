# A table for two is stored as a table for one

## What happened

While verifying `aa-reservas-fecha-y-zona-del-modelo` against production, a real booking was
made through the Lafayette bot: dinner for two on 8 August. The conversation is explicit —
the visitor asked for a table for two and the bot confirmed a table for two. The row says
otherwise:

```
id                cms7ug9qd00081bej4vr7ekt8
codigo            LAF-4DQW
comensales        1
```

The model never sent `comensales`. It is not lying to the user; it simply omits a field the
schema tells it it may omit, and the executor fills in the default.

## Why the schema allows it

`back/src/lib/agent/tools.ts` declares `comensales` as a `number` in both booking tools and
in neither `required` list:

- `consultar_disponibilidad` → `required: ["servicio", "desde", "hasta"]`
- `crear_reserva` → `required: ["servicio", "startIso", "endIso", "nombre"]`

Both descriptions do ask for it in prose ("pregunta cuántas serán ANTES de llamarla y pásalo
en `comensales`"). Prose in a tool description is a suggestion; `required` is the only part
of the schema a provider enforces. Same lesson as the citation leak in
`aa-widget-3a-en-su-propia-web`: what the model is asked to do holds until it doesn't.

## Scope

- Make `comensales` required in both tools, and say in the description what to send when the
  service is individual (1) so the model has no reason to omit it.
- Decide what the executor does with a missing value. Today `normalisePartySize` defaults it,
  which is exactly what hid the defect. A booking that arrives without a party size for a
  service that books by party size should fail loudly, not be silently rounded down to one.
- The restaurant is the case that hurts (a table for two given a table for one), but the
  field is shared: check what a party size of 1 means for the barbershop and the beauty
  centre before making it mandatory everywhere.

## Risks

- `required` on a tool the model already calls means an in-flight conversation can get a
  provider-side validation error. Check how `executeTool` surfaces a rejected call.
- Existing rows keep `comensales = 1`. This change does not backfill them, and there is no
  way to know from the data which ones were really parties of one.

## Not in scope

The booking timezone work, already closed and verified in
`aa-reservas-fecha-y-zona-del-modelo`.

## Status

Proposal only. `design.md`, `tasks.md` and `validation.md` are written when the change is
picked up — the open question above (what a party size means outside the restaurant) is what
the design has to answer, and guessing it now would be inventing a decision nobody made.
