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

*(pending)*

## V2 — The widget, in a real browser

Passes on `https://3aestudio.vercel.app/` when a legal link in a reply opens in a **new** tab,
and when reloading the page leaves the conversation exactly as it was.

*(pending)*

## V3 — One row

The defect this change exists for. Passes when one production conversation that hands over
name, email and phone across separate turns leaves exactly one `aa.Lead` row, complete, with
`consent: true`.

Nothing else closes this: the three fragmented rows were produced in production, by the real
model, over several turns. A unit test proves the upsert merges; only a real conversation
proves the model's calls land on one key.

*(pending)*
