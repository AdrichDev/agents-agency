# Proposal: aa-agenda-google-import

## Intent

The Google Calendar integration in AA must behave as a **platform-level** (single-tenant)
integration, not an agent-level one, and the `/agenda` page must **display the events of
the owner's Google Calendar** (achozas9@gmail.com) alongside AA appointments.

Context: the "Sincronizar Calendar" button shipped under `aa-centro-mando-agenda-telegram`
task 4.5 linked the OAuth token to `agents[0]` (an arbitrary agent, "Jorjortas barber"),
which contradicts the explicit requirement: AA is single-tenant and only ever syncs with
the owner's Google account. The read direction (Google → agenda view) was missing entirely.

## Scope

In scope:
- Backend: resolve "the Google integration" platform-wide (`findFirst({ provider: "google" })`),
  regardless of which agent row it is attached to. No schema migration.
- Backend: `GET /api/calendar/status` — connection state + account label, no agentId required.
- Backend: `GET /api/calendar/events?from&to` — list primary-calendar events in a date range
  using the stored token (with the existing `getValidToken` refresh layer).
- Backend: `GET /api/oauth/:provider/url` accepts a missing `agentId` and resolves it
  server-side (existing integration's agent, else first agent) — single-tenant shortcut.
- Front `/agenda`: drop the `agents[0]` lookup; use `/api/calendar/status`; render Google
  events in month/week/day views alongside AA appointments, visually distinguished.

Out of scope:
- Schema migration to a nullable/platform `Integration.agentId` (deferred until multi-tenant).
- Two-way edit of Google events from the agenda (read-only display).
- Changing the OAuth callback redirect target.

## Risks

- Google API quota/latency on agenda load → mitigate with bounded range + graceful fallback
  (agenda still renders AA data if Google fails).
- Token expiry → already handled by `getValidToken` refresh lock.

## Dependencies

- Existing: `oauth.ts` (getValidToken), `calendar.ts` (Google Calendar REST helpers),
  Google OAuth credentials in `back/.env`, redirect URI registered in Cloud Console.
