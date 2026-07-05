const BASE = "https://www.googleapis.com/calendar/v3";

async function calFetch(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`Calendar API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function listEvents(token: string, days = 7, maxResults = 10) {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 86400_000).toISOString();
  const data = await calFetch(
    token,
    `/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`
  );
  return (data.items ?? []).map((e: any) => ({
    id: e.id,
    title: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    attendees: e.attendees?.map((a: any) => a.email),
  }));
}

export async function createEvent(
  token: string,
  input: { title: string; startIso: string; endIso: string; description?: string; attendees?: string[] }
) {
  const event = await calFetch(token, "/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify({
      summary: input.title,
      description: input.description,
      start: { dateTime: input.startIso },
      end: { dateTime: input.endIso },
      attendees: input.attendees?.map((email) => ({ email })),
    }),
  });
  return { ok: true, id: event.id, link: event.htmlLink };
}

export async function deleteEvent(token: string, eventId: string) {
  await calFetch(token, `/calendars/primary/events/${eventId}`, { method: "DELETE" });
  return { ok: true };
}

export async function updateEvent(
  token: string,
  eventId: string,
  input: { title: string; startIso: string; endIso: string; description?: string; attendees?: string[] }
) {
  const event = await calFetch(token, `/calendars/primary/events/${eventId}`, {
    method: "PUT",
    body: JSON.stringify({
      summary: input.title,
      description: input.description,
      start: { dateTime: input.startIso },
      end: { dateTime: input.endIso },
      attendees: input.attendees?.map((email) => ({ email })),
    }),
  });
  return { ok: true, id: event.id, link: event.htmlLink };
}
