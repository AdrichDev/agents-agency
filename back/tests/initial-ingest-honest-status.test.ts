/**
 * F2 (aa-rag-extraccion-estatica-honesta) — refreshInitialIngestStatus honesto.
 *
 * El re-indexado manual de la web inicial nunca marca `indexed` con 0 chunks:
 * 0 → `empty` + reason; >0 → `indexed`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));

import { prisma } from "@/lib/db";
import { refreshInitialIngestStatus } from "@/lib/agent/service";

const findUnique = prisma.agent.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.agent.update as ReturnType<typeof vi.fn>;

const URL = "https://negocio.test";

beforeEach(() => {
  vi.clearAllMocks();
  // La web coincide con la initialIngest actual (si no, es no-op).
  findUnique.mockResolvedValue({ ecommerceConfig: { initialIngest: { url: URL, status: "pending" } } });
  update.mockResolvedValue({});
});

function writtenRecord() {
  const data = (update.mock.calls[0][0] as { data: { ecommerceConfig: { initialIngest: any } } }).data;
  return data.ecommerceConfig.initialIngest;
}

describe("refreshInitialIngestStatus", () => {
  it("0 chunks → status 'empty' + reason (nunca 'indexed')", async () => {
    await refreshInitialIngestStatus("a1", URL, { pages: 0, chunks: 0, reason: "no_readable_text" });

    const rec = writtenRecord();
    expect(rec.status).toBe("empty");
    expect(rec.reason).toBe("no_readable_text");
    expect(rec.status).not.toBe("indexed");
  });

  it("0 chunks sin reason explícito → reason por defecto 'no_readable_text'", async () => {
    await refreshInitialIngestStatus("a1", URL, { pages: 0, chunks: 0 });

    expect(writtenRecord().reason).toBe("no_readable_text");
  });

  it(">0 chunks → status 'indexed' con pages/chunks", async () => {
    await refreshInitialIngestStatus("a1", URL, { pages: 3, chunks: 12 });

    const rec = writtenRecord();
    expect(rec.status).toBe("indexed");
    expect(rec.chunks).toBe(12);
    expect(rec.pages).toBe(3);
  });

  it("no-op si la URL no coincide con la web inicial", async () => {
    findUnique.mockResolvedValue({ ecommerceConfig: { initialIngest: { url: "https://otra.test", status: "indexed" } } });

    await refreshInitialIngestStatus("a1", URL, { pages: 0, chunks: 0 });

    expect(update).not.toHaveBeenCalled();
  });
});
