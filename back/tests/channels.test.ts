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

// ── telegram.ts — sendMessage (reply_markup opcional, S14) ───────────────────

describe("sendMessage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ ok: true }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sin reply_markup envía el MISMO payload de siempre (llamadores existentes intactos)", async () => {
    const { sendMessage } = await import("@/lib/channels/telegram");
    await sendMessage("123:ABC", 42, "Hola");

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as { body: string };
    const payload = JSON.parse(init.body);
    expect(payload).toEqual({ chat_id: 42, text: "Hola", parse_mode: "HTML" });
    expect(payload).not.toHaveProperty("reply_markup");
  });
});

// ── telegram.ts — message_id del envío y editMessageText (S15, T8b) ──────────

/** fetch de Telegram que responde `respuestas` en orden (y `{ok:true}` al agotarse). */
function stubTelegram(...respuestas: unknown[]) {
  const fn = vi.fn(async (_url: string, _init?: { body?: string }) => ({
    json: async () => respuestas.shift() ?? { ok: true },
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function payloadDe(fn: { mock: { calls: unknown[][] } }, indice = 0) {
  const init = fn.mock.calls[indice][1] as { body?: string } | undefined;
  return JSON.parse(String(init?.body ?? "{}"));
}

describe("sendMessage devuelve el message_id (S15)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("devuelve result.message_id", async () => {
    stubTelegram({ ok: true, result: { message_id: 55 } });
    const { sendMessage } = await import("@/lib/channels/telegram");
    await expect(sendMessage("123:ABC", 42, "Hola")).resolves.toBe(55);
  });

  it("devuelve null si Telegram no manda message_id (se sigue trabajando sin editar)", async () => {
    stubTelegram({ ok: true, result: {} });
    const { sendMessage } = await import("@/lib/channels/telegram");
    await expect(sendMessage("123:ABC", 42, "Hola")).resolves.toBeNull();
  });

  it("PRESERVE: con reply_markup el reintento en texto plano sigue conservando el teclado", async () => {
    const fetchMock = stubTelegram(
      { ok: false, description: "Bad Request: can't parse entities" },
      { ok: true, result: { message_id: 9 } }
    );
    const teclado = { inline_keyboard: [[{ text: "✅ Confirmar", callback_data: "confirmar:abc" }]] };
    const { sendMessage } = await import("@/lib/channels/telegram");

    await expect(sendMessage("123:ABC", 42, "**Hola**", { replyMarkup: teclado })).resolves.toBe(9);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(payloadDe(fetchMock, 0)).toMatchObject({ text: "<b>Hola</b>", reply_markup: teclado });
    expect(payloadDe(fetchMock, 1)).toEqual({ chat_id: 42, text: "**Hola**", reply_markup: teclado });
  });
});

describe("editMessageText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sin reply_markup BORRA el teclado inline del mensaje", async () => {
    const fetchMock = stubTelegram({ ok: true, result: {} });
    const { editMessageText } = await import("@/lib/channels/telegram");

    await editMessageText("123:ABC", 42, 55, "⏳ Creando contacto…");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.telegram.org/bot123:ABC/editMessageText");
    expect(payloadDe(fetchMock)).toEqual({
      chat_id: 42,
      message_id: 55,
      text: "⏳ Creando contacto…",
      parse_mode: "HTML",
      // Telegram sólo quita el teclado con un inline_keyboard VACÍO.
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("cada edición lleva un tope de espera para no colgar la confirmación", async () => {
    const fetchMock = stubTelegram({ ok: true, result: {} });
    const { editMessageText, EDIT_TIMEOUT_MS } = await import("@/lib/channels/telegram");

    await editMessageText("123:ABC", 42, 55, "✅ Contacto creado");

    expect(EDIT_TIMEOUT_MS).toBe(5000);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("con reply_markup envía ese teclado", async () => {
    const fetchMock = stubTelegram({ ok: true, result: {} });
    const { editMessageText } = await import("@/lib/channels/telegram");

    await editMessageText("123:ABC", 42, 55, "Hola", {
      replyMarkup: { inline_keyboard: [[{ text: "A", callback_data: "a" }]] },
    });

    expect(payloadDe(fetchMock).reply_markup).toEqual({
      inline_keyboard: [[{ text: "A", callback_data: "a" }]],
    });
  });

  it("si Telegram rechaza el HTML reintenta en texto plano sin recuperar el teclado", async () => {
    const fetchMock = stubTelegram(
      { ok: false, description: "Bad Request: can't parse entities" },
      { ok: true, result: {} }
    );
    const { editMessageText } = await import("@/lib/channels/telegram");

    await editMessageText("123:ABC", 42, 55, "**Hola**");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(payloadDe(fetchMock, 0)).toMatchObject({ text: "<b>Hola</b>", parse_mode: "HTML" });
    expect(payloadDe(fetchMock, 1)).toEqual({
      chat_id: 42,
      message_id: 55,
      text: "**Hola**",
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("trata 'message is not modified' como éxito (no rompe el flujo)", async () => {
    stubTelegram(
      { ok: false, description: "Bad Request: message is not modified" },
      { ok: false, description: "Bad Request: message is not modified" }
    );
    const { editMessageText } = await import("@/lib/channels/telegram");
    await expect(editMessageText("123:ABC", 42, 55, "Hola")).resolves.toBeUndefined();
  });

  it("lanza si Telegram responde error", async () => {
    stubTelegram(
      { ok: false, description: "Bad Request: message to edit not found" },
      { ok: false, description: "Bad Request: message to edit not found" }
    );
    const { editMessageText } = await import("@/lib/channels/telegram");
    await expect(editMessageText("123:ABC", 42, 55, "Hola")).rejects.toThrow(/message to edit not found/);
  });
});
