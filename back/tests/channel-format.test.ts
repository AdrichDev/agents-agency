import { describe, expect, it } from "vitest";
import { toTelegramHtml, toWhatsAppText } from "@/lib/channels/format";

describe("channel format", () => {
  describe("toTelegramHtml", () => {
    it("converts **bold** to <b>", () => {
      expect(toTelegramHtml("Hola **Adrián**, bienvenido")).toBe("Hola <b>Adrián</b>, bienvenido");
    });

    it("escapes HTML entities before converting", () => {
      expect(toTelegramHtml("precio < 100 & **gratis**")).toBe("precio &lt; 100 &amp; <b>gratis</b>");
    });

    it("strips markdown headings", () => {
      expect(toTelegramHtml("### Título\ntexto")).toBe("Título\ntexto");
    });
  });

  describe("toWhatsAppText", () => {
    it("converts **bold** to single-asterisk WhatsApp bold", () => {
      expect(toWhatsAppText("Hola **Adrián**")).toBe("Hola *Adrián*");
    });

    it("leaves plain text untouched", () => {
      expect(toWhatsAppText("sin formato")).toBe("sin formato");
    });
  });
});
