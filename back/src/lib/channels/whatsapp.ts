import { createHmac, timingSafeEqual } from "node:crypto";
import { toWhatsAppText } from "@/lib/channels/format";

const META_GRAPH_BASE = () =>
  `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}`;

/** Credenciales descifradas de WhatsApp */
export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
}

/** Estructura del evento webhook entrante de Meta */
export interface WhatsAppWebhookPayload {
  object: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id: string;
          from: string;
          type: string;
          text?: { body: string };
        }>;
        statuses?: Array<{ id: string; status: string }>;
      };
    }>;
  }>;
}

/** Resultado del parseo de un evento WhatsApp */
export interface ParsedWhatsAppMessage {
  messageId: string;
  from: string;
  text: string | null; // null si no es tipo text (imagen, audio, etc.)
}

/**
 * Verifica hub.challenge para el setup del webhook de Meta.
 * Devuelve el challenge si verifyToken coincide, null si no.
 */
export function verifyWebhookChallenge(
  query: Record<string, string | undefined>,
  storedVerifyToken: string
): string | null {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && token === storedVerifyToken && challenge) {
    return challenge;
  }
  return null;
}

/**
 * Valida la firma HMAC X-Hub-Signature-256.
 * Devuelve true si es válida (o si no hay rawBody para comparar).
 */
export function validateHmacSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  // Comparación en tiempo constante para prevenir ataques de timing
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/**
 * Extrae el primer mensaje de texto de un payload webhook de Meta.
 * Devuelve null si el evento no contiene mensajes (p. ej. solo statuses).
 */
export function parseWhatsAppEvent(
  payload: WhatsAppWebhookPayload
): ParsedWhatsAppMessage | null {
  const changes = payload.entry?.[0]?.changes?.[0]?.value;
  if (!changes) return null;
  // Eventos de estado (delivery/read receipt) — ignorar
  if (changes.statuses && !changes.messages) return null;
  const msg = changes.messages?.[0];
  if (!msg) return null;
  return {
    messageId: msg.id,
    from: msg.from,
    text: msg.type === "text" ? (msg.text?.body ?? null) : null,
  };
}

/** Parámetro de cuerpo de una plantilla WhatsApp (Meta `type:"template"`). */
export interface WhatsAppTemplateVar {
  type: "text";
  text: string;
}

/**
 * Envía una plantilla aprobada por la Graph API de Meta (`type:"template"`).
 *
 * A diferencia de `sendMessage` (mensaje de sesión, requiere ventana 24h), una
 * plantilla permite el PRIMER contacto business-initiated con un lead que aún no
 * ha escrito. La plantilla debe estar aprobada en Meta (proceso externo); si no,
 * la Graph API rechaza con error honesto.
 *
 * `bodyParams` rellena las variables {{1}},{{2}}... del cuerpo en orden. Si está
 * vacío, se omite `components` (plantilla sin variables).
 */
export async function sendTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  template: { name: string; language: string },
  bodyParams: string[]
): Promise<void> {
  const url = `${META_GRAPH_BASE()}/${phoneNumberId}/messages`;
  const components =
    bodyParams.length > 0
      ? [
          {
            type: "body",
            parameters: bodyParams.map<WhatsAppTemplateVar>((text) => ({ type: "text", text })),
          },
        ]
      : undefined;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        // components solo si hay variables; plantilla sin variables → se omite.
        ...(components ? { components } : {}),
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Error Graph API (${res.status}): ${detail}`);
  }
}

/**
 * Envía un mensaje de texto por la Graph API de Meta.
 */
export async function sendMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<void> {
  const url = `${META_GRAPH_BASE()}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      // WhatsApp usa *negrita* con un solo asterisco — convertir el Markdown del modelo
      text: { body: toWhatsAppText(text) },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Error Graph API (${res.status}): ${detail}`);
  }
}
