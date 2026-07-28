import { test, expect } from "@playwright/test";
import { safeDestination } from "../components/landing/LoginModal";

// Regresión de la redirección abierta encontrada el 28/07/2026 en el `returnTo` del login
// (aa-bug-acceso-sin-sesion, B.3). La versión anterior validaba comparando prefijos de cadena
// (`startsWith("/")`, `"//"`, `"/\\"`) y se saltaba con un tabulador: el parser de URL de la
// WHATWG **elimina** TAB, LF y CR ANTES de resolver, así que `/<TAB>/evil.com` superaba los tres
// filtros y el navegador lo resolvía a `https://evil.com`. De 11 sondas, 5 se colaban.
//
// Son tests puros (sin `page`): `safeDestination` recibe el origen por parámetro justamente para
// poder cubrirla sin autenticarse de verdad contra Supabase.

const ORIGIN = "https://app.ejemplo.com";
const DEFAULT = "/dashboard";

test.describe("safeDestination — returnTo del login", () => {
  // Cada entrada es un intento de sacar al usuario fuera del origen tras un login legítimo.
  const externos = [
    ["protocol-relative", "//evil.com"],
    ["backslash", "/\\evil.com"],
    ["absoluta a otro host", "https://evil.com/phishing"],
    ["TAB + protocol-relative", "/\t//evil.com"],
    ["TAB simple", "/\t/evil.com"],
    ["LF", "/\n//evil.com"],
    ["CR", "/\r//evil.com"],
    ["TAB + backslash", "/\t\\/evil.com"],
  ] as const;

  for (const [nombre, entrada] of externos) {
    test(`rechaza destino externo: ${nombre}`, () => {
      const destino = safeDestination(entrada, ORIGIN);
      expect(destino).toBe(DEFAULT);
      // Doble red: resuelto contra el origen, el destino devuelto nunca sale de casa.
      expect(new URL(destino, ORIGIN).origin).toBe(ORIGIN);
    });
  }

  test("conserva los destinos internos legítimos, con query y hash", () => {
    expect(safeDestination("/agents/123?tab=qr#seccion", ORIGIN)).toBe("/agents/123?tab=qr#seccion");
    expect(safeDestination("/landing-builder/test-id", ORIGIN)).toBe("/landing-builder/test-id");
  });

  test("cae al dashboard cuando no hay returnTo o es inservible", () => {
    expect(safeDestination(null, ORIGIN)).toBe(DEFAULT);
    expect(safeDestination("", ORIGIN)).toBe(DEFAULT);
  });

  test("una URL del propio origen se normaliza a ruta relativa", () => {
    expect(safeDestination(`${ORIGIN}/facturas`, ORIGIN)).toBe("/facturas");
  });
});
