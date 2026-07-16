import { describe, it, expect } from "vitest";
import {
  logicalProviderForSkill,
  capabilitiesForSkills,
  toolsForSkillProviders,
  buildSkillStatus,
} from "@/lib/agent/skill-capabilities";
import { assertValidRange } from "@/lib/agent/executor";

// F1 aa-skills-executable-contract: la facultad de una skill es EXPLÍCITA
// (Skill.toolsProvider); las heurísticas legadas por nombre/uso se eliminaron.

// ─── logicalProviderForSkill ─────────────────────────────────────────────────

describe("logicalProviderForSkill — contrato explícito", () => {
  it("toolsProvider 'calendar' → calendar", () => {
    expect(
      logicalProviderForSkill({ id: "1", name: "Mi skill", use: "GENERAL", toolsProvider: "calendar" })
    ).toBe("calendar");
  });

  it("toolsProvider 'gmail' → gmail", () => {
    expect(
      logicalProviderForSkill({ id: "1", name: "Skill", use: "GENERAL", toolsProvider: "gmail" })
    ).toBe("gmail");
  });

  it("toolsProvider 'ecommerce' → ecommerce", () => {
    expect(
      logicalProviderForSkill({ id: "1", name: "Skill", use: "GENERAL", toolsProvider: "ecommerce" })
    ).toBe("ecommerce");
  });

  it("sin toolsProvider → null (informativa)", () => {
    expect(logicalProviderForSkill({ id: "1", name: "Custom AI Skill", use: "GENERAL" })).toBeNull();
  });

  it("toolsProvider null → null (informativa)", () => {
    expect(
      logicalProviderForSkill({ id: "1", name: "Skill", use: "SLACK", toolsProvider: null })
    ).toBeNull();
  });

  it("clave desconocida (typo / provider retirado) → null, nunca rompe", () => {
    expect(
      logicalProviderForSkill({ id: "1", name: "Skill", use: "GENERAL", toolsProvider: "whatsapp-mcp" })
    ).toBeNull();
  });

  it("REGRESIÓN de heurística: el nombre ya NO decide la facultad", () => {
    // Antes 'Google Calendar Bot' era ejecutable por substring del nombre.
    expect(
      logicalProviderForSkill({ id: "1", name: "Google Calendar Bot", use: "GENERAL", toolsProvider: null })
    ).toBeNull();
  });

  it("REGRESIÓN de heurística: el `use` ya NO decide la facultad", () => {
    // Antes use=CALENDARIO era ejecutable por el mapa use→provider.
    expect(
      logicalProviderForSkill({ id: "1", name: "Mi skill", use: "CALENDARIO", toolsProvider: null })
    ).toBeNull();
  });
});

// ─── capabilitiesForSkills ────────────────────────────────────────────────────

describe("capabilitiesForSkills", () => {
  it("skill calendar + google conectado → executableProviders incluye calendar", () => {
    const result = capabilitiesForSkills(
      [{ id: "s1", name: "Agenda", use: "CALENDARIO", toolsProvider: "calendar" }],
      ["google"]
    );
    expect(result.executableProviders).toContain("calendar");
    expect(result.missingConnections).toHaveLength(0);
    expect(result.informationalSkills).toHaveLength(0);
  });

  it("skill calendar sin google → missingConnections con physical google", () => {
    const result = capabilitiesForSkills(
      [{ id: "s1", name: "Agenda", use: "CALENDARIO", toolsProvider: "calendar" }],
      []
    );
    expect(result.executableProviders).toHaveLength(0);
    expect(result.missingConnections).toHaveLength(1);
    expect(result.missingConnections[0].physical).toBe("google");
    expect(result.missingConnections[0].provider).toBe("calendar");
  });

  it("skill sin facultad declarada → informationalSkills", () => {
    const result = capabilitiesForSkills(
      [{ id: "s1", name: "Custom Skill", use: "GENERAL" }],
      ["google"]
    );
    expect(result.informationalSkills).toHaveLength(1);
    expect(result.informationalSkills[0].skillId).toBe("s1");
    expect(result.executableProviders).toHaveLength(0);
  });

  it("dos skills que declaran calendar → dedup a un solo proveedor", () => {
    const result = capabilitiesForSkills(
      [
        { id: "s1", name: "Agenda", use: "CALENDARIO", toolsProvider: "calendar" },
        { id: "s2", name: "Calendar Bot", use: "CALENDAR", toolsProvider: "calendar" },
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
    const rawSkills = [{ skill: null }, { skill: { name: "Real", use: "SLACK", toolsProvider: "slack" } }];
    const inputs = rawSkills
      .filter((s) => s.skill != null)
      .map((s: any) => ({ id: "x", name: s.skill.name, use: s.skill.use, toolsProvider: s.skill.toolsProvider }));
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
    const items = buildSkillStatus(
      [{ id: "s1", name: "Agenda", use: "CALENDARIO", toolsProvider: "calendar" }],
      ["google"]
    );
    expect(items[0].state).toBe("executable");
  });

  it("skill calendar sin google → state requires_connection con provider google", () => {
    const items = buildSkillStatus(
      [{ id: "s1", name: "Agenda", use: "CALENDARIO", toolsProvider: "calendar" }],
      []
    );
    expect(items[0].state).toBe("requires_connection");
    expect(items[0].provider).toBe("google");
  });

  it("skill informativa → state informational", () => {
    const items = buildSkillStatus([{ id: "s1", name: "Custom", use: "GENERAL" }], []);
    expect(items[0].state).toBe("informational");
    expect(items[0].provider).toBeUndefined();
  });

  it("clave declarada inválida → state informational (fail-soft)", () => {
    const items = buildSkillStatus(
      [{ id: "s1", name: "Rota", use: "GENERAL", toolsProvider: "typo-provider" }],
      ["google"]
    );
    expect(items[0].state).toBe("informational");
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
