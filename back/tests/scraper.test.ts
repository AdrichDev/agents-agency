import { describe, it, expect } from "vitest";
import {
  buildGithubSearchPages,
  detectType,
  detectUse,
  extractComponentsFromTree,
  extractToolsFromReadme,
  isAsianContent,
  normalizeGithubRepo,
  normalizeType,
  normalizeUse,
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
  it("genera paginas de 100 con su tipo de query", () => {
    const pages = buildGithubSearchPages(1000);

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].url).toContain("per_page=100");
    expect(pages[0].url).toContain("page=1");
    expect(pages[0].queryType).toBeTruthy();
  });

  it("limita discovery a 1000 aunque pidan mas", () => {
    expect(buildGithubSearchPages(2000).length).toBe(buildGithubSearchPages(1000).length);
  });
});

describe("clasificación type/use", () => {
  it("normalizeType solo devuelve los 5 valores permitidos en uppercase", () => {
    expect(normalizeType("mcp")).toBe("MCP");
    expect(normalizeType("agentes")).toBe("AGENT");
    expect(normalizeType("agent")).toBe("AGENT");
    expect(normalizeType("extensiones")).toBe("EXTENSION");
    expect(normalizeType("plugins")).toBe("PLUGIN");
    expect(normalizeType("cualquier otra cosa")).toBe("SKILL");
    expect(normalizeType(undefined)).toBe("SKILL");
  });

  it("normalizeUse devuelve uppercase y GENERAL si vacío", () => {
    expect(normalizeUse("email")).toBe("EMAIL");
    expect(normalizeUse("  bases de datos ")).toBe("BASES DE DATOS");
    expect(normalizeUse("")).toBe("GENERAL");
    expect(normalizeUse(null)).toBe("GENERAL");
  });

  it("detectType identifica la naturaleza de la herramienta", () => {
    expect(detectType("github-mcp-server", "MCP server for GitHub")).toBe("MCP");
    expect(detectType("crewai", "autonomous AI agents")).toBe("AGENT");
    expect(detectType("gitlens", "VSCode extension for git")).toBe("EXTENSION");
    expect(detectType("slack-plugin", "plugin for Slack")).toBe("PLUGIN");
    expect(detectType("pdf-toolkit", "library to merge PDFs")).toBe("SKILL");
  });

  it("detectUse devuelve el uso funcional en uppercase", () => {
    expect(detectUse("gmail-tools", "send and read email")).toBe("EMAIL");
    expect(detectUse("pg-helper", "postgres database utilities")).toBe("BASES DE DATOS");
    expect(detectUse("foo", "bar")).toBe("GENERAL");
  });
});

describe("extractComponentsFromTree", () => {
  const tree = [
    { path: "skills", type: "tree" },
    { path: "skills/pdf-merge", type: "tree" },
    { path: "skills/docs", type: "tree" }, // ignorada (carpeta auxiliar)
    { path: "src", type: "tree" },
    { path: "src/agents", type: "tree" },
    { path: "src/agents/sales-bot", type: "tree" },
    { path: "src/agents/sales-bot/lib", type: "tree" }, // demasiado profunda
    { path: "plugins", type: "tree" },
    { path: "plugins/slack-notifier", type: "tree" },
    { path: "servers", type: "tree" },
    { path: "servers/gmail", type: "tree" },
    { path: "README.md", type: "blob" },
  ];

  it("extrae subcarpetas de skills/, agents/, plugins/ y servers/ con su type", () => {
    const comps = extractComponentsFromTree(tree);
    const byName = Object.fromEntries(comps.map((c) => [c.name, c.type]));

    expect(byName["pdf-merge"]).toBe("SKILL");
    expect(byName["sales-bot"]).toBe("AGENT");
    expect(byName["slack-notifier"]).toBe("PLUGIN");
    expect(byName["gmail"]).toBe("MCP");
  });

  it("ignora carpetas auxiliares y niveles profundos", () => {
    const names = extractComponentsFromTree(tree).map((c) => c.name);
    expect(names).not.toContain("docs");
    expect(names).not.toContain("lib");
  });
});

describe("isAsianContent", () => {
  it("detecta chino, japonés y coreano", () => {
    expect(isAsianContent("mcp-server", "微信公众号管理工具")).toBe(true);
    expect(isAsianContent("ツール", "japanese tool")).toBe(true);
    expect(isAsianContent("도구", "korean tool")).toBe(true);
  });

  it("no marca repos en español o inglés (incluidos acentos y ñ)", () => {
    expect(isAsianContent("gestión-agenda", "Gestión de calendarios y citas para pequeños negocios")).toBe(false);
    expect(isAsianContent("github-mcp-server", "Official GitHub MCP server")).toBe(false);
    expect(isAsianContent(null, undefined)).toBe(false);
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
