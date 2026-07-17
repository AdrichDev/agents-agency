/**
 * T1.2 (aa-knowledge-progreso-indexado) — el service escribe `progress`.
 *
 * `createIngestProgressWriter` traduce el callback (done,total) de `ingestWebsite`
 * a writes serializados de `initialIngest.progress` con status "pending" durante
 * la ingesta. El estado FINAL (indexed/empty/failed) reemplaza el initialIngest
 * entero → queda SIN `progress` obsoleto. `flush()` garantiza el orden.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));

import { prisma } from "@/lib/db";
import { createIngestProgressWriter, writeInitialIngestStatus } from "@/lib/agent/service";

const findUnique = prisma.agent.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.agent.update as ReturnType<typeof vi.fn>;

const URL = "https://negocio.test";

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({ ecommerceConfig: {} });
  update.mockResolvedValue({});
});

/** initialIngest del write en la posición `callIdx` (por defecto, el último). */
function writtenRecord(callIdx = update.mock.calls.length - 1) {
  const data = (update.mock.calls[callIdx][0] as { data: { ecommerceConfig: { initialIngest: any } } }).data;
  return data.ecommerceConfig.initialIngest;
}

describe("createIngestProgressWriter — progreso en vivo", () => {
  it("escribe initialIngest.progress con status 'pending' reflejando el avance", async () => {
    const w = createIngestProgressWriter("a1", URL);
    w.onProgress(0, 9);
    w.onProgress(3, 9);
    await w.flush();

    // 2 writes de progreso; el último refleja (3/9).
    expect(update).toHaveBeenCalledTimes(2);
    const last = writtenRecord();
    expect(last.status).toBe("pending");
    expect(last.progress).toEqual({ pagesDone: 3, pagesTotal: 9 });
    expect(last.url).toBe(URL);
  });

  it("los writes de progreso están serializados (flush espera a todos)", async () => {
    const w = createIngestProgressWriter("a1", URL);
    w.onProgress(1, 9);
    w.onProgress(2, 9);
    w.onProgress(3, 9);
    await w.flush();

    expect(update).toHaveBeenCalledTimes(3);
    expect(writtenRecord(0).progress).toEqual({ pagesDone: 1, pagesTotal: 9 });
    expect(writtenRecord(2).progress).toEqual({ pagesDone: 3, pagesTotal: 9 });
  });
});

describe("writeInitialIngestStatus — estado final sin progress incoherente", () => {
  it("el estado 'indexed' final NO arrastra progress (reemplazo completo)", async () => {
    await writeInitialIngestStatus("a1", { url: URL, status: "indexed", pages: 3, chunks: 12 });

    const rec = writtenRecord();
    expect(rec.status).toBe("indexed");
    expect(rec.chunks).toBe(12);
    expect(rec.progress).toBeUndefined();
  });

  it("progreso seguido de estado final: el final gana y queda sin progress", async () => {
    const w = createIngestProgressWriter("a1", URL);
    w.onProgress(9, 9);
    await w.flush();
    await writeInitialIngestStatus("a1", { url: URL, status: "indexed", pages: 9, chunks: 20 });

    const rec = writtenRecord();
    expect(rec.status).toBe("indexed");
    expect(rec.progress).toBeUndefined();
  });
});
