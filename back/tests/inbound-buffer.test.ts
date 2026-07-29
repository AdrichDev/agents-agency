/**
 * T1.4 + T3.2 (aa-canales-buffer-y-respuesta-partida) — buffer de entrada.
 * Timers falsos de vitest. Cubre GWT4 (tope de mensajes), GWT6 (aislamiento por
 * conversación) y GWT5 (flush de apagado).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  bufferInbound,
  flushAllInbound,
  clampBufferWindowMs,
  inboundKey,
  pendingInboundCount,
  resetInboundBuffers,
  INBOUND_BUFFER_MAX_MS,
  INBOUND_BUFFER_MAX_MESSAGES,
} from "@/lib/channels/inbound-buffer";

/** Deja correr las microtareas pendientes tras disparar un timer. */
const settle = () => Promise.resolve().then(() => Promise.resolve());

describe("clampBufferWindowMs", () => {
  it("trata cualquier valor no positivo como desactivado", () => {
    expect(clampBufferWindowMs(0)).toBe(0);
    expect(clampBufferWindowMs(-1)).toBe(0);
    expect(clampBufferWindowMs(null)).toBe(0);
    expect(clampBufferWindowMs(undefined)).toBe(0);
    expect(clampBufferWindowMs(Number.NaN)).toBe(0);
  });

  it("recorta al techo de la ventana (AD5)", () => {
    expect(clampBufferWindowMs(90_000)).toBe(INBOUND_BUFFER_MAX_MS);
    expect(clampBufferWindowMs(3_000)).toBe(3_000);
  });
});

describe("bufferInbound", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetInboundBuffers();
  });

  afterEach(() => {
    resetInboundBuffers();
    vi.useRealTimers();
  });

  it("agrupa los mensajes de la ventana en un solo flush (AC1)", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const key = inboundKey("whatsapp", "ag1", "34600000000");

    bufferInbound(key, "hola", 3_000, flush);
    vi.advanceTimersByTime(500);
    bufferInbound(key, "oye", 3_000, flush);
    vi.advanceTimersByTime(500);
    bufferInbound(key, "¿abrís hoy?", 3_000, flush);

    // Aún dentro de la ventana: nadie ha respondido.
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3_000);
    await settle();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(["hola", "oye", "¿abrís hoy?"]);
  });

  it("cada mensaje reinicia la ventana", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const key = inboundKey("telegram", "ag1", "111");

    bufferInbound(key, "a", 1_000, flush);
    vi.advanceTimersByTime(900);
    bufferInbound(key, "b", 1_000, flush);
    vi.advanceTimersByTime(900);

    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    await settle();

    expect(flush).toHaveBeenCalledWith(["a", "b"]);
  });

  // GWT4
  it("dispara al llegar al tope de mensajes sin esperar la ventana", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const key = inboundKey("whatsapp", "ag1", "34600000001");

    for (let i = 0; i < INBOUND_BUFFER_MAX_MESSAGES; i++) {
      bufferInbound(key, `m${i}`, INBOUND_BUFFER_MAX_MS, flush);
    }
    await settle();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0]).toHaveLength(INBOUND_BUFFER_MAX_MESSAGES);
    expect(pendingInboundCount()).toBe(0);
  });

  it("no difiere el grupo más allá del tope absoluto", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const key = inboundKey("whatsapp", "ag1", "34600000002");

    // Un mensaje cada 5 s reinicia la ventana indefinidamente si no hay deadline.
    for (let i = 0; i < 8; i++) {
      bufferInbound(key, `m${i}`, 10_000, flush);
      vi.advanceTimersByTime(5_000);
      await settle();
    }

    expect(flush).toHaveBeenCalled();
  });

  // GWT6
  it("no mezcla conversaciones distintas", async () => {
    const flushA = vi.fn().mockResolvedValue(undefined);
    const flushB = vi.fn().mockResolvedValue(undefined);

    bufferInbound(inboundKey("whatsapp", "ag1", "aaa"), "soy A", 1_000, flushA);
    bufferInbound(inboundKey("whatsapp", "ag1", "bbb"), "soy B", 1_000, flushB);

    vi.advanceTimersByTime(1_000);
    await settle();

    expect(flushA).toHaveBeenCalledWith(["soy A"]);
    expect(flushB).toHaveBeenCalledWith(["soy B"]);
  });

  it("el mismo chat en canales distintos no comparte buffer", async () => {
    const flushWa = vi.fn().mockResolvedValue(undefined);
    const flushTg = vi.fn().mockResolvedValue(undefined);

    bufferInbound(inboundKey("whatsapp", "ag1", "123"), "wa", 1_000, flushWa);
    bufferInbound(inboundKey("telegram", "ag1", "123"), "tg", 1_000, flushTg);

    vi.advanceTimersByTime(1_000);
    await settle();

    expect(flushWa).toHaveBeenCalledWith(["wa"]);
    expect(flushTg).toHaveBeenCalledWith(["tg"]);
  });

  it("los mensajes que llegan durante el flush abren una ventana nueva", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const key = inboundKey("whatsapp", "ag1", "34600000003");

    bufferInbound(key, "primero", 1_000, flush);
    vi.advanceTimersByTime(1_000);
    await settle();

    bufferInbound(key, "segundo", 1_000, flush);
    vi.advanceTimersByTime(1_000);
    await settle();

    expect(flush).toHaveBeenNthCalledWith(1, ["primero"]);
    expect(flush).toHaveBeenNthCalledWith(2, ["segundo"]);
  });

  it("un flush que revienta no tumba el proceso ni deja el grupo colgado", async () => {
    const flush = vi.fn().mockRejectedValue(new Error("LLM caído"));
    const key = inboundKey("whatsapp", "ag1", "34600000004");

    bufferInbound(key, "hola", 1_000, flush);
    vi.advanceTimersByTime(1_000);
    await settle();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(pendingInboundCount()).toBe(0);
  });
});

// GWT5 (T3.2)
describe("flushAllInbound", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetInboundBuffers();
  });

  afterEach(() => {
    resetInboundBuffers();
    vi.useRealTimers();
  });

  it("procesa lo pendiente en vez de perderlo al apagar", async () => {
    const flushA = vi.fn().mockResolvedValue(undefined);
    const flushB = vi.fn().mockResolvedValue(undefined);

    bufferInbound(inboundKey("whatsapp", "ag1", "aaa"), "pendiente A", 30_000, flushA);
    bufferInbound(inboundKey("telegram", "ag2", "bbb"), "pendiente B", 30_000, flushB);
    expect(pendingInboundCount()).toBe(2);

    const grupos = await flushAllInbound();

    expect(grupos).toBe(2);
    expect(flushA).toHaveBeenCalledWith(["pendiente A"]);
    expect(flushB).toHaveBeenCalledWith(["pendiente B"]);
    expect(pendingInboundCount()).toBe(0);
  });

  it("sin nada pendiente no hace nada", async () => {
    await expect(flushAllInbound()).resolves.toBe(0);
  });
});
