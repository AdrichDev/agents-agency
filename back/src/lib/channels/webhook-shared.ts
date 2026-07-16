import { prisma } from "@/lib/db";
import { encrypt, decrypt, type EncryptedPayload } from "@/lib/crypto";

// Base pública HTTPS del back para los webhooks (Telegram/WhatsApp). Prioridad:
// PUBLIC_URL explícita > RENDER_EXTERNAL_URL (la expone Render automáticamente
// para servicios web) → en prod funciona sin configurar nada extra.
export const PUBLIC_URL = () =>
  (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL)?.replace(/\/$/, "");

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Cifra un objeto de credenciales. Lanza HTTP 500 si falta CHANNEL_ENCRYPTION_KEY. */
export function encryptCreds(creds: object): EncryptedPayload {
  return encrypt(JSON.stringify(creds));
}

/** Descifra credenciales almacenadas. */
export function decryptCreds<T>(raw: unknown): T {
  return JSON.parse(decrypt(raw as EncryptedPayload)) as T;
}

/**
 * Busca o crea una Conversation vinculada a un chat externo.
 * Usa metadata.externalId como clave canónica de búsqueda.
 */
export async function resolveConversation(
  agentId: string,
  channel: string,
  externalId: string,
  _extraMeta: Record<string, unknown>
): Promise<string | undefined> {
  const existing = await prisma.conversation.findFirst({
    where: {
      agentId,
      channel,
      metadata: { path: ["externalId"], equals: externalId },
    },
    orderBy: { createdAt: "desc" },
  });
  // Si no hay conversación previa, devuelve undefined para que chatWithAgent cree una nueva.
  return existing?.id;
}

/**
 * Mezcla claves en Conversation.metadata sin pisar las existentes (p. ej. leadFlow,
 * que chatWithAgent persiste en cada turno). Best-effort: nunca rompe la respuesta.
 */
export async function mergeConversationMetadata(
  conversationId: string,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { metadata: true },
    });
    const current = (conversation?.metadata as Record<string, unknown>) ?? {};
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: JSON.parse(JSON.stringify({ ...current, ...patch })) },
    });
  } catch {
    // best-effort
  }
}
