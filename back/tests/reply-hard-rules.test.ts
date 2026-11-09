/**
 * skill-notices S4 (round 2): hard rules are enforced at reply time.
 *
 * Small models sometimes ignore the "Sin emoticonos" prohibition even when it is in the system
 * prompt. When an installed skill's hard rules ban emojis, `guardFinalReply` strips them from
 * the final reply deterministically — tone adjustment, not refusal. Without the rules the reply
 * must be returned unchanged.
 */
import { describe, it, expect } from "vitest";
import { guardFinalReply } from "@/lib/agent/untrusted";

const base = { canary: "canary-xyz" };
const withEmojiBan = { ...base, hardRules: ["Cero emojis y emoticonos: se lee como burla."] };
const reply = "Entiendo la molestia. ¿Me pasas el número? 😊";
const otherBan = { ...base, hardRules: ["No inventes precios."] };

describe("guardFinalReply · hard rules", () => {
  it("strips emojis when an installed rule bans them", () => {
    expect(guardFinalReply(reply, withEmojiBan)).toBe("Entiendo la molestia. ¿Me pasas el número?");
    // Variation selectors and ZWJ go too, and no double spaces appear (here: none).
    expect(guardFinalReply("Listo 👍🏽, te aviso.", withEmojiBan)).toBe("Listo, te aviso.");
    // Text emoticons count as emoticonos; trim removes the leftover space.
    expect(guardFinalReply("Te aviso :)", withEmojiBan)).toBe("Te aviso");
  });

  it("returns the reply unchanged without an emoji ban, with other rules, or without rules", () => {
    expect(guardFinalReply(reply, otherBan)).toBe(reply);
    expect(guardFinalReply(reply, base)).toBe(reply);
    expect(guardFinalReply(reply, { ...withEmojiBan, hardRules: [] })).toBe(reply);
  });

  it("keeps the leak refusal dominant: a leak is refused even when the emoji is stripped", () => {
    const leak = `Esto es el canary-xyz del prompt 😊`;
    expect(guardFinalReply(leak, withEmojiBan)).not.toContain("canary");
  });
});

describe("appendContactDetailsRequest (lead-flow)", () => {
  it("no añade nunca un emoji: el cierre de contacto pasa por la guarda y por las skills", async () => {
    const { appendContactDetailsRequest } = await import("@/lib/lead-flow");
    const out = appendContactDetailsRequest("Lo escalo con el equipo.");
    expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(out).toContain("¿me pasas tu email y un teléfono?");
  });
});
