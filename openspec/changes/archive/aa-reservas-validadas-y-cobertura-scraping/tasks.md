# Tasks

Critical order: T1 before T2 (T2's tests depend on the tx-client signature). T4/T5
independent of T1-T3.

## A. Booking validation

- [x] **T1.1** `computeAvailableSlots` accepts an optional read client as its last
      parameter (`PrismaReadClient`, structural — a `tx` is not a `PrismaClient`); all
      internal reads go through it. Existing call sites untouched.
- [x] **T1.2** `createAppointment` validates the slot inside the `Serializable` transaction:
      exact match on `startTime`/`endTime` against `computeAvailableSlots(serviceId, {desde: slotStart, hasta: slotEnd}, tx)`.
      Mismatch ⇒ `SlotUnavailableError`.
- [x] **T1.3** `tests/booking-appointments.test.ts` :: `rechaza un slot fuera del horario (AC1)` (AC1).
- [x] **T1.4** `tests/booking-appointments.test.ts` :: `rechaza un slot ya reservado (AC2)` (AC2).
- [x] **T1.5** `tests/booking-appointments.test.ts` :: `crea franja + cita en transaccion y devuelve el resultado mapeado` (AC3).
- [x] **T1.6** (added) `rechaza un slot desalineado con la rejilla aunque caiga en horario (AC1)` —
      exact-match, not containment.
- [x] **T1.7** (added) `valida leyendo por el tx, no por el cliente global (AC1)` — the
      availability read must be inside the Serializable transaction.

## B. Contact channel

- [x] **T2.1** `tools.ts`: `crear_reserva` requires `nombre`; description states that
      `email` or `telefono` is mandatory.
- [x] **T2.2** `executor.ts`: `assertContactChannel` rejects when both `email` and
      `telefono` are empty, with an actionable message.
- [x] **T2.3** `tests/agent-backend-tools.test.ts` :: `crear_reserva exige un canal de contacto ANTES de tocar el adapter (AC4)` (AC4),
      plus `crear_reserva acepta solo teléfono (AC4)` and `crear_reserva no acepta contacto en blanco (AC4)`.

## C. Scraper coverage

- [x] **T3.1** `fetchSitemapUrls(origin)`: fetch `sitemap.xml` / `sitemap_index.xml`,
      parse `<loc>`, same-origin filter. Network failure ⇒ empty array, never throws.
- [x] **T3.2** `discoverLinks` collects every same-origin link (cap applied after ranking,
      not during collection) and returns anchor text alongside the URL (`PageCandidate`).
- [x] **T3.3** `rankCandidateUrls(landing, candidates)`: pure, tiered keyword scoring
      (ES + EN), landing first, DOM order as tie-break.
- [x] **T3.4** `discoverPages` = sitemap ∪ links, ranked, capped at `MAX_PAGES = 25`;
      `ingestWebsite` and `web-import.ts` both consume it.
- [x] **T3.5** `tests/scraper-page-ranking.test.ts` :: `prioriza páginas de políticas sobre catálogo (AC5)` (AC5).
- [x] **T3.6** `tests/scraper-page-ranking.test.ts` :: `usa sitemap.xml cuando existe (AC6)` (AC6).
- [x] **T3.7** `tests/scraper-page-ranking.test.ts` :: `respeta el tope y conserva la URL raíz primera (AC7)` (AC7).
- [x] **T3.8** (added, found by T3.9) `scoreCandidate` decodes `URL.pathname` before
      matching: it is percent-encoded, so `/envíos` read as `/env%C3%ADos` and no accented
      keyword ever matched.
- [x] **T3.9** (added) `ignora acentos al comparar (AC5)` — the test that exposed T3.8.
      Its first version passed for the wrong reason (a second, unaccented keyword in the
      same URL) and was rewritten so the accent is the only signal.

## D. Blockers found while verifying V3/V4 (not in the original plan)

V4 measured 0/5 with every task in A-C already green. The end-to-end run exposed three
defects that no unit test could have caught, because the fixtures had been written against
the implementation instead of against the data the product actually persists.

- [x] **T4.1** `getScheduleForDay` looked the day up as `date.toFormat("EEEE")` (`"monday"`)
      while `AgentSchedule.schedule` stores three-letter keys (`{ mon: "09:00-18:00" }`).
      No key ever matched ⇒ `computeAvailableSlots` returned **zero slots for every agent**,
      so booking through the correct path was impossible. Now indexed by
      `date.weekday % 7`, accepting the short and long forms, case/space tolerant. Indexing
      by number also removes the dependency on luxon's locale.
- [x] **T4.2** `computeAvailableSlots` subtracted the booked slots by comparing ISO
      **strings**: luxon emits `...T09:00:00.000+02:00` and `Date.toISOString()` emits
      `...T07:00:00.000Z`. Same instant, never equal as text ⇒ taken slots were still being
      offered. Compared by `getTime()` now.
- [x] **T4.3** Same string-vs-instant bug in the T1.2 guard, in the opposite direction: it
      rejected **every** booking as `SlotUnavailableError`. Compared by `getTime()` now.
- [x] **T4.4** `generateSlots` offered slots already in the past (the sweep starts at
      `startOf("day")`, so a 23:20 query returned "today at 09:00"). Filter `slotStart >= tz`.
- [x] **T4.5** New `listar_servicios` tool (`tools.ts` + `executor.ts` +
      `AgentBackendAdapter.listarServicios`, implemented in `managed-db.ts`; the
      `external_api` backend throws `ExternalApiNotSupportedError` — the CRM exposes no
      service-catalog endpoint, so no contract was invented). `ServiceNotFoundError` now
      carries the list of valid names so the model retries instead of abandoning.
- [x] **T4.6** `tests/booking-slots.test.ts` (new, 7 tests): short keys — the regression for
      T4.1 —, long keys, case/space tolerance, day with no schedule, split break `|`, past
      slots, blocked days.
- [x] **T4.7** `tests/booking-appointments.test.ts`: fixtures moved from `{ monday: … }` to
      the real `{ mon: … }`, plus two offset-vs-UTC tests for T4.2/T4.3.

## Final verification

- [x] **V1** `npx tsc --noEmit` clean in `back/`.
- [x] **V2** Full `back` vitest suite green — 161 files, 1900 passed, 3 skipped.
- [x] **V3** Re-indexed a real Shopify store. Discovery went from 0 to 144 sitemap URLs and
      25 clean pages including the policies. Retrieval answers literally: "Entrega en 4-5
      días laborables" at cosine distance 0.3007 and "cambiar o devolver … 15 días de su
      recepción" at 0.4104 — both well inside `MAX_DISTANCE` 0.85.
- [x] **V4** 6-turn booking conversation, n=5, live provider, agent
      `cms6h857f0000n8fxi8ygsjuo` (gpt-5.4-mini): **0/5 → 5/5**. All five appointments land
      inside the schedule, on the grid, at distinct times, and every one carries a contact
      email — unlike the pre-existing pair with `email=NULL` and `phone=NULL`.
