/**
 * F-13 (auditoría integral) — el asistente de creación de agente empujaba el `returnTo` de la
 * query tal cual: `router.push(returnTo + "?newAgentId=…")`. Un enlace preparado
 * `/agents/new?returnTo=https://evil.example` sacaba al usuario del origen justo después de
 * crear el agente, y de paso le regalaba el id recién creado.
 *
 * Estas funciones son puras (reciben el origen por parámetro) para poder probarlas sin
 * navegador, igual que `safeDestination` en el login.
 */
import { test, expect } from "@playwright/test";
import {
  safeDestination,
  withQuery,
  safeAgentCreatedDestination,
} from "../lib/safe-destination";

const ORIGIN = "https://app.ejemplo.com";
const DEFAULT = "/dashboard";

test.describe("safeDestination — misma regla que el login", () => {
  const externos = [
    ["protocol-relative", "//evil.com"],
    ["absoluta a otro host", "https://evil.com/phishing"],
    ["TAB + protocol-relative", "/\t//evil.com"],
    ["CR", "/\r//evil.com"],
  ] as const;

  for (const [nombre, entrada] of externos) {
    test(`rechaza destino externo: ${nombre}`, () => {
      const destino = safeDestination(entrada, ORIGIN);
      expect(destino).toBe(DEFAULT);
      expect(new URL(destino, ORIGIN).origin).toBe(ORIGIN);
    });
  }

  test("conserva destinos internos con query y hash", () => {
    expect(safeDestination("/agents/123?tab=qr#seccion", ORIGIN)).toBe("/agents/123?tab=qr#seccion");
  });
});

test.describe("withQuery — añade el parámetro sin romper query ni hash", () => {
  test("sin query ni hash", () => {
    expect(withQuery("/agents", "newAgentId", "a1")).toBe("/agents?newAgentId=a1");
  });
  test("con query existente añade con &", () => {
    expect(withQuery("/agents?tab=qr", "newAgentId", "a1")).toBe("/agents?tab=qr&newAgentId=a1");
  });
  test("con hash, el parámetro va ANTES del hash", () => {
    expect(withQuery("/agents#lista", "newAgentId", "a1")).toBe("/agents?newAgentId=a1#lista");
    expect(withQuery("/agents?tab=qr#lista", "newAgentId", "a1")).toBe(
      "/agents?tab=qr&newAgentId=a1#lista",
    );
  });
  test("escapa el valor", () => {
    expect(withQuery("/agents", "q", "a b&c")).toBe("/agents?q=a%20b%26c");
  });
});

test.describe("safeAgentCreatedDestination — el caso del wizard", () => {
  test("returnTo externo cae al dashboard y NO viaja el id a un tercero", () => {
    const destino = safeAgentCreatedDestination("https://evil.example", "a1", ORIGIN);
    expect(destino).toBe(`${DEFAULT}?newAgentId=a1`);
    expect(new URL(destino, ORIGIN).origin).toBe(ORIGIN);
  });

  test("sin returnTo va al dashboard con el id", () => {
    expect(safeAgentCreatedDestination(null, "a1", ORIGIN)).toBe(`${DEFAULT}?newAgentId=a1`);
  });

  test("returnTo interno conserva su ruta, query y hash", () => {
    expect(safeAgentCreatedDestination("/agents?tab=qr#lista", "a1", ORIGIN)).toBe(
      "/agents?tab=qr&newAgentId=a1#lista",
    );
  });
});
