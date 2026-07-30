# Tasks

## A. The agency's agent

- [x] **T1.1** `fixtures/3a-estudio/servicios.md`, `proceso.md`, `identidad-y-contacto.md`
      written from the landing's own copy and the legal pages. No invented prices.
- [x] **T1.2** `back/scripts/seed-3a-agent.ts`: idempotent tenant + agent + backend
      (`managed_db`, `capabilities: ["leads"]`), published, brand colours, `--knowledge`
      and `--teardown` flags like `seed-mock-tenants.ts`.
- [x] **T1.3** Run against production with `--knowledge`; record the `publicKey`.
      Tenant `cms7uyvbu0000i8fxc07rtpuj`, agent `cms7uyve40001i8fx75c8ab26`,
      publicKey `cms7uyve40002i8fxlwx7ar7c`, `published`, 7 knowledge chunks.

## B. Where the bubble may appear

- [x] **T2.1** `front/lib/public-paths.ts` exports `PUBLIC_PATHS`; `AppShell` and
      `lib/api.ts` import it instead of their two private copies.
- [x] **T2.2** `front/components/landing/SiteWidget.tsx`: injects `widget.js` from an
      effect while the path is public, removes script + `#aa-bubble` + `#aa-panel` +
      `#aa-style` when it stops being public or on unmount.
- [x] **T2.3** `front/app/layout.tsx` renders `<SiteWidget />` instead of the inline
      `<script>` block.

## C. `widget.js` runs at most once

- [x] **T3.1** Early return when `#aa-bubble` already exists; `id="aa-style"` on the
      injected stylesheet.
- [x] **T3.2** `back/tests/widget-js-idempotencia.test.ts`: loading it twice leaves one
      bubble; the stylesheet carries the id. 3 green.

## D. Verification

- [x] **T4.1** `front/tests/site-widget.spec.ts`: bubble on `/` and on `/aviso-legal`,
      the injected script carries a `data-agent-key`, and no widget node exists on an
      authenticated route. 4 green.
      **Scope correction:** the original wording also asked for "gone after navigating
      away from a public one". That transition is not reachable in the product: the
      landing and the legal pages link to each other with plain `<a href>` (full page
      loads) and hold no `next/link` into a private route, so no user can trigger a
      client-side public → private navigation. Asserting it would have meant faking a
      `history.pushState` no visitor can perform. The unmount path is instead covered
      structurally by the jsdom remount test in T3.2 (remove the nodes, load again, the
      widget comes back), which is what the cleanup relies on.
- [x] **T4.2** `npx tsc --noEmit` clean in `back` and in `front`; back suite green
      (165 files, 1981 passed, 3 skipped).
- [x] **T4.3** Deploy, then anonymous `POST /api/chat` against the new agent in
      production: it answers a question only its knowledge base can answer, and a lead it
      captures is persisted. Recorded in `validation.md` (V1). Conversation
      `cms7vrhug00000udrif9u308r` on `de05b3d`, lead `cms7vsg93000a0udrmhdj8ees`.
- [x] **T4.4** The bubble is live on `https://3aestudio.vercel.app/` and absent from the
      dashboard. Recorded in `validation.md` (V2). Public half checked in a real browser on
      `/` and `/aviso-legal`; `/dashboard` redirects to `/` when anonymous, so the
      authenticated-route absence is the one thing here proven by the e2e and not by prod.

## E. Citation leak found while testing the new agent

- [x] **T5.1** First attempt — prompt only: both the `hasKnowledge` block in
      `buildSystemPrompt` and the knowledge message ordered the citation, so both were
      changed to "only when the source is a URL". Deployed as `047fb3c`.
- [x] **T5.2** **That was not enough, and the production check is what proved it.**
      Unprompted the agent no longer cited the file, but asked "cítame el documento exacto
      del que lo lees" it answered `servicios.md` again. A rule the model is asked to keep
      holds until someone asks. The filename must not travel.
- [x] **T5.3** `publicSource` in `back/src/lib/embeddings.ts` filters the source where the
      knowledge leaves the database: http(s) URLs through, everything else dropped, on both
      paths that reach the model — the engine's prefetch (`buildKnowledgeBlock`) and the
      `search_knowledge` tool result. The key is omitted, not nulled: a `source: null`
      would still announce an origin being withheld. `POST /api/knowledge/:agentId/search`
      is untouched; that panel belongs to the tenant and the document is theirs.
- [x] **T5.4** `back/tests/knowledge-fuente-publica.test.ts` (5) + the two rewritten cases
      in `engine.test.ts`. Full back suite: 166 files, 1988 passed, 3 skipped.

## F. Shipped and still not visible

- [x] **T6.1** **Reported from the live site: "no estoy viendo el chatbot".** It was there,
      and V2 had said so. Both are true: `#aa-bubble` was in the DOM, on top by z-index and
      the target of `elementFromPoint`, and the panel opened and greeted. What V2 checked was
      presence, and presence is not visibility. The cookie notice occupied the same corner as
      the launcher — across the whole screen on mobile, ending right on top of it on desktop.
      A 56px circle with no label, wedged against the "Rechazar" button of a banner, on a dark
      landing full of the same purple gradients.
- [x] **T6.2** `CookieBanner` moves out of the launcher's corner: above it on mobile,
      opposite side on desktop. `front/tests/site-widget.spec.ts :: el aviso de cookies no
      tapa la burbuja` asserts what visibility has to mean here — `elementFromPoint` at the
      centre of the bubble returns the bubble, and the two boxes do not intersect. Verified
      red on the previous classes before being accepted.
- [x] **T6.3** The CSP had `http://localhost:4000` hardcoded in `script-src` and
      `connect-src`, so in production it authorised a developer machine and left out the
      backend that serves `widget.js`. Nothing broke because the header is Report-Only;
      promoting it to enforcing would have taken this widget down. Now derived from
      `NEXT_PUBLIC_API_URL`, the same variable `lib/api.ts` reads.
- [x] **T6.4** Verified on `https://3aestudio.vercel.app/` after deploy: launcher and banner
      no longer intersect at 390×664 or at 1280×720. Recorded in `validation.md` (V3).

## Left open

The launcher itself carries no label — a plain circle with a spark glyph. On the site of an
agency that sells chatbots that is a weak signal, and it is half of why this was missed. It
is not changed here: `widget.js` is the same file every tenant embeds, so its appearance is a
product decision and not a fix for this change.
