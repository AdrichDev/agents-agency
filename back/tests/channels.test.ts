import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── crypto.ts ─────────────────────────────────────────────────────────────────

describe("crypto — encrypt/decrypt roundtrip", () => {
  const validKey = "a".repeat(64); // 64 hex chars = 32 bytes

  beforeEach(() => {
    process.env.CHANNEL_ENCRYPTION_KEY = validKey;
  });

  afterEach(() => {
    delete process.env.CHANNEL_ENCRYPTION_KEY;
    vi.resetModules();
  });

  it("decrypt(encrypt(x)) === x", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const plain = JSON.stringify({ token: "123456:ABC-DEFGH" });
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("cada llamada a encrypt genera un IV diferente", async () => {
    const { encrypt } = await import("@/lib/crypto");
    const a = encrypt("hello");
    const b = encrypt("hello");
    expect(a.iv).not.toBe(b.iv);
  });

  it("decrypt lanza si authTag está manipulado", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const payload = encrypt("secreto");
    // Corromper authTag
    const tampered = { ...payload, authTag: "00".repeat(16) };
    expect(() => decrypt(tampered)).toThrow();
  });

  it("encrypt lanza si CHANNEL_ENCRYPTION_KEY no está definida", async () => {
    delete process.env.CHANNEL_ENCRYPTION_KEY;
    const { encrypt } = await import("@/lib/crypto");
    expect(() => encrypt("test")).toThrow(/cifrado incompleta/);
  });

  it("encrypt lanza si CHANNEL_ENCRYPTION_KEY tiene longitud incorrecta", async () => {
    process.env.CHANNEL_ENCRYPTION_KEY = "abc"; // muy corta
    const { encrypt } = await import("@/lib/crypto");
    expect(() => encrypt("test")).toThrow(/cifrado incompleta/);
  });
});

// ── dedup.ts ──────────────────────────────────────────────────────────────────

describe("dedup — idempotencia en memoria", () => {
  it("wasProcessed es false antes de markProcessed", async () => {
    const { wasProcessed } = await import("@/lib/channels/dedup");
    expect(wasProcessed("key-nuevo")).toBe(false);
  });

  it("wasProcessed es true justo después de markProcessed", async () => {
    const { wasProcessed, markProcessed } = await import("@/lib/channels/dedup");
    markProcessed("key-a");
    expect(wasProcessed("key-a")).toBe(true);
  });

  it("claves distintas son independientes", async () => {
    const { wasProcessed, markProcessed } = await import("@/lib/channels/dedup");
    markProcessed("key-b");
    expect(wasProcessed("key-c")).toBe(false);
  });

  it("wasProcessed es false cuando TTL expiró", async () => {
    const { wasProcessed, markProcessed } = await import("@/lib/channels/dedup");
    const pastTime = Date.now() - 25 * 60 * 60 * 1000; // 25 horas atrás
    markProcessed("key-expired", pastTime);
    expect(wasProcessed("key-expired")).toBe(false);
  });
});

// ── telegram.ts — parseTelegramUpdate ────────────────────────────────────────

describe("parseTelegramUpdate", () => {
  it("extrae chatId y text de un update con message.text", async () => {
    const { parseTelegramUpdate } = await import("@/lib/channels/telegram");
    const update = {
      update_id: 1001,
      message: {
        message_id: 5,
        chat: { id: 123456789 },
        text: "Hola, ¿cómo estás?",
      },
    };
    const parsed = parseTelegramUpdate(update);
    expect(parsed).not.toBeNull();
    expect(parsed!.chatId).toBe(123456789);
    expect(parsed!.text).toBe("Hola, ¿cómo estás?");
    expect(parsed!.updateId).toBe(1001);
  });

  it("text es null para un update con foto (sin message.text)", async () => {
    const { parseTelegramUpdate } = await import("@/lib/channels/telegram");
    const update = {
      update_id: 1002,
      message: {
        message_id: 6,
        chat: { id: 999 },
        photo: [{ file_id: "abc" }],
        // sin campo text
      },
    };
    const parsed = parseTelegramUpdate(update as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toBeNull();
  });

  it("devuelve null si el update no tiene message ni edited_message", async () => {
    const { parseTelegramUpdate } = await import("@/lib/channels/telegram");
    const update = { update_id: 1003, callback_query: { id: "x" } };
    expect(parseTelegramUpdate(update as any)).toBeNull();
  });
});

// ── whatsapp.ts — verifyWebhookChallenge ─────────────────────────────────────

describe("verifyWebhookChallenge", () => {
  it("devuelve el challenge cuando verify_token coincide", async () => {
    const { verifyWebhookChallenge } = await import("@/lib/channels/whatsapp");
    const query = {
      "hub.mode": "subscribe",
      "hub.verify_token": "mi-token",
      "hub.challenge": "abc123",
    };
    expect(verifyWebhookChallenge(query, "mi-token")).toBe("abc123");
  });

  it("devuelve null cuando verify_token no coincide", async () => {
    const { verifyWebhookChallenge } = await import("@/lib/channels/whatsapp");
    const query = {
      "hub.mode": "subscribe",
      "hub.verify_token": "otro-token",
      "hub.challenge": "abc123",
    };
    expect(verifyWebhookChallenge(query, "mi-token")).toBeNull();
  });

  it("devuelve null si hub.mode no es subscribe", async () => {
    const { verifyWebhookChallenge } = await import("@/lib/channels/whatsapp");
    const query = {
      "hub.mode": "unsubscribe",
      "hub.verify_token": "mi-token",
      "hub.challenge": "abc123",
    };
    expect(verifyWebhookChallenge(query, "mi-token")).toBeNull();
  });
});

// ── whatsapp.ts — parseWhatsAppEvent ─────────────────────────────────────────

describe("parseWhatsAppEvent", () => {
  it("extrae from y text de un mensaje de tipo text", async () => {
    const { parseWhatsAppEvent } = await import("@/lib/channels/whatsapp");
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.xxx",
                    from: "34612345678",
                    type: "text",
                    text: { body: "Hola desde WhatsApp" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const parsed = parseWhatsAppEvent(payload as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.from).toBe("34612345678");
    expect(parsed!.text).toBe("Hola desde WhatsApp");
    expect(parsed!.messageId).toBe("wamid.xxx");
  });

  it("text es null para un mensaje de tipo image", async () => {
    const { parseWhatsAppEvent } = await import("@/lib/channels/whatsapp");
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.img",
                    from: "34612345678",
                    type: "image",
                    image: { id: "img123" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const parsed = parseWhatsAppEvent(payload as any);
    expect(parsed!.text).toBeNull();
  });

  it("devuelve null para un evento statuses (delivery receipt)", async () => {
    const { parseWhatsAppEvent } = await import("@/lib/channels/whatsapp");
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: "wamid.yyy", status: "delivered" }],
              },
            },
          ],
        },
      ],
    };
    expect(parseWhatsAppEvent(payload as any)).toBeNull();
  });
});

// ── whatsapp.ts — validateHmacSignature ──────────────────────────────────────

describe("validateHmacSignature", () => {
  it("valida firma HMAC correcta", async () => {
    const { validateHmacSignature } = await import("@/lib/channels/whatsapp");
    const { createHmac } = await import("node:crypto");
    const appSecret = "mi_app_secret";
    const body = Buffer.from('{"object":"test"}');
    const sig = "sha256=" + createHmac("sha256", appSecret).update(body).digest("hex");
    expect(validateHmacSignature(body, sig, appSecret)).toBe(true);
  });

  it("rechaza firma HMAC alterada", async () => {
    const { validateHmacSignature } = await import("@/lib/channels/whatsapp");
    const body = Buffer.from('{"object":"test"}');
    expect(validateHmacSignature(body, "sha256=00000000", "secret")).toBe(false);
  });

  it("rechaza si no hay header de firma", async () => {
    const { validateHmacSignature } = await import("@/lib/channels/whatsapp");
    const body = Buffer.from("test");
    expect(validateHmacSignature(body, undefined, "secret")).toBe(false);
  });
});
