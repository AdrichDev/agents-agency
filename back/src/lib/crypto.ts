import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Payload cifrado AES-256-GCM.
 * Se persiste como JSON en el campo `credentials` de ChannelConnection.
 */
export interface EncryptedPayload {
  iv: string;      // hex, 12 bytes (96 bits — recomendado para GCM)
  authTag: string; // hex, 16 bytes
  data: string;    // hex, ciphertext
}

/** Carga y valida la clave desde env. Lanza si falta o tiene longitud incorrecta. */
function getKey(): Buffer {
  const raw = process.env.CHANNEL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("Configuración de cifrado incompleta: CHANNEL_ENCRYPTION_KEY no definida");
  }
  // Acepta hex (64 chars) o base64 (44 chars para 32 bytes)
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== 32) {
    throw new Error(
      `Configuración de cifrado incompleta: CHANNEL_ENCRYPTION_KEY debe ser 32 bytes (64 hex chars o base64 de 32 bytes), longitud actual: ${key.length}`
    );
  }
  return key;
}

/** Cifra un string con AES-256-GCM. Cada llamada usa un IV aleatorio distinto. */
export function encrypt(plain: string): EncryptedPayload {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    data: data.toString("hex"),
  };
}

/** Descifra un payload AES-256-GCM. Lanza si authTag no coincide (datos manipulados). */
export function decrypt(payload: EncryptedPayload): string {
  const key = getKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "hex")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
