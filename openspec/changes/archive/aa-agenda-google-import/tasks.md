# Tasks: aa-agenda-google-import

- [x] 1. Backend lib: `listEventsRange(token, timeMinIso, timeMaxIso)` in
  `src/lib/integrations/calendar.ts` (range variant of `listEvents`).
- [x] 2. Backend route `src/routes/calendar.ts` mounted at `/api/calendar`:
  - `GET /status` → platform-wide `findFirst({ provider: "google" })` → `{ connected, accountLabel }`.
  - `GET /events?from&to` → `getValidToken(integration.agentId, "google")` → normalized events;
    409 if not connected; 502 if Google fails.
- [x] 3. Backend: `GET /api/oauth/:provider/url` — `agentId` optional; resolve server-side
  (existing integration's agent → else first agent → else 409).
- [x] 4. Tests: T1 + T2 green (vitest).
- [x] 5. Front `/agenda`: replace agents[0]/status hack with `/api/calendar/status`;
  sync button calls `/api/oauth/google/url` without agentId.
- [x] 6. Front `/agenda`: fetch `/api/calendar/events` for the visible range and render
  Google events (distinguished) in month/week/day views. `tsc --noEmit` clean.
- [x] 7. Manual smoke: events from achozas9@gmail.com visible in `/agenda`.
