import { describe, it, expect } from "vitest";
import {
  logicalProviderForSkill,
  capabilitiesForSkills,
  toolsForSkillProviders,
  buildSkillStatus,
} from "@/lib/agent/skill-capabilities";
import { assertValidRange } from "@/lib/agent/executor";

// ─── logicalProviderForSkill ─────────────────────────────────────────────────

describe("logicalProviderForSkill", () => {
  it("CALENDARIO use → calendar", () => {
    expect(logicalProviderForSkill({ id: "1", name: "Mi skill", use: "CALENDARIO" })).toBe("calendar");
  });

  it("CALENDAR use → calendar", () => {
    expect(logicalProviderForSkill({ id: "1", name: "Mi skill", use: "CALENDAR" })).toBe("calendar");
  });

  it("EMAIL use → gmail", () => {
    expect(logicalProviderForSkill({ id: "1", name: "Mi skill", use: "EMAIL" })).toBe("gmail");
  });

  it("GMAIL use → gmail", () => {
    expect(logicalProviderForSkill({ id: "1", name: "Skill", use: "GMAIL" })).toBe("gmail");
  });

  it("SLACK use → slack", () => {
    expect(logicalProviderForSkill({ id: "1", name: "Skill", use: "SLACK" })).toBe("slack");
  });

  it("NOTION use → notion", () => {
    expect(logicalProviderForSkill({ id: "1", name: "Skill", use: "NOTION" })).toBe("notion");
  });

  it("unknown use → null (informativa)", () => {
    expect(logicalProviderForSkill({ id: "1", name: "Custom AI Skill", use: "GENERAL" })).toBeNull();
  });

  it("name override gana sobre use: 'Google Calendar Bot' con use GENERAL → calendar", () => {
    expect(logicalProviderForSkill({ id: "1", name: "Google Calendar Bot", use: "GENERAL" })).toBe("calendar");
  });

  it("name override: 'calendario de reservas' con use desconocido → calendar", () => {
    expect(logicalProviderForSkill({ id: "1", name: "Calendario de reservas", use: "OTHER" })).toBe("calendar");
  });

  it("name override case-insensitive: 'GMAIL Sender' → gmail", () => {
    expect(logicalProviderForSkill({ id: "1", name: "GMAIL Sender", use: "UNKNOWN" })).toBe("gmail");
  });
});

// ─── capabilitiesForSkills ────────────────────────────────────────────────────

describe("capabilitiesForSkills", () => {
  it("skill calendar + google conectado → executableProviders incluye calendar", () => {
    const result = capabilitiesForSkills(
      [{ id: "s1", name: "Agenda", use: "CALENDARIO" }],
      ["google"]
    );
    expect(result.executableProviders).toContain("calendar");
    expect(result.missingConnections).toHaveLength(0);
    expect(result.informationalSkills).toHaveLength(0);
  });

  it("skill calendar sin google → missingConnections con physical google", () => {
    const result = capabilitiesForSkills(
      [{ id: "s1", name: "Agenda", use: "CALENDARIO" }],
      []
    );
    expect(result.executableProviders).toHaveLength(0);
    expect(result.missingConnections).toHaveLength(1);
    expect(result.missingConnections[0].physical).toBe("google");
    expect(result.missingConnections[0].provider).toBe("calendar");
  });

  it("skill sin mapeo → informationalSkills", () => {
    const result = capabilitiesForSkills(
      [{ id: "s1", name: "Custom Skill", use: "GENERAL" }],
      ["google"]
    );
    expect(result.informationalSkills).toHaveLength(1);
    expect(result.informationalSkills[0].skillId).toBe("s1");
    expect(result.executableProviders).toHaveLength(0);
  });

  it("dos skills que mapean a calendar → dedup a un solo proveedor", () => {
    const result = capabilitiesForSkills(
      [
        { id: "s1", name: "Agenda", use: "CALENDARIO" },
        { id: "s2", name: "Calendar Bot", use: "CALENDAR" },
      ],
      ["google"]
    );
    expect(result.executableProviders.filter((p) => p === "calendar")).toHaveLength(1);
  });

  it("lista vacía → todo vacío (R8 regresión cero)", () => {
    const result = capabilitiesForSkills([], ["google"]);
    expect(result.executableProviders).toHaveLength(0);
    expect(result.missingConnections).toHaveLength(0);
    expect(result.informationalSkills).toHaveLength(0);
  });

  it("huérfana filtrada antes de llegar: si filtramos skills con s.skill != null, array vacío", () => {
    // Simula el filtro que hace engine.ts (R7)
    const rawSkills = [{ skill: null }, { skill: { name: "Real", use: "SLACK" } }];
    const inputs = rawSkills
      .filter((s) => s.skill != null)
      .map((s: any) => ({ id: "x", name: s.skill.name, use: s.skill.use }));
    const result = capabilitiesForSkills(inputs, ["slack"]);
    expect(result.executableProviders).toContain("slack");
    expect(result.informationalSkills).toHaveLength(0);
  });
});

// ─── toolsForSkillProviders ───────────────────────────────────────────────────

describe("toolsForSkillProviders", () => {
  it("calendar → list_calendar_events y create_calendar_event", () => {
    const tools = toolsForSkillProviders(["calendar"]);
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_calendar_events");
    expect(names).toContain("create_calendar_event");
  });

  it("proveedor desconocido → array vacío", () => {
    expect(toolsForSkillProviders(["noop"])).toHaveLength(0);
  });

  it("vacío → array vacío", () => {
    expect(toolsForSkillProviders([])).toHaveLength(0);
  });
});

// ─── buildSkillStatus ─────────────────────────────────────────────────────────

describe("buildSkillStatus", () => {
  it("skill calendar + google → state executable", () => {
    const items = buildSkillStatus([{ id: "s1", name: "Agenda", use: "CALENDARIO" }], ["google"]);
    expect(items[0].state).toBe("executable");
  });

  it("skill calendar sin google → state requires_connection con provider google", () => {
    const items = buildSkillStatus([{ id: "s1", name: "Agenda", use: "CALENDARIO" }], []);
    expect(items[0].state).toBe("requires_connection");
    expect(items[0].provider).toBe("google");
  });

  it("skill informativa → state informational", () => {
    const items = buildSkillStatus([{ id: "s1", name: "Custom", use: "GENERAL" }], []);
    expect(items[0].state).toBe("informational");
    expect(items[0].provider).toBeUndefined();
  });

  it("lista vacía → array vacío", () => {
    expect(buildSkillStatus([], ["google"])).toHaveLength(0);
  });
});

// ─── assertValidRange ─────────────────────────────────────────────────────────

describe("assertValidRange", () => {
  it("rango válido no lanza", () => {
    expect(() =>
      assertValidRange("2026-06-12T10:00:00Z", "2026-06-12T11:00:00Z")
    ).not.toThrow();
  });

  it("startIso inválido lanza con mensaje legible", () => {
    expect(() => assertValidRange("not-a-date", "2026-06-12T11:00:00Z")).toThrow(/startIso/);
  });

  it("endIso inválido lanza con mensaje legible", () => {
    expect(() => assertValidRange("2026-06-12T10:00:00Z", "nope")).toThrow(/endIso/);
  });

  it("end <= start lanza", () => {
    expect(() =>
      assertValidRange("2026-06-12T11:00:00Z", "2026-06-12T10:00:00Z")
    ).toThrow(/posterior/);
  });

  it("end === start lanza", () => {
    expect(() =>
      assertValidRange("2026-06-12T10:00:00Z", "2026-06-12T10:00:00Z")
    ).toThrow(/posterior/);
  });
});
