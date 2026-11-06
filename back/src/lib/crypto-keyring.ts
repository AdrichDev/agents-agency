/**
 * F-19 (auditoría integral) — rotación de la clave de cifrado.
 *
 * Antes: todo se guardaba como `enc:v1:<payload>`. El prefijo decía la VERSIÓN del formato,
 * no QUÉ clave lo cifró, y solo existía `CHANNEL_ENCRYPTION_KEY`. El día que alguien rotara
 * esa clave (porque se filtró, porque cambió de proveedor, por higiene), **todo lo guardado
 * quedaba ilegible para siempre**: tokens de OAuth, claves de canal, credenciales de tenant.
 * En la práctica eso significa que rotar era imposible, que es peor que no rotar.
 *
 * Ahora cada valor nuevo se guarda como `enc:v2:<kid>:<payload>`, donde `kid` es una huella
 * corta y no secreta de la clave (sha256 de la clave, primeros 8 hex). Se acepta también una
 * clave ANTERIOR en `CHANNEL_ENCRYPTION_KEY_PREVIOUS`, así rotar es:
 *
 *   1. mover la clave actual a CHANNEL_ENCRYPTION_KEY_PREVIOUS,
 *   2. poner la nueva en CHANNEL_ENCRYPTION_KEY,
 *   3. desplegar: lo viejo se descifra con la anterior y lo nuevo se cifra con la nueva.
 *
 * Nada se migra en bloque ni se reescribe a ciegas.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const KEY_PREFIX = "enc:v2:";

/** Huella corta y NO secreta de la clave: sirve para saber cuál cifró, no para derivarla. */
export function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/** Respuesta estable para una clave mal configurada (no se registra su valor). */
function invalidKey(which: string, length: number): Error {
  return new Error(
    `Configuración de cifrado incompleta: ${which} debe ser 32 bytes (64 hex chars o base64 de 32 bytes), longitud actual: ${length}`,
  );
}

function parseKey(raw: string | undefined, which: string): Buffer | null {
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw invalidKey(which, key.length);
  return key;
}

/** Clave actual. Lanza si falta o es inválida (fail-closed, igual que antes). */
export function currentKey(): Buffer {
  const key = parseKey(process.env.CHANNEL_ENCRYPTION_KEY, "CHANNEL_ENCRYPTION_KEY");
  if (!key) {
    throw new Error("Configuración de cifrado incompleta: CHANNEL_ENCRYPTION_KEY no definida");
  }
  return key;
}

/** Clave anterior, opcional: solo para descifrar durante una rotación. */
export function previousKey(): Buffer | null {
  return parseKey(process.env.CHANNEL_ENCRYPTION_KEY_PREVIOUS, "CHANNEL_ENCRYPTION_KEY_PREVIOUS");
}

/** Cifra con la clave actual y devuelve `<kid>:<json base64>` (sin el prefijo `enc:v2:`). */
export function encryptWithKeyId(plain: string): { kid: string; body: string } {
  const key = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const payload = {
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    data: data.toString("hex"),
  };
  return { kid: keyId(key), body: Buffer.from(JSON.stringify(payload)).toString("base64") };
}

function decryptWith(key: Buffer, json: string): string {
  const payload = JSON.parse(json) as { iv: string; authTag: string; data: string };
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "hex"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "hex")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

/**
 * Descifra un `enc:v2:<kid>:<body>` probando la clave actual y, si no coincide, la anterior.
 * Lanza un error claro si ninguna sirve (nunca devuelve ciphertext ni texto vacío).
 */
export function decryptWithKeyring(stored: string): string {
  const rest = stored.slice(KEY_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep === -1) throw new Error("Valor enc:v2 mal formado: falta el identificador de clave");
  const kid = rest.slice(0, sep);
  const body = rest.slice(sep + 1);
  // El cuerpo viaja en base64: se decodifica ANTES de parsear el JSON.
  let json: string;
  try {
    json = Buffer.from(body, "base64").toString("utf8");
  } catch {
    throw new Error("Valor enc:v2 mal formado: el cuerpo no es base64 válido");
  }

  const candidates: Array<{ name: string; key: Buffer }> = [{ name: "actual", key: currentKey() }];
  const prev = previousKey();
  if (prev) candidates.push({ name: "anterior", key: prev });

  for (const candidate of candidates) {
    if (keyId(candidate.key) !== kid) continue;
    try {
      return decryptWith(candidate.key, json);
    } catch {
      throw new Error(
        "No se pudo descifrar con la clave indicada: el dato fue manipulado o la clave no corresponde",
      );
    }
  }

  throw new Error(
    `No hay ninguna clave configurada que corresponda a "${kid}". ` +
      "Si rotaste la clave, deja la anterior en CHANNEL_ENCRYPTION_KEY_PREVIOUS hasta re-cifrar.",
  );
}

/** true si el valor ya usa el formato con identificador de clave. */
export function isKeyIdFormat(value: string): boolean {
  return value.startsWith(KEY_PREFIX);
}
