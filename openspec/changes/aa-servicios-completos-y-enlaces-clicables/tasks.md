# Tasks

## A. The landing sells what the business does

- [x] **T1.1** `front/app/page.tsx`, `SERVICES`: the six cards remapped as in `proposal.md`.
      Same object shape, new `art`/`glow` pairs for the two new cards.
- [x] **T1.2** `MARQUEE_ITEMS` and the `STEPS` copy reviewed for the same gap — a marquee
      that still lists only bots contradicts the cards below it.

## B. The bot knows it too

- [x] **T2.1** `fixtures/3a-estudio/servicios.md` rewritten from the new cards. Same six
      services, same words, no prices.
- [x] **T2.2** `fixtures/3a-estudio/identidad-y-contacto.md` gains the three legal URLs:
      `https://3aestudio.vercel.app/aviso-legal`, `/privacidad`, `/cookies`, with an
      instruction to hand them over as links whenever they are asked for.
- [ ] **T2.3** Re-seed production: `seed-3a-agent.ts --knowledge`. Record the chunk count.

## C. Links, in the three channels

- [x] **T3.1** `back/src/lib/channels/links.ts`: `parseLinks(text)`, `[label](url)` and bare
      `http(s)` URLs, every other scheme left as text.
- [x] **T3.2** `toTelegramHtml` emits `<a href="…">`, URL escaped into the attribute.
- [x] **T3.3** `toWhatsAppText` emits `label: url` — WhatsApp has no anchor syntax and
      linkifies bare URLs itself.
- [x] **T3.4** `back/public/widget.js` `renderText`: escape first, then anchors with
      `target="_blank" rel="noopener noreferrer"`.
- [x] **T3.5** `back/tests/channel-links.test.ts` — the grammar and the three renderers,
      including `javascript:` rejected and a label carrying `<script>`.

## D. The session lives as long as the tab

- [x] **T4.1** `widget.js`: `conversationId` + transcript in `sessionStorage`, keyed by
      `publicKey`, capped at 100 messages, every access in `try/catch`.
- [x] **T4.2** On load, a stored transcript is repainted and the greeting is skipped.
- [x] **T4.3** `back/tests/widget-js-sesion.test.ts` — restore, cap, and a storage that
      throws on write must not break the chat.

## E. Consent

- [x] **T5.1** `consentimiento` out of the `guardar_lead` schema in `tools.ts`.
- [x] **T5.2** `managed-db.guardarLead` writes `consent: true` when a `conversationId` is
      present; `false` without one.

## F. One lead per conversation

- [x] **T6.1** `AgentBackendAdapter.guardarLead` takes `conversationId?: string | null`
      (`types.ts`); `external-api.ts` accepts and ignores it.
- [x] **T6.2** `withBackendAdapter` in `executor.ts` passes the `conversationId` it already
      receives.
- [x] **T6.3** `managed-db.guardarLead`: `upsert` on `conversationId`, merging — a field
      that does not arrive is not written; `"Visitante"` never overwrites a real name.
- [x] **T6.4** `back/tests/managed-db-adapter.test.ts`, describe "guardarLead — fusion por
      conversationId" — two calls in one conversation leave one merged row, a missing field
      is not written, `"Visitante"` does not overwrite, consent as in E. Written next to the
      adapter's other cases instead of in a new `lead-upsert.test.ts`: same prisma mock.

## G. Verification

- [x] **T7.1** `npx tsc --noEmit` clean in `back` and `front`; full back suite green.
- [x] **T7.2** `front/tests/site-widget.spec.ts`: the three new services on the landing, and
      a link rendered by the bot carries `target="_blank"` with `noopener`.
- [ ] **T7.3** Deploy, then against production: ask the agent whether it builds CRMs and
      landing pages, and ask for the privacy policy. Recorded in `validation.md` (V1).
- [ ] **T7.4** In a real browser on `3aestudio.vercel.app`: the link opens in a new tab, and
      a reload keeps the conversation. Recorded in `validation.md` (V2).
- [ ] **T7.5** One conversation that hands over name, email and phone in separate turns
      leaves exactly **one** `Lead` row, complete, `consent: true`. Recorded as V3 — this is
      the defect the change exists for, and only production data closes it.
