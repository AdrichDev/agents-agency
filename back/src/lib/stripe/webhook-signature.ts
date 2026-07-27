/**
 * H6 (aa-stripe-suscripciones, T3.1) — Verificación de la firma de un webhook de Stripe.
 *
 * ESTA FUNCIÓN ES LA ÚNICA AUTENTICACIÓN DEL WEBHOOK (design §D6).
 *
 * El endpoint vive fuera de `/api`, así que no pasa por el gate de token de Supabase ni por
 * `clientScopeGate`: quien llama es Stripe, que no tiene usuario. Lo que prueba que la petición es de
 * Stripe es este HMAC. Si falla, cualquiera con la URL podría marcar a un moroso como pagado.
 *
 * SOBRE `rawBody`, QUE NO ES UN DETALLE
 *
 * La firma se calcula sobre los BYTES EXACTOS que envió Stripe. Con el cuerpo ya parseado no se puede
 * verificar: `JSON.stringify(req.body)` no reproduce el original —orden de claves, espacios, escapes,
 * notación de números— y la comparación fallaría siempre. `express.json({ verify })` ya guarda el
 * buffer en `req.rawBody` (`index.ts:104`, puesto en su día para el HMAC de WhatsApp).
 *
 * Se implementa a mano en vez de usar `stripe.webhooks.constructEvent` porque así es una función pura,
 * sin instancia del SDK y por tanto sin clave secreta: los tests firman fixtures de verdad y verifican
 * de verdad, sin cuenta de Stripe y sin red (AC15).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Formato del header `Stripe-Signature`: `t=<unix>,v1=<hex>[,v1=<hex>...]`. */
export const STRIPE_SIGNATURE_HEADER = "stripe-signature";

/** Ventana de tolerancia del timestamp. Cinco minutos, el valor que recomienda Stripe. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
  | "missing_raw_body"
  | "missing_header"
  | "malformed_header"
  | "no_signatures"
  | "timestamp_outside_tolerance"
  | "signature_mismatch";

export type SignatureResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: SignatureFailure };

export interface VerifyInput {
  /** Bytes tal cual llegaron. */
  rawBody: Buffer | undefined;
  /** Contenido del header `Stripe-Signature`. */
  header: string | string[] | undefined;
  /** `STRIPE_WEBHOOK_SECRET` (`whsec_...`). Es DISTINTO en test y en live. */
  secret: string;
  toleranceSeconds?: number;
  /** Inyectable para que los tests sean deterministas sin tocar el reloj global. */
  nowSeconds?: number;
}

/**
 * Verifica la firma y devuelve el motivo del fallo en lugar de un booleano.
 *
 * El motivo se registra en el log del servidor pero **no se devuelve al cliente**: decirle a quien
 * prueba firmas si ha fallado por timestamp o por HMAC es regalarle un oráculo.
 */
export function verifyStripeSignature(input: VerifyInput): SignatureResult {
  const { rawBody, header, secret } = input;
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!rawBody || rawBody.length === 0) return { ok: false, reason: "missing_raw_body" };

  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return { ok: false, reason: "missing_header" };

  const parsed = parseSignatureHeader(raw);
  if (parsed.timestamp === null) return { ok: false, reason: "malformed_header" };
  if (parsed.signatures.length === 0) return { ok: false, reason: "no_signatures" };

  // El timestamp se comprueba ANTES del HMAC. Una firma legítima capturada y reenviada un mes después
  // sigue siendo criptográficamente válida: lo único que la invalida es la ventana. Se rechaza también
  // el futuro lejano, que sólo se puede dar con un reloj manipulado.
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { ok: false, reason: "timestamp_outside_tolerance" };
  }

  const expected = computeSignature(parsed.timestamp, rawBody, secret);
  // `some` y no `[0]`: durante una rotación de secreto Stripe manda varias `v1`, y quedarse con la
  // primera rechazaría entregas legítimas justo en el momento más delicado.
  const match = parsed.signatures.some((candidate) => safeEqualHex(expected, candidate));
  if (!match) return { ok: false, reason: "signature_mismatch" };

  return { ok: true, timestamp: parsed.timestamp };
}

/** `t=<unix>,v1=<hex>` → partes. Los esquemas desconocidos (`v0`, futuros) se ignoran. */
export function parseSignatureHeader(header: string): {
  timestamp: number | null;
  signatures: string[];
} {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t") {
      // `Number` acepta "" y devuelve 0; se exige que sean sólo dígitos.
      timestamp = /^\d+$/.test(value) ? Number(value) : null;
    } else if (key === "v1" && value.length > 0) {
      signatures.push(value);
    }
  }

  return { timestamp, signatures };
}

/**
 * HMAC-SHA256 hex de `<timestamp>.<rawBody>` con el secreto del endpoint.
 *
 * Exportada porque los tests la usan para FIRMAR sus fixtures. Que firma y verificación compartan esta
 * función es deliberado: lo que se está probando es el resto de la lógica (ventana, header mal formado,
 * secreto equivocado, rotación), no que HMAC-SHA256 sea HMAC-SHA256.
 */
export function computeSignature(timestamp: number, rawBody: Buffer, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
}

/** Construye el header que Stripe enviaría. Sólo para tests y utilidades. */
export function buildSignatureHeader(
  timestamp: number,
  rawBody: Buffer,
  secret: string
): string {
  return `t=${timestamp},v1=${computeSignature(timestamp, rawBody, secret)}`;
}

/** Comparación en tiempo constante. Longitudes distintas → false sin lanzar. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}
