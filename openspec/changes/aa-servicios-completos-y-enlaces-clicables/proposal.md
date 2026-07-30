# The agency's own bot was turning business away

## What happened

A real conversation with the 3A agent on the live site, 38 messages:

> **"¿Pero vosotros me podríais crear un CRM o una landing page?"**
> — *"No creamos un CRM propio, pero sí automatizamos la captación…"*

Said twice. 3A Estudio builds CRMs — OperaOS is one. That was the most commercial question
in the whole conversation and the bot argued against the sale.

The bot is not hallucinating. Its knowledge base is three files and the words "CRM",
"landing", "web" and "desarrollo" appear in none of them. It was seeded from the landing's
own copy, and **the landing does not sell those services either**. The bot is an accurate
mirror of a site that undersells the business.

Four other defects surfaced in the same transcript.

## Scope

### A. The site sells what the business does

The six service cards never mention CRMs, websites or landing pages. They stay six — the
request is explicit — so the two that overlap are merged to make room:

| # | Now | After |
|---|---|---|
| 1 | Agentes IA por sector | **Agentes IA para WhatsApp y Telegram** |
| 2 | Widget web a tu marca | Widget web a tu marca |
| 3 | Automatizaciones 24/7 | **Automatizaciones e integraciones** |
| 4 | Integraciones 1-clic | **CRM a medida** |
| 5 | WhatsApp y Telegram | **Webs completas y landing pages** |
| 6 | Leads y presupuestos | Leads y presupuestos |

Cards 1 and 5 said the same thing twice (an agent, and the channels it runs on), so they
become one and free a slot. Integrations stop being a card of their own and fold into
automations, which is where a client actually meets them. Nothing is dropped from the copy;
what was a card is now a line inside another.

### B. The bot knows it

The knowledge base gains the three services. Rewritten from the new cards, so the site and
the bot cannot drift apart — that drift is what caused this.

### C. Legal links, clickable, in every channel

Asked for the privacy policy the bot offered a link three times, never gave one, and ended
with *"no tengo un enlace directo específico"*. The pages exist (`/aviso-legal`,
`/privacidad`, `/cookies`); its knowledge only had the site root.

Two halves, and both are needed:

1. **The data** — the three URLs in the knowledge base.
2. **The rendering** — `[texto](url)` reaches the visitor as literal markdown today. No
   channel converts it: `format.ts` handles bold and italics and nothing else, and
   `widget.js` escapes HTML and converts `**bold**` only. This is fixed for **all three
   channels and therefore for every tenant**, not just for 3A.

In the widget every link opens in a new tab — `target="_blank"`, and `rel="noopener
noreferrer"` with it, which is not decoration: a `target="_blank"` without `noopener` hands
the opened page a handle on `window.opener`. Telegram and WhatsApp open links outside the
conversation on their own.

### D. The conversation survives a reload

`conversationId` lives in a `var`. Reload the page and the visitor starts over, with an
agent that greets them as a stranger and asks their name again. It moves to
`sessionStorage`, along with the transcript: alive while the tab is, gone when it closes.

### E. Consent

Six lead rows, `consent: false` in all six, while the bot's own answer said *"con
consentimiento RGPD"*. The field is optional in the tool schema and the model never sends
it.

**Decision (the client's, recorded here):** a visitor who types their email into the chat
after being asked for it, to receive a proposal, is consenting. Consent stops being
something the model decides and is recorded server-side when the contact data arrives
through a conversation.

*Noted once and moving on: GDPR asks for informed consent, and what makes this defensible is
that the bot states the purpose ("para prepararte una propuesta") before asking. If the
purpose ever widens — a newsletter, profiling, handing data to a third party — this stops
covering it.*

### F. One lead per conversation

The same transcript produced **three rows**, none complete:

```
achozas9   achozas9@hotmail.com   phone null    conversationId null
Adrian     email null             635984010     conversationId null
Visitante  email null             phone null    conversationId set
```

`"achozas9"` is the local part of the email taken as a name.

Two paths write to `Lead` with different keys:

- `guardar_lead` → `managed-db.ts:256` → `prisma.lead.create`, always a create, and it never
  passes `conversationId`.
- `calificar_lead` → `executor.ts:370` → `prisma.lead.upsert({ where: { conversationId } })`,
  which finds nothing (the rows above have a null one) and creates the `"Visitante"` row.

The comment on that upsert reads *"Coherente con el path guardar_lead/handoff: upsert por
conversationId"*. It is not. That coherence does not exist in the code.

What stops a second call today is prose in the tool description: *"Úsala una sola vez por
conversación"*. Third time this pattern bites in a week — `comensales`, the source citation,
now this. Prose does not bind; the key does.

## Risks

- **A/B drift again.** The cards and the knowledge base are written twice by hand. This
  change rewrites both from the same list but does not make it structural, so nothing stops
  the next copy edit from reopening the gap.
- **Existing lead rows stay fragmented.** No backfill: there is no way to tell from the data
  which fragments belonged together.
- **Merging on `conversationId` needs a unique index.** Check whether `Lead.conversationId`
  already carries one — `calificar_lead` upserts on it, so it should, but a nullable unique
  column allows many nulls, which is exactly how these rows accumulated.
- **Link rendering is a new sink for model output into HTML.** Only `http(s)` schemes, and
  the URL escaped into the attribute. A `javascript:` URL from a poisoned knowledge base is
  the thing to keep out.

## Not in scope

- The launcher still has no label. Noted in `aa-widget-3a-en-su-propia-web`; it is a product
  decision about a file every tenant embeds.
- No bridge from an AA lead into the CRM. There is none today, and building one is its own
  change — this one makes the lead correct and complete first.
- `comensales` in the booking tools, tracked in `aa-reservas-comensales-obligatorios`.
