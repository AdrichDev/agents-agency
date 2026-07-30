# Design

## A. Six cards, rewritten

`front/app/page.tsx`, the `SERVICES` array. Data only — the rendering below it (flip cards,
gradients, `art`/`glow`) is untouched, so each new entry keeps the same shape and just needs
its own gradient pair.

The merge is the only structural move: `Agentes IA por sector` and `WhatsApp y Telegram`
described the same product from two angles, and `Integraciones 1-clic` becomes a sentence
inside `Automatizaciones`. That frees two slots for `CRM a medida` and `Webs completas y
landing pages`.

## B. Knowledge, from the same list

`openspec/changes/aa-widget-3a-en-su-propia-web/fixtures/3a-estudio/servicios.md` is rewritten
from the new cards, and re-seeded with `seed-3a-agent.ts --knowledge`.

`identidad-y-contacto.md` gains the three legal URLs. It currently says *"El sitio publica
tres páginas legales"* without giving any, which is precisely what the bot repeated back.

**Two hazards in that file, left as they are and flagged instead of silently changed:** it
carries a NIF and a home address, and the contact details are a personal Gmail and mobile.
The bot will hand any of it to any visitor who asks. That is a business decision about what
the agency publishes, not a bug to fix inside this change.

## C. Links

### C.1 Shared parsing, one place

New `back/src/lib/channels/links.ts`:

```
parseLinks(text) -> Array<{ kind: "text", value } | { kind: "link", label, url }>
```

Recognises `[label](url)` and bare `http(s)://…`, and accepts **only** `http` and `https`.
Anything else stays literal text — a `javascript:` URL that reached the knowledge base must
not become an anchor. Each channel renders that list its own way, so the grammar cannot drift
between them.

### C.2 Per channel

- **Telegram** (`toTelegramHtml`, `parse_mode: "HTML"`) → `<a href="…">label</a>`. The URL is
  HTML-escaped inside the attribute.
- **WhatsApp** (`toWhatsAppText`) → WhatsApp has no anchor syntax; it linkifies bare URLs
  itself. `[label](url)` becomes `label: url`, and a bare URL is left alone. Today the
  visitor reads the raw brackets.
- **Widget** (`widget.js`, `renderText`) → `<a href="…" target="_blank"
  rel="noopener noreferrer">`. `widget.js` is plain ES5 served to third-party sites and
  cannot import from `src/`, so it carries its own small copy of the same grammar — the one
  place duplication is accepted, and both are covered by tests.

`rel="noopener noreferrer"` is not optional: without `noopener`, the opened page gets a live
`window.opener` handle to the client's site.

Order matters in `renderText`: escape HTML **first**, then build anchors, so a link's own
label can never inject markup.

## D. The tab is the session

`widget.js`, `sessionStorage` under `aa-chat:<publicKey>`:

```
{ conversationId, messages: [{ text, cls }] }
```

Keyed by `publicKey` so two agents on one site do not share a transcript. `sessionStorage`
and not `localStorage` because the requirement is "while the tab is open" — `localStorage`
would resurrect a stranger's conversation on a shared computer days later.

Restored on load: if a transcript exists it is repainted and the greeting is skipped. Writes
are wrapped in `try/catch` — Safari in private mode throws on write, and a chat that cannot
remember must still be a chat that works.

Capped at 100 messages, oldest dropped. An unbounded transcript in a 5 MB store is a bug
waiting for a long conversation.

## E. Consent, decided server-side

`consentimiento` leaves the tool schema. The model no longer reports it, because it was never
the model's to know.

`managed-db.guardarLead` sets `consent: true` when the contact data arrives with a
`conversationId` — the visitor typed it into a chat that asked for it and stated why. Without
a conversation (an API caller) it stays `false`.

## F. One lead per conversation

`AgentBackendAdapter.guardarLead` takes a third argument, `conversationId?: string | null`.
`withBackendAdapter` already receives it and simply was not passing it through.

`managed-db` switches from `create` to `upsert({ where: { conversationId } })`.
`Lead.conversationId` is already `@unique`, so no migration — and nullable-unique is exactly
how the null rows piled up.

The update must **merge, not overwrite**: the first call carried an email, the second a name
and a phone. Only fields that arrive are written, so a later call cannot blank an earlier one.

`customerName` is the exception, because a later value is usually the better one — the model
sent `"achozas9"` (from the email) before it sent `"Adrian"`. The rule: a name that arrives
replaces the stored one, unless it is the `"Visitante"` placeholder, which never overwrites a
real name.

Without a `conversationId` the behaviour is unchanged — a create, as today.

`external-api` ignores the new argument: the external CRM owns its own deduplication and we
do not get to decide its keys.

## Test strategy

- `back/tests/channel-links.test.ts` — the grammar: markdown links, bare URLs, `javascript:`
  rejected, label-injected markup escaped, each of the three renderers.
- `back/tests/lead-upsert.test.ts` — two `guardar_lead` calls in one conversation leave one
  row with all the data merged; `calificar_lead` afterwards updates that row instead of
  creating `"Visitante"`; consent true from a conversation, false without one.
- `back/tests/widget-js-sesion.test.ts` — jsdom, extending the existing widget harness:
  the transcript is restored from `sessionStorage`, a write failure does not break the chat,
  the cap holds.
- `front/tests/site-widget.spec.ts` — the six cards render the three new services; a legal
  link from the bot carries `target="_blank"` and `rel` with `noopener`.
