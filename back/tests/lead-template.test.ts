/**
 * T3.1 (aa-lead-whatsapp-kickoff F3, design.md §D) — resolución de config de
 * plantilla y render de variables. Precedencia notificationConfig > env >
 * default; render de `bodyVars` contra los datos del lead; kickoff-token.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveLeadTemplate,
  renderBodyParams,
  renderTemplateText,
  resolveKickoffToken,
} from "@/lib/channels/lead-template";

describe("resolveLeadTemplate — precedencia notificationConfig > env > default", () => {
  beforeEach(() => {
    delete process.env.META_LEAD_TEMPLATE_NAME;
    delete process.env.META_LEAD_TEMPLATE_LANG;
  });
  afterEach(() => {
    delete process.env.META_LEAD_TEMPLATE_NAME;
    delete process.env.META_LEAD_TEMPLATE_LANG;
  });

  it("notificationConfig.leadTemplate gana sobre env y default", () => {
    process.env.META_LEAD_TEMPLATE_NAME = "env_name";
    process.env.META_LEAD_TEMPLATE_LANG = "en";
    const cfg = resolveLeadTemplate({
      leadTemplate: { name: "cfg_name", language: "pt", bodyVars: ["nombre", "peticion"] },
    });
    expect(cfg).toEqual({ name: "cfg_name", language: "pt", bodyVars: ["nombre", "peticion"] });
  });

  it("sin leadTemplate → usa env", () => {
    process.env.META_LEAD_TEMPLATE_NAME = "env_name";
    process.env.META_LEAD_TEMPLATE_LANG = "en";
    const cfg = resolveLeadTemplate({});
    expect(cfg.name).toBe("env_name");
    expect(cfg.language).toBe("en");
    expect(cfg.bodyVars).toEqual(["nombre"]);
  });

  it("sin config ni env → defaults (lead_primer_contacto / es / [nombre])", () => {
    const cfg = resolveLeadTemplate(undefined);
    expect(cfg).toEqual({ name: "lead_primer_contacto", language: "es", bodyVars: ["nombre"] });
  });

  it("bodyText opcional se conserva; bodyVars no-string se filtran", () => {
    const cfg = resolveLeadTemplate({
      leadTemplate: { bodyText: "Hola {{1}}", bodyVars: ["nombre", 42, null] },
    });
    expect(cfg.bodyText).toBe("Hola {{1}}");
    expect(cfg.bodyVars).toEqual(["nombre"]);
  });
});

describe("renderBodyParams — rellena variables en el orden declarado", () => {
  it("mapea bodyVars a los campos del lead", () => {
    const cfg = { name: "t", language: "es", bodyVars: ["nombre", "peticion"] };
    const params = renderBodyParams(cfg, { nombre: "Ana", peticion: "quiere cita" });
    expect(params).toEqual(["Ana", "quiere cita"]);
  });

  it("variable ausente en el lead → cadena vacía (nunca undefined)", () => {
    const cfg = { name: "t", language: "es", bodyVars: ["nombre", "email"] };
    const params = renderBodyParams(cfg, { nombre: "Ana" });
    expect(params).toEqual(["Ana", ""]);
  });
});

describe("renderTemplateText — texto sembrado para contexto del LLM", () => {
  it("usa bodyText con placeholders {{n}} interpolando bodyParams", () => {
    const cfg = { name: "t", language: "es", bodyVars: ["nombre"], bodyText: "Hola {{1}}, ¿todo bien?" };
    expect(renderTemplateText(cfg, ["Ana"])).toBe("Hola Ana, ¿todo bien?");
  });

  it("sin bodyText → saludo por defecto con el nombre (primer param)", () => {
    const cfg = { name: "t", language: "es", bodyVars: ["nombre"] };
    expect(renderTemplateText(cfg, ["Ana"])).toContain("Ana");
  });

  it("sin bodyText y sin nombre → saludo genérico", () => {
    const cfg = { name: "t", language: "es", bodyVars: [] };
    expect(renderTemplateText(cfg, [])).toBe("Hola, gracias por tu interés. ¿En qué puedo ayudarte?");
  });
});

describe("resolveKickoffToken — gate per-agente", () => {
  it("devuelve el token si está configurado", () => {
    expect(resolveKickoffToken({ kickoffToken: "  secreto  " })).toBe("secreto");
  });

  it("sin token configurado → undefined", () => {
    expect(resolveKickoffToken({})).toBeUndefined();
    expect(resolveKickoffToken(undefined)).toBeUndefined();
    expect(resolveKickoffToken({ kickoffToken: "   " })).toBeUndefined();
  });
});
