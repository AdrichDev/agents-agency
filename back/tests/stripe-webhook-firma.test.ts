/**
 * H6 (aa-stripe-suscripciones, T3.5) — E6 (AC8): sin firma válida no se entra.
 *
 * Los fixtures se firman DE VERDAD con HMAC-SHA256 aquí mismo, así que la verificación se ejercita
 * completa sin cuenta de Stripe y sin red (AC15). Lo que se prueba no es que HMAC sea HMAC, es todo lo
 * que lo rodea: la ventana de tiempo, el header mal formado, el secreto equivocado y la rotación de
 * secretos — que es donde una implementación descuidada rechaza tráfico legítimo.
 */
import { describe, it, expect } from "vitest";
import {
  buildSignatureHeader,
  computeSignature,
  DEFAULT_TOLERANCE_SECONDS,
  parseSignatureHeader,
  verifyStripeSignature,
} from "@/lib/stripe/webhook-signature";

const SECRET = "whsec_test_secreto_correcto";
const OTRO_SECRETO = "whsec_test_secreto_de_otro_entorno";
const NOW = 1_800_000_000; // instante fijo: los tests no dependen del reloj
const BODY = Buffer.from(JSON.stringify({ id: "evt_1", type: "invoice.paid" }));

function firmado(secret: string, timestamp = NOW, body = BODY) {
  return buildSignatureHeader(timestamp, body, secret);
}

describe("E6 (AC8) — firma válida", () => {
  it("acepta un payload firmado con el secreto configurado y timestamp reciente", () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: firmado(SECRET),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: true, timestamp: NOW });
  });

  it("acepta si UNA de varias firmas v1 coincide (rotación de secreto)", () => {
    // Durante una rotación Stripe manda las firmas de los dos secretos. Quedarse con la primera
    // rechazaría tráfico legítimo justo en el momento más delicado.
    const header =
      `t=${NOW}` +
      `,v1=${computeSignature(NOW, BODY, OTRO_SECRETO)}` +
      `,v1=${computeSignature(NOW, BODY, SECRET)}`;
    const result = verifyStripeSignature({ rawBody: BODY, header, secret: SECRET, nowSeconds: NOW });
    expect(result.ok).toBe(true);
  });

  it("ignora esquemas desconocidos sin romperse", () => {
    const header = `t=${NOW},v0=deadbeef,v1=${computeSignature(NOW, BODY, SECRET)}`;
    expect(verifyStripeSignature({ rawBody: BODY, header, secret: SECRET, nowSeconds: NOW }).ok).toBe(
      true
    );
  });
});

describe("E6 (AC8) — firma inválida: 400 y ningún efecto", () => {
  it("rechaza una firma hecha con otro secreto", () => {
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: firmado(OTRO_SECRETO),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rechaza si el cuerpo cambió aunque sea un byte", () => {
    const header = firmado(SECRET);
    const manipulado = Buffer.from(JSON.stringify({ id: "evt_1", type: "invoice.payment_failed" }));
    const result = verifyStripeSignature({
      rawBody: manipulado,
      header,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rechaza sin header", () => {
    expect(
      verifyStripeSignature({ rawBody: BODY, header: undefined, secret: SECRET, nowSeconds: NOW })
    ).toEqual({ ok: false, reason: "missing_header" });
  });

  it("rechaza sin rawBody", () => {
    // Es el fallo más fácil de introducir: quitar el `verify` de `express.json` deja el HMAC ciego.
    // Debe ser un rechazo explícito y no un "pasa porque no hay nada que comparar".
    expect(
      verifyStripeSignature({
        rawBody: undefined,
        header: firmado(SECRET),
        secret: SECRET,
        nowSeconds: NOW,
      })
    ).toEqual({ ok: false, reason: "missing_raw_body" });
  });

  it("rechaza un header sin timestamp o con timestamp no numérico", () => {
    const soloFirma = `v1=${computeSignature(NOW, BODY, SECRET)}`;
    expect(
      verifyStripeSignature({ rawBody: BODY, header: soloFirma, secret: SECRET, nowSeconds: NOW })
        .ok
    ).toBe(false);

    const basura = `t=ayer,v1=${computeSignature(NOW, BODY, SECRET)}`;
    expect(
      verifyStripeSignature({ rawBody: BODY, header: basura, secret: SECRET, nowSeconds: NOW })
    ).toEqual({ ok: false, reason: "malformed_header" });
  });

  it("rechaza un header con timestamp pero sin ninguna firma", () => {
    expect(
      verifyStripeSignature({ rawBody: BODY, header: `t=${NOW}`, secret: SECRET, nowSeconds: NOW })
    ).toEqual({ ok: false, reason: "no_signatures" });
  });
});

describe("E6 (AC8) — ventana de tiempo", () => {
  it("acepta justo en el borde de la tolerancia", () => {
    const t = NOW - DEFAULT_TOLERANCE_SECONDS;
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: firmado(SECRET, t),
        secret: SECRET,
        nowSeconds: NOW,
      }).ok
    ).toBe(true);
  });

  it("rechaza una firma criptográficamente válida pero vieja (replay)", () => {
    // El punto de la ventana: una captura legítima de hace un mes sigue teniendo el HMAC correcto.
    const t = NOW - DEFAULT_TOLERANCE_SECONDS - 1;
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: firmado(SECRET, t),
        secret: SECRET,
        nowSeconds: NOW,
      })
    ).toEqual({ ok: false, reason: "timestamp_outside_tolerance" });
  });

  it("rechaza un timestamp del futuro lejano", () => {
    const t = NOW + DEFAULT_TOLERANCE_SECONDS + 1;
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: firmado(SECRET, t),
        secret: SECRET,
        nowSeconds: NOW,
      })
    ).toEqual({ ok: false, reason: "timestamp_outside_tolerance" });
  });

  it("la ventana se comprueba antes del HMAC: un replay viejo no revela si la firma cuadraba", () => {
    const t = NOW - 10_000;
    const result = verifyStripeSignature({
      rawBody: BODY,
      header: firmado(OTRO_SECRETO, t),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "timestamp_outside_tolerance" });
  });
});

describe("parseSignatureHeader", () => {
  it("tolera espacios y devuelve todas las v1", () => {
    const parsed = parseSignatureHeader("t=123, v1=aaa, v1=bbb, v0=ccc");
    expect(parsed.timestamp).toBe(123);
    expect(parsed.signatures).toEqual(["aaa", "bbb"]);
  });

  it("un header vacío no produce timestamp", () => {
    expect(parseSignatureHeader("").timestamp).toBeNull();
  });
});
