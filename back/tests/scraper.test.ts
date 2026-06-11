import { describe, it, expect } from "vitest";
import {
  buildGithubSearchPages,
  extractToolsFromReadme,
  normalizeGithubRepo,
} from "@/lib/github-skills/scraper";

describe("extractToolsFromReadme", () => {
  it("extrae tools de bullets con backticks", () => {
    const readme = [
      "## Tools",
      "- `list_emails` — Lista emails del buzón",
      "- `send_email`: Envía un email",
      "* `create_issue` - Crea un ticket",
    ].join("\n");
    const tools = extractToolsFromReadme(readme);
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_emails");
    expect(names).toContain("send_email");
    expect(names).toContain("create_issue");
    expect(tools.find((t) => t.name === "list_emails")?.description).toMatch(/Lista emails/);
  });

  it("ignora comandos comunes que no son tools", () => {
    const readme = "- `npm` — instalar\n- `npx` — ejecutar\n- `real_tool` — hace algo";
    const names = extractToolsFromReadme(readme).map((t) => t.name);
    expect(names).not.toContain("npm");
    expect(names).toContain("real_tool");
  });

  it("extrae tools de headings con underscore", () => {
    const readme = "#### get_weather\nDevuelve el tiempo\n#### Installation\nnpm i";
    const names = extractToolsFromReadme(readme).map((t) => t.name);
    expect(names).toContain("get_weather");
    expect(names).not.toContain("Installation");
  });
});

describe("buildGithubSearchPages", () => {
  it("pide hasta 1000 repos en paginas de 100 por limite de GitHub", () => {
    const pages = buildGithubSearchPages(1000);

    expect(pages).toHaveLength(10);
    expect(pages[0]).toContain("per_page=100");
    expect(pages[0]).toContain("page=1");
    expect(pages[9]).toContain("page=10");
  });

  it("limita discovery a 1000 aunque pidan mas", () => {
    expect(buildGithubSearchPages(2000)).toHaveLength(10);
  });
});

describe("normalizeGithubRepo", () => {
  it("acepta URLs de GitHub y devuelve owner/repo limpio", () => {
    expect(normalizeGithubRepo("https://github.com/github/github-mcp-server")).toEqual({
      fullName: "github/github-mcp-server",
      repoUrl: "https://github.com/github/github-mcp-server",
    });
  });

  it("acepta owner/repo sin URL", () => {
    expect(normalizeGithubRepo("modelcontextprotocol/servers")).toEqual({
      fullName: "modelcontextprotocol/servers",
      repoUrl: "https://github.com/modelcontextprotocol/servers",
    });
  });
});
