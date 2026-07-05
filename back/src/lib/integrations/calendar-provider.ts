import * as googleCalendar from "./calendar";

export interface CalendarEventInput {
  title: string;
  startIso: string;
  endIso: string;
  description?: string;
  attendees?: string[];
}

export interface CalendarProvider {
  createEvent(input: CalendarEventInput): Promise<{ externalId: string }>;
  updateEvent(externalId: string, input: CalendarEventInput): Promise<void>;
  deleteEvent(externalId: string): Promise<void>;
}

// In-memory mock database for mock provider (contract tests verification)
export const mockCalendarDb = new Map<string, CalendarEventInput>();

export function getCalendarProvider(provider: string, token: string): CalendarProvider {
  if (provider === "google") {
    return {
      async createEvent(input) {
        const result = await googleCalendar.createEvent(token, input);
        if (!result.id) throw new Error("No event ID returned from Google Calendar");
        return { externalId: result.id };
      },
      async updateEvent(externalId, input) {
        await googleCalendar.updateEvent(token, externalId, input);
      },
      async deleteEvent(externalId) {
        await googleCalendar.deleteEvent(token, externalId);
      },
    };
  }

  if (provider === "mock") {
    return {
      async createEvent(input) {
        const externalId = `mock-evt-${Math.random().toString(36).slice(2, 9)}`;
        mockCalendarDb.set(externalId, input);
        return { externalId };
      },
      async updateEvent(externalId, input) {
        if (!mockCalendarDb.has(externalId)) throw new Error("Event not found in mock calendar");
        mockCalendarDb.set(externalId, input);
      },
      async deleteEvent(externalId) {
        if (!mockCalendarDb.has(externalId)) throw new Error("Event not found in mock calendar");
        mockCalendarDb.delete(externalId);
      },
    };
  }
  
  throw new Error(`Calendar provider "${provider}" not implemented`);
}
