# Design

## D1 — The agent

Seeded by `back/scripts/seed-3a-agent.ts`, idempotent, same shape as
`seed-mock-tenants.ts` (find by name, update or create) so a re-run never duplicates the
tenant, the agent or its knowledge.

| Field | Value | Why |
|---|---|---|
| tenant | `3A Estudio`, sector `tecnologia` | The agency as a tenant of its own platform |
| `tokenBalance` | 10,000,000 | Metering is fail-closed; an unresolved quota is a dead agent |
| plan / Stripe ids | none | Nothing to invoice the agency for |
| agent name | `3A Estudio` | Shown in the widget header |
| `channel` | `widget` | |
| `status` | `published` | A draft answers 403 to the public widget |
| `capabilities` | `["leads"]` | No `reservas`: the agency takes no bookings |
| colours | `#6366f1` / `#d946ef` | The landing's `--accent-1` / `--accent-2` |
| model | inherited default | Not pinned here; the platform default is the platform's decision |

`AgentDataBackend.mode = "managed_db"`, so a captured lead lands in the agency's own CRM
rather than in an external API.

**Knowledge comes from fixtures, not from scraping the site.** The landing is a
`"use client"` React page: fetching `https://3aestudio.vercel.app/` returns the shell, not
the copy. The three markdown files under `fixtures/3a-estudio/` are written from the same
source the page renders (`SERVICES`, `STEPS`, the hero, the legal identity block), so the
agent quotes the site instead of paraphrasing a scrape of it.

The system prompt forbids inventing prices. The landing publishes none, and an agent that
improvises a figure for its own agency is worse than one that says "te lo pasamos por
escrito".

## D2 — Where the bubble may appear

`front/lib/public-paths.ts` exports the one list:

```ts
export const PUBLIC_PATHS = ["/", "/privacidad", "/aviso-legal", "/cookies"];
```

`AppShell` (which had it as `CLEAN_PATHS`) and `lib/api.ts` (which had its own copy) both
import it. Two copies were already one too many; this change would have added a third.

`front/components/landing/SiteWidget.tsx` is a client component rendered from
`RootLayout`. It reads `usePathname()` and injects the script only while the path is
public, removing it — and the DOM the script created — on the way out.

**Injection is done from an effect with `document.createElement`, not by rendering a
`<script>` tag.** `widget.js` reads `document.currentScript` on its first line to find its
own `data-agent-key` and to derive the API base from `script.src`. An element the browser
inserts and executes sets `currentScript`; going through React's own script handling would
mean betting on that. The effect is one call and leaves no doubt.

Cleanup removes `#aa-bubble`, `#aa-panel`, `#aa-style` and the script element itself.
Without it, walking from `/` to `/dashboard` leaves a sales bubble floating over the
operator's screens.

## D3 — `widget.js` runs at most once

Two guards, both cheap:

- First statement: `if (document.getElementById("aa-bubble")) return;`. A customer who
  pastes the snippet into both the header and the footer of their page gets one bubble.
- The injected `<style>` gets `id="aa-style"`, so it is removable by id. It had none, and
  a stylesheet that cannot be found cannot be cleaned up.

Neither changes what a correctly installed widget does.

## D4 — The public key

```ts
const AGENT_KEY = process.env.NEXT_PUBLIC_WIDGET_AGENT_KEY ?? AGENCY_AGENT_KEY;
```

`NEXT_PUBLIC_*` is inlined into the client bundle at build time, and the key is already
public by construction — it is what identifies the agent in every client's HTML. An env
var therefore buys no secrecy here, only per-environment override, which is why it stays
as the override and not as the requirement: making the constant the default is what lets
this ship without an edit in the Vercel dashboard.

## Files

| File | Change |
|---|---|
| `openspec/changes/.../fixtures/3a-estudio/*.md` | new — knowledge base |
| `back/scripts/seed-3a-agent.ts` | new — tenant + agent + knowledge |
| `back/public/widget.js` | idempotence guard, `id="aa-style"` |
| `front/lib/public-paths.ts` | new — single `PUBLIC_PATHS` |
| `front/components/AppShell.tsx` | imports it instead of `CLEAN_PATHS` |
| `front/lib/api.ts` | imports it instead of its own copy |
| `front/components/landing/SiteWidget.tsx` | new — path-scoped injection |
| `front/app/layout.tsx` | renders `SiteWidget` instead of the inline `<script>` |

## Test strategy

- `back/tests/widget-js-idempotencia.test.ts` — jsdom, loads `widget.js` twice, asserts one
  bubble; asserts the style carries `id="aa-style"`.
- `front/tests/site-widget.test.tsx` — the script is injected on `/`, absent on
  `/dashboard`, and the DOM is cleaned when the path stops being public.
- The agent itself is verified against production: an anonymous `POST /api/chat` that
  answers a question only the knowledge base can answer, and a lead persisted in `aa.lead`.
