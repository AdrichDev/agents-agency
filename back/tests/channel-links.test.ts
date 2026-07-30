/**
 * Enlaces clicables en los tres canales (aa-servicios-completos-y-enlaces-clicables, C).
 *
 * Origen: una conversación real en la que el agente ofreció el enlace de la política de
 * privacidad tres veces y terminó con "no tengo un enlace directo específico". La mitad del
 * fallo era conocimiento; la otra mitad, que `[texto](url)` llegaba al visitante como
 * corchetes literales — ningún canal lo convertía.
 */
import { describe, expect, it } from "vitest";

import { toTelegramHtml, toWhatsAppText } from "@/lib/channels/format";
import { isSafeUrl, parseLinks } from "@/lib/channels/links";

const PRIVACIDAD = "https://3aestudio.vercel.app/privacidad";

describe("parseLinks — la gramática compartida", () => {
  it("reconoce un enlace markdown", () => {
    expect(parseLinks(`Mira la [política](${PRIVACIDAD}) antes.`)).toEqual([
      { kind: "text", value: "Mira la " },
      { kind: "link", label: "política", url: PRIVACIDAD },
      { kind: "text", value: " antes." },
    ]);
  });

  it("reconoce una URL suelta y le devuelve el punto a la frase", () => {
    // Sin esto el enlace se lleva el punto final y devuelve un 404.
    expect(parseLinks(`Está en ${PRIVACIDAD}.`)).toEqual([
      { kind: "text", value: "Está en " },
      { kind: "link", label: PRIVACIDAD, url: PRIVACIDAD },
      { kind: "text", value: "." },
    ]);
  });

  it("deja como texto cualquier esquema que no sea http(s)", () => {
    // El texto que se parsea aquí viene del modelo, que repite lo que hay en la base de
    // conocimiento del inquilino. Un `javascript:` que entrara por ahí no puede acabar en
    // un href.
    const parts = parseLinks("[Pulsa aquí](javascript:alert(1))");
    expect(parts).toEqual([{ kind: "text", value: "[Pulsa aquí](javascript:alert(1))" }]);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });

  it("no confunde un texto sin enlaces", () => {
    expect(parseLinks("Hola, ¿cómo te llamas?")).toEqual([
      { kind: "text", value: "Hola, ¿cómo te llamas?" },
    ]);
  });
});

describe("Telegram", () => {
  it("convierte el enlace markdown en un ancla", () => {
    expect(toTelegramHtml(`Aquí: [Política de privacidad](${PRIVACIDAD})`)).toBe(
      `Aquí: <a href="${PRIVACIDAD}">Política de privacidad</a>`,
    );
  });

  it("no deja que la etiqueta inyecte marcado", () => {
    const html = toTelegramHtml(`[<img src=x onerror=1>](${PRIVACIDAD})`);
    expect(html).toContain("&lt;img src=x onerror=1&gt;");
    expect(html).not.toContain("<img");
  });

  it("no rompe una URL con guiones bajos al aplicar negrita", () => {
    // `__(.+?)__` convertía en <b> el tramo de la URL. Por eso los enlaces se extraen
    // ANTES que la negrita y no después.
    const url = "https://3aestudio.vercel.app/a__b__c";
    expect(toTelegramHtml(`Mira ${url}`)).toBe(`Mira <a href="${url}">${url}</a>`);
  });

  it("sigue convirtiendo la negrita del resto del texto", () => {
    expect(toTelegramHtml("Cuesta **300 €**")).toBe("Cuesta <b>300 €</b>");
  });
});

describe("WhatsApp", () => {
  it("saca la URL fuera de los corchetes: WhatsApp no tiene anclas", () => {
    expect(toWhatsAppText(`Aquí: [Política de privacidad](${PRIVACIDAD})`)).toBe(
      `Aquí: Política de privacidad: ${PRIVACIDAD}`,
    );
  });

  it("deja intacta una URL suelta, que WhatsApp ya enlaza sola", () => {
    expect(toWhatsAppText(`Está en ${PRIVACIDAD}`)).toBe(`Está en ${PRIVACIDAD}`);
  });

  it("sigue convirtiendo la negrita a la sintaxis de WhatsApp", () => {
    expect(toWhatsAppText("Cuesta **300 €**")).toBe("Cuesta *300 €*");
  });
});
