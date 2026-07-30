# Validation

## User story

As a visitor on `3aestudio.vercel.app` at eleven at night, I want to ask what the agency
does and leave my phone number in the chat, so that I do not have to fill in a form and
wait for office hours — and so that the agency sees for itself the product it sells.

## Acceptance criteria

- **AC1** — A published `3A Estudio` agent exists, `channel: widget`, capability `leads`,
  with a knowledge base taken from the landing's own copy.
- **AC2** — The widget bubble is present on the four public paths and on no other route.
- **AC3** — Loading `widget.js` twice leaves exactly one bubble.
- **AC4** — Leaving a public path removes the bubble, the panel, the stylesheet and the
  script from the document.
- **AC5** — The agent answers from its knowledge base and never quotes a price, since the
  site publishes none.

## Scenarios and tests

### T1 — One bubble, not two (AC3)

**Given** a document where `widget.js` has already run
**When** it is evaluated a second time
**Then** there is exactly one `#aa-bubble`

→ `back/tests/widget-js-idempotencia.test.ts` :: `cargarlo dos veces deja una sola burbuja`

### T2 — The stylesheet is identifiable (AC4)

**Given** a document where `widget.js` has run
**When** the injected `<style>` is looked up
**Then** it carries `id="aa-style"`, so cleanup can find it

→ `back/tests/widget-js-idempotencia.test.ts` :: `la hoja de estilo lleva id para poder retirarla`

### T3 — Public pages carry the bubble (AC2)

**Given** an anonymous visitor
**When** they open `/` and `/aviso-legal`
**Then** `#aa-bubble` is visible on both

→ `front/tests/site-widget.spec.ts` :: `la burbuja aparece en la landing y en las paginas legales`

### T4 — Authenticated screens do not (AC2)

**Given** a session
**When** the dashboard is opened
**Then** no `#aa-bubble` exists

→ `front/tests/site-widget.spec.ts` :: `no aparece en una ruta autenticada`

### T5 — Navigating away cleans up (AC4)

**Given** the bubble mounted on `/`
**When** the visitor navigates client-side to a non-public path
**Then** `#aa-bubble`, `#aa-panel` and `#aa-style` are all gone

→ `front/tests/site-widget.spec.ts` :: `al salir de una ruta publica se retira todo`

## V1 — The agent, against production

Anonymous `POST /api/chat` against the new agent after deploy. Passes when it answers a
question only its knowledge base can answer (the four-step delivery process, the legal
identity) and captures a lead.

**Result:** _pending_

## V2 — The bubble, on the real site

Passes when the bubble is visible on `https://3aestudio.vercel.app/` and absent from an
authenticated route of the same deployment.

**Result:** _pending_
