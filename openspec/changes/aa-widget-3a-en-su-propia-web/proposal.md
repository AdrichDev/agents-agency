# Proposal — 3A Estudio runs its own agent on its own landing

## Intent

Put the widget on `3aestudio.vercel.app`: the agency that sells AI agents should be
answering its own visitors with one, capturing them as leads instead of relying only on
the static form at the bottom of the page.

## Why now

The landing sells "Widget web a tu marca — instalas una línea de código y tu web atiende
24/7" and then does not run one. The wiring is already there: `front/app/layout.tsx`
renders `back/public/widget.js` when `NEXT_PUBLIC_WIDGET_AGENT_KEY` is set. What is
missing is an agent to point it at, and a decision about *where* the bubble may appear.

Two facts checked before writing this:

- There is **no `3A Estudio` tenant** in production. The 19 tenants are all clients or
  mocks; the only published non-mock agent, `AiAs`, belongs to a different business
  ("la web de AS"), so it cannot be reused.
- Cross-origin delivery works today. `GET /widget.js` answers 200 with
  `Cross-Origin-Resource-Policy: cross-origin`, and the `POST /api/chat` preflight
  reflects an arbitrary origin. (`GET /widget.js` *with* an `Origin` header answers 403,
  which is irrelevant: a classic `<script src>` sends no `Origin`.)

## Scope

**S1 — The agent.** A `3A Estudio` tenant and a published widget agent, seeded by a
script the same way the sector mocks are, with the `leads` capability and a knowledge base
written from the landing's own copy and the legal pages. It answers what the agency does,
how it works, and takes name + contact.

**S2 — Where the bubble appears.** Today the snippet sits in `RootLayout`, so enabling it
would also drop a sales bot into the operator dashboard, the client portal and the invoice
screens. It is mounted on the public pages only — the same four paths that already render
without the app chrome.

**S3 — Injecting it twice must not produce two bubbles.** `widget.js` appends its bubble,
panel and stylesheet unconditionally. Mounting it from a client component that survives
navigation, and letting a customer paste the snippet twice, both produce duplicates today.

## Out of scope

- Restyling the widget. It takes the agency's brand colours and nothing else changes.
- The `LeadForm` at the bottom of the landing. Both paths write the same `Lead`; removing
  the form is a product decision, not part of this.

## Risks

- **A published agent is billable surface.** The tenant is created with an explicit
  `tokenBalance` and no plan or Stripe ids, exactly like the mocks, so metering resolves
  (it is fail-closed) and no invoice can be produced.
- **The bubble on a page it should not be on.** Guarded by the public-path list, which
  becomes a single exported constant instead of the two copies that exist today
  (`AppShell.CLEAN_PATHS` and `api.ts:PUBLIC_PATHS`) — a third copy is how they drift.
- **The public key is not a secret** (it ships in the HTML of every client site, and
  `NEXT_PUBLIC_*` is inlined into the bundle regardless), so it is defaulted in code with
  the env var kept as an override. Otherwise shipping this would depend on a Vercel
  dashboard edit that cannot be made from here.

## Dependencies

`seed-mock-tenants.ts` for the seeding pattern; `runTrackedIngest` / `chunkText` /
`saveChunkWithDuplicatePolicy` for the knowledge base.
