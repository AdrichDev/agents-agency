# Validation

## User story

As a visitor who asks the 3A bot whether they build CRMs and landing pages, I want a yes with
the detail — and a clickable link to the privacy policy before I hand over my phone number —
so that the conversation ends in a proposal instead of in a "no" the business did not mean.

And, as the agency: one lead row per conversation, with everything the visitor typed in it.

## Acceptance criteria

- **AC1** — The landing's six cards name agents for WhatsApp and Telegram, custom CRMs, and
  full websites and landing pages.
- **AC2** — The bot's knowledge base states the same six services, in the same words.
- **AC3** — Asked for the legal pages, the bot gives the three direct URLs.
- **AC4** — A link in a bot reply is clickable in all three channels: an anchor in the widget
  and in Telegram, `label: url` in WhatsApp.
- **AC5** — In the widget every link opens in a new tab and carries `rel="noopener"`.
- **AC6** — Only `http` and `https` become links. Any other scheme stays literal text.
- **AC7** — Reloading the page keeps the conversation: same `conversationId`, same visible
  transcript, no repeated greeting.
- **AC8** — A conversation produces exactly one `Lead` row, merging what arrives across turns.
- **AC9** — A lead captured through a conversation is stored with `consent: true`, decided by
  the server and not by the model.

## Scenarios and tests

### T1 — A markdown link becomes an anchor (AC4)

**Given** a reply containing `[Política de privacidad](https://3aestudio.vercel.app/privacidad)`
**When** it is rendered for the widget and for Telegram
**Then** both produce an `<a href="https://3aestudio.vercel.app/privacidad">` whose text is
the label, and WhatsApp produces `Política de privacidad: https://…`

→ `back/tests/channel-links.test.ts`

### T2 — A hostile URL never becomes an anchor (AC6)

**Given** a reply containing `[Pulsa aquí](javascript:alert(1))`
**When** it is rendered for any of the three channels
**Then** no anchor is produced and the text stays literal

→ `back/tests/channel-links.test.ts`

### T3 — A hostile label cannot inject markup (AC4)

**Given** a link whose label is `<img src=x onerror=1>`
**When** it is rendered for the widget and for Telegram
**Then** the markup appears escaped inside the anchor text, not as an element

→ `back/tests/channel-links.test.ts`

### T4 — Every widget link opens elsewhere (AC5)

**Given** any anchor produced by `renderText`
**When** its attributes are read
**Then** `target="_blank"` and `rel` contains `noopener`

→ `back/tests/channel-links.test.ts`

### T5 — The transcript survives a reload (AC7)

**Given** a `sessionStorage` holding a conversation for this `publicKey`
**When** `widget.js` runs
**Then** the messages are repainted, `conversationId` is the stored one, and no greeting is
added

→ `back/tests/widget-js-sesion.test.ts`

### T6 — A storage that refuses does not break the chat (AC7)

**Given** a `sessionStorage` whose `setItem` throws
**When** a message is sent
**Then** the chat works; only the memory is lost

→ `back/tests/widget-js-sesion.test.ts`

### T7 — Two calls, one lead (AC8)

**Given** `guardar_lead` called with an email, then with a name and a phone, same
`conversationId`
**When** the rows for that agent are read
**Then** there is one, carrying all three

→ `back/tests/lead-upsert.test.ts`

### T8 — `calificar_lead` does not create a second row (AC8)

**Given** a lead already saved for a conversation
**When** `calificar_lead` runs on the same conversation
**Then** that row is updated and no `"Visitante"` row appears

→ `back/tests/lead-upsert.test.ts`

### T9 — Consent is the server's (AC9)

**Given** contact data arriving with a `conversationId`
**When** the lead is written
**Then** `consent` is `true`; without a `conversationId` it is `false`

→ `back/tests/lead-upsert.test.ts`

### T10 — The landing lists the three new services (AC1)

**Given** the deployed landing
**When** the service cards are read
**Then** CRM, websites/landing pages, and WhatsApp + Telegram agents are all named

→ `front/tests/site-widget.spec.ts`

## V1 — The bot, against production

Anonymous `POST /api/chat` after deploy and re-seed. Passes when the agent answers *yes* to
"¿me podríais hacer un CRM y una landing page?" and hands over the three legal URLs when asked
for the privacy policy.

**PASSED** — 2026-07-30, back at commit `047dc41`, knowledge re-seeded (3 chunks).

> *¿vosotros solo hacéis chatbots o también desarrolláis webs y CRM?*
> "En 3A Estudio no solo hacemos chatbots, también desarrollamos webs completas y CRM a
> medida, según lo que necesites."
>
> *¿Me pasas el enlace de la política de privacidad?*
> "Claro, aquí tienes el enlace a la política de privacidad:
> `[Política de privacidad](https://3aestudio.vercel.app/privacidad)`."

The link comes back in the exact form the three renderers know how to paint.

## V2 — The widget, in a real browser

Passes on `https://3aestudio.vercel.app/` when a legal link in a reply opens in a **new** tab,
and when reloading the page leaves the conversation exactly as it was.

**COVERED BY TEST** — `front/tests/site-widget.spec.ts`, two cases in a real Chromium: a
bot-rendered link carries `target="_blank"` and `rel` with `noopener`, and after
`page.reload()` the transcript is still there without the panel being reopened. The greeting
is deliberately not persisted: it carries the agent name, which arrives with the back's
config, and storing it would freeze the cold-start "Asistente" default.

## V3 — One row

The defect this change exists for. Passes when one production conversation that hands over
name, email and phone across separate turns leaves exactly one `aa.Lead` row, complete, with
`consent: true`.

Nothing else closes this: the three fragmented rows were produced in production, by the real
model, over several turns. A unit test proves the upsert merges; only a real conversation
proves the model's calls land on one key.

**PARTIAL, then closed by F.2** — 2026-07-30, conversation `cms80jwt900071cgil1pnfxvz`. Name,
email and phone across four turns left **one** row (`cms80k06u000e1cgifl50vjfc`), `consent:
true`, name and email correct — and `phone: null`. The merge worked; the model called
`guardar_lead` when the email arrived and never called it again for the phone.

That gap is what `lead-contact.ts` closes (design §F.2).

**PASSED** — re-run after deploying `4ed5ecd`, conversation `cms80vmxq00001ccfx96a6pdc`. Name,
email and phone across four turns, **one** row (`cms80vpfi00041ccfduu0i05m`):

```
customerName "Rubén Delgado" | email ruben.delgado@dentalarco.es | phone "655 78 12 34"
consent true | qualification unknown
```

Worth stating plainly: this time the model *did* call `guardar_lead` for the phone — the
stored value keeps the spaces the visitor typed, and the backstop normalises to `655781234`.
So the run proves the merge end to end; the backstop stayed a net, covered by
`back/tests/lead-contact.test.ts` rather than by this conversation. The two writers disagreeing
on phone formatting is noted and left alone: nothing downstream parses the field today.

## V4 — The turn where the visitor hands over the data

What this covers: T8.1–T8.6. The transcript review turned up a bot that offered *to give* the
visitor a contact instead of asking for theirs, and — found while fixing that — two adjacent
defects: a bare mobile number treated as noise, and a real name overwritten by the generic
label `"Cliente"`.

Four runs against production, agent `cms7uyve40001i8fx75c8ab26`, two scripts in which the name,
the email and the phone each arrive on a line of their own.

**Runs 1–3 (`e7cebe2`, `acdcf90`, `ced96eb`) — PARTIAL.** The inversion was gone from the first
run on: the bot asks for the visitor's name and channel and no longer offers its own instead.
The name defect fell in run 3, and in code, not in prose: `esNombreGenerico` in
`managed-db.ts` refuses to overwrite a stored name with `Cliente`/`Visitante`/`Usuario`/…
The phone survived all three, with three different wordings of the same directive:

```
> 600 45 12 90
< ¿Podrías aclarar qué quieres decir con esos números? No parecen estar relacionados
  con nuestros servicios.
```

The value did reach the database every time — the deterministic backstop caught it — so the
row was right and the conversation was wrong. Three rewrites, three failures at the same turn:
enough evidence that a general rule in the prompt does not bind.

**Run 4 (`e4f5bbe`) — PASSED.** The rule became a fact about the turn. `avisoContactoEnMensaje`
runs the same extractor that writes to the database and, only when the message carries a
contact the lead does not have yet, injects one system line right above the user message.

Script A (`cms82sj9x000k1c5sbkstrdt4`), the inverted question plus three separate lines:

```
> no me vas a pedir mis datos para algun contacto?
< Sí, para enviarte más información o una propuesta a medida, ¿me puedes decir tu nombre y
  un canal de contacto (email o teléfono)?
> 600 45 12 90
< ¡Perfecto, Marta! Gracias por facilitar tu teléfono.
```

One row (`cms82sn6b000u1c5sjq9nx86r`): `Marta Ibáñez` |
`marta.ibanez.test@tallerlospinos.es` | `600451290` | `consent: true`.

Script B (`cms82spih00131c5senn54115`), phone before email, one row
(`cms82suxb001d1c5s8sfm4koz`): `Luis Arriaga` | `luis.arriaga.test@tallerlospinos.es` |
`611223344` | `consent: true`. The name is the one the visitor typed, not `Cliente`.

Still open, seen in script B and not fixed here: asked for a proposal, the bot first pointed at
the contact form on the website ("solo tienes que dejar tus datos en la sección de contacto")
instead of asking there and then. It recovered on the next turn and the lead came out complete,
so it costs a turn, not a lead.

Note on the tests: nulling the `avisoContactoEnMensaje` call site in `chatWithAgent` passed the
entire suite. The function was covered and its wiring was not — the same shape of gap that let
the three prompt rewrites look done. Two cases in `chat-mode-and-latency.test.ts` now kill that
mutation.
