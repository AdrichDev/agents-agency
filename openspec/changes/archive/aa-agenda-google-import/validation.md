# Validation: aa-agenda-google-import

## User story

As the owner of 3A Estudio (single-tenant AA), I want the agenda to show my personal
Google Calendar (achozas9@gmail.com) events next to AA appointments, with the calendar
connection treated as mine — not as belonging to some arbitrary agent.

## Acceptance criteria

- AC-1: `GET /api/calendar/status` returns `{ connected: true, accountLabel }` when any
  `Integration` row with `provider = "google"` exists, regardless of its `agentId`.
- AC-2: `GET /api/calendar/events?from&to` returns normalized events
  `{ id, title, start, end, allDay }` from the primary Google calendar within the range.
- AC-3: If no Google integration exists, `/api/calendar/events` returns 409 (not 500),
  and `/agenda` still renders AA appointments (graceful degradation).
- AC-4: `/agenda` no longer calls `/api/agents` to pick `agents[0]` for calendar purposes.
- AC-5: Google events render visually distinguished from AA appointments.

## Scenario (Given-When-Then)

**Given** a Google integration exists (attached to any agent row) with a valid token,
**When** the owner opens `/agenda` on a month containing Google events,
**Then** the header shows "Calendar sincronizado" and the Google events appear in the
grid alongside AA appointments, marked as coming from Google.

## Test per task

- T1 (calendar route): vitest — status/events endpoints against mocked prisma + fetch:
  connected/disconnected status, event normalization, 409 without integration.
- T2 (oauth url fallback): vitest — `/api/oauth/google/url` without `agentId` resolves
  the existing integration's agent.
- T3 (front): `npx tsc --noEmit` clean + manual smoke (events visible in `/agenda`).
