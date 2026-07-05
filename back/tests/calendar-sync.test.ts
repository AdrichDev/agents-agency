import { describe, it, expect, beforeEach } from "vitest";
import { getCalendarProvider, mockCalendarDb } from "../src/lib/integrations/calendar-provider";

describe("Calendar Sync Contract Tests", () => {
  beforeEach(() => {
    mockCalendarDb.clear();
  });

  it("should create a calendar event using the mock provider", async () => {
    const provider = getCalendarProvider("mock", "test-token");
    const input = {
      title: "Reunión de prueba",
      startIso: "2026-07-05T09:30:00.000Z",
      endIso: "2026-07-05T10:00:00.000Z",
      description: "Descripción de prueba",
      attendees: ["test@example.com"],
    };

    const result = await provider.createEvent(input);
    expect(result.externalId).toBeDefined();
    expect(result.externalId.startsWith("mock-evt-")).toBe(true);

    const saved = mockCalendarDb.get(result.externalId);
    expect(saved).toEqual(input);
  });

  it("should update a calendar event using the mock provider", async () => {
    const provider = getCalendarProvider("mock", "test-token");
    const input1 = {
      title: "Reunión de prueba 1",
      startIso: "2026-07-05T09:30:00.000Z",
      endIso: "2026-07-05T10:00:00.000Z",
    };
    const { externalId } = await provider.createEvent(input1);

    const input2 = {
      title: "Reunión de prueba 2",
      startIso: "2026-07-05T11:30:00.000Z",
      endIso: "2026-07-05T12:00:00.000Z",
    };
    await provider.updateEvent(externalId, input2);

    const saved = mockCalendarDb.get(externalId);
    expect(saved).toEqual(input2);
  });

  it("should delete a calendar event using the mock provider", async () => {
    const provider = getCalendarProvider("mock", "test-token");
    const input = {
      title: "Reunión a borrar",
      startIso: "2026-07-05T09:30:00.000Z",
      endIso: "2026-07-05T10:00:00.000Z",
    };
    const { externalId } = await provider.createEvent(input);
    expect(mockCalendarDb.has(externalId)).toBe(true);

    await provider.deleteEvent(externalId);
    expect(mockCalendarDb.has(externalId)).toBe(false);
  });

  it("should throw error when updating or deleting non-existent events", async () => {
    const provider = getCalendarProvider("mock", "test-token");
    const nonExistentId = "non-existent-id";

    await expect(provider.updateEvent(nonExistentId, {
      title: "Test",
      startIso: "2026-07-05T09:30:00.000Z",
      endIso: "2026-07-05T10:00:00.000Z",
    })).rejects.toThrow("Event not found in mock calendar");

    await expect(provider.deleteEvent(nonExistentId)).rejects.toThrow("Event not found in mock calendar");
  });

  it("should throw error for unsupported providers", () => {
    expect(() => getCalendarProvider("outlook", "token")).toThrow("Calendar provider \"outlook\" not implemented");
  });
});
