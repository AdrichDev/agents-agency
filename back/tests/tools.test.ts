import { describe, it, expect } from "vitest";
import { toolsForProviders, KNOWLEDGE_TOOL, TOOLS_BY_PROVIDER } from "@/lib/agent/tools";

describe("toolsForProviders", () => {
  it("siempre incluye search_knowledge", () => {
    expect(toolsForProviders([]).map((t) => t.name)).toEqual([KNOWLEDGE_TOOL.name]);
  });

  it("añade las tools de cada integración conectada", () => {
    const names = toolsForProviders(["gmail", "jira"]).map((t) => t.name);
    expect(names).toContain("list_emails");
    expect(names).toContain("create_jira_issue");
    expect(names).not.toContain("send_slack_message");
  });

  it("ignora proveedores desconocidos", () => {
    expect(toolsForProviders(["nope"]).length).toBe(1);
  });

  it("todas las tools tienen schema válido", () => {
    for (const tools of Object.values(TOOLS_BY_PROVIDER)) {
      for (const t of tools) {
        expect(t.input_schema.type).toBe("object");
        expect(t.name).toMatch(/^[a-z_]+$/);
      }
    }
  });
});
