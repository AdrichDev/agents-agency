/**
 * F-19 — rotación de la clave de cifrado de agents-agency.
 *
 * El síntoma que esto evita: rotar `CHANNEL_ENCRYPTION_KEY` dejaba ilegibles todos los
 * tokens de OAuth y credenciales de canal ya guardados, así que en la práctica nadie
 * podía rotar.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import {
  keyId,
  encryptWithKeyId,
  decryptWithKeyring,
  isKeyIdFormat,
} from "@/lib/crypto-keyring";
import { encryptToken, decryptToken, isEncrypted } from "@/lib/integrations/oauth";

const K1 = randomBytes(32).toString("hex");
const K2 = randomBytes(32).toString("hex");

const saved = {
  current: process.env.CHANNEL_ENCRYPTION_KEY,
  previous: process.env.CHANNEL_ENCRYPTION_KEY_PREVIOUS,
};

beforeEach(() => {
  process.env.CHANNEL_ENCRYPTION_KEY = K1;
  delete process.env.CHANNEL_ENCRYPTION_KEY_PREVIOUS;
});
afterEach(() => {
  if (saved.current === undefined) delete process.env.CHANNEL_ENCRYPTION_KEY;
  else process.env.CHANNEL_ENCRYPTION_KEY = saved.current;
  if (saved.previous === undefined) delete process.env.CHANNEL_ENCRYPTION_KEY_PREVIOUS;
  else process.env.CHANNEL_ENCRYPTION_KEY_PREVIOUS = saved.previous;
});

describe("keyId", () => {
  it("es corto, estable y NO deriva de forma reversible", () => {
    const a = keyId(Buffer.from(K1, "hex"));
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(keyId(Buffer.from(K1, "hex"))).toBe(a);
    expect(keyId(Buffer.from(K2, "hex"))).not.toBe(a);
  });
});

describe("formato con identificador de clave", () => {
  it("cifra con la clave actual e indica cuál es", () => {
    const { kid, body } = encryptWithKeyId("token-secreto");
    expect(kid).toBe(keyId(Buffer.from(K1, "hex")));
    expect(body).not.toContain("token-secreto");
    expect(decryptWithKeyring(`enc:v2:${kid}:${body}`)).toBe("token-secreto");
  });

  it("el ciphertext usa un IV distinto en cada llamada", () => {
    const a = encryptWithKeyId("mismo-texto");
    const b = encryptWithKeyId("mismo-texto");
    expect(a.body).not.toBe(b.body);
  });

  it("tras rotar, lo viejo se descifra con la clave anterior y lo nuevo con la nueva", () => {
    const viejo = encryptWithKeyId("guardado-antes");
    const viejoStored = `enc:v2:${viejo.kid}:${viejo.body}`;

    // Rotación: la que era actual pasa a "anterior" y entra una nueva.
    process.env.CHANNEL_ENCRYPTION_KEY = K2;
    process.env.CHANNEL_ENCRYPTION_KEY_PREVIOUS = K1;

    expect(decryptWithKeyring(viejoStored)).toBe("guardado-antes");
    const nuevo = encryptWithKeyId("guardado-despues");
    expect(nuevo.kid).toBe(keyId(Buffer.from(K2, "hex")));
    expect(decryptWithKeyring(`enc:v2:${nuevo.kid}:${nuevo.body}`)).toBe("guardado-despues");
  });

  it("sin la clave que corresponde falla con un mensaje accionable (no devuelve basura)", () => {
    const { kid, body } = encryptWithKeyId("sin-clave");
    process.env.CHANNEL_ENCRYPTION_KEY = K2;
    delete process.env.CHANNEL_ENCRYPTION_KEY_PREVIOUS;
    expect(() => decryptWithKeyring(`enc:v2:${kid}:${body}`)).toThrow(/CHANNEL_ENCRYPTION_KEY_PREVIOUS/);
  });

  it("un dato manipulado se detecta (authTag de GCM)", () => {
    const { kid, body } = encryptWithKeyId("integro");
    const json = JSON.parse(Buffer.from(body, "base64").toString("utf-8"));
    json.data = json.data.replace(/^../, json.data.startsWith("00") ? "11" : "00");
    const manipulado = `enc:v2:${kid}:${Buffer.from(JSON.stringify(json)).toString("base64")}`;
    expect(() => decryptWithKeyring(manipulado)).toThrow(/manipulado|no corresponde/);
  });

  it("distingue el formato nuevo del viejo", () => {
    const { kid, body } = encryptWithKeyId("x");
    expect(isKeyIdFormat(`enc:v2:${kid}:${body}`)).toBe(true);
    expect(isKeyIdFormat("enc:v1:abc")).toBe(false);
  });
});

describe("oauth encryptToken / decryptToken (compatibilidad)", () => {
  it("lo nuevo se guarda como enc:v2 con clave identificada", () => {
    const stored = encryptToken("mi-token");
    expect(stored.startsWith("enc:v2:")).toBe(true);
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptToken(stored)).toBe("mi-token");
  });

  it("un valor enc:v1 guardado antes se sigue descifrando (no se rompe nada)", () => {
    // Se fabrica un v1 a mano con la misma clave actual, como lo haría la versión anterior.
    const legacy = buildLegacyV1("token-antiguo", K1);
    expect(decryptToken(legacy)).toBe("token-antiguo");
  });

  it("un valor sin prefijo (legacy en claro) se devuelve tal cual", () => {
    expect(decryptToken("token-en-claro")).toBe("token-en-claro");
  });
});

/** Construye `enc:v1:` con el formato exacto de la versión anterior, para probar compatibilidad. */
function buildLegacyV1(plain: string, keyHex: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createCipheriv, randomBytes: rb } = require("node:crypto") as typeof import("node:crypto");
  const key = Buffer.from(keyHex, "hex");
  const iv = rb(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const payload = {
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    data: data.toString("hex"),
  };
  return "enc:v1:" + Buffer.from(JSON.stringify(payload)).toString("base64");
}
