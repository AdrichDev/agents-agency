/**
 * H3 (aa-agente-ciclo-vida-publicacion, T3.6) — Un agente que estuvo publicado no se borra.
 *
 * El borrado en duro se lleva en cascada sus conversaciones, su consumo y su rastro de
 * estado: justo lo que hace falta para responder a una reclamación de factura. Se archiva.
 *
 * El control vive en el servicio, no en la ruta, para que lo hereden todas las vías (rutas,
 * scripts, automatizaciones futuras) sin acordarse de nada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/codes", () => ({
  nextClientCode: vi.fn(),
  nextQuoteNumber: vi.fn(),
  withCodeRetry: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock("@/lib/scraper/web", () => ({ ingestWebsite: vi.fn() }));
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));
vi.mock("@/lib/storage", () => ({
  avatarAction: vi.fn(() => ({ kind: "noop" })),
  uploadImageDataUrl: vi.fn(),
  deletePublicAsset: vi.fn(),
  deleteKbFolder: vi.fn(),
}));
vi.mock("@/lib/openclaw/provision", () => ({
  syncAgentProvisioning: vi.fn().mockResolvedValue({ ok: true }),
}));

import { prisma } from "@/lib/db";
import { deleteAgent } from "@/lib/agent/service";
import { deletePublicAsset } from "@/lib/storage";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.agent.delete).mockResolvedValue({ id: "a1" });
});

describe("T3.6 — guard de borrado por historial de publicación", () => {
  it("un draft que nunca se publicó se borra igual que antes del change", async () => {
    // No hay historia que conservar, y acumular basura tiene su propio coste.
    asMock(prisma.agent.findUnique).mockResolvedValue({ runtime: "openai", publishedAt: null });

    await expect(deleteAgent("a1")).resolves.toBeUndefined();

    expect(prisma.agent.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
    expect(deletePublicAsset).toHaveBeenCalled();
  });

  it("un agente publicado ⇒ 409 indicando archivar, y no se borra nada", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue({
      runtime: "openai",
      publishedAt: new Date("2026-06-01T10:00:00Z"),
    });

    await expect(deleteAgent("a1")).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/archív/i),
    });
    expect(prisma.agent.delete).not.toHaveBeenCalled();
    expect(deletePublicAsset).not.toHaveBeenCalled();
  });

  it("despublicar antes de borrar NO es una puerta de atrás", async () => {
    // Se comprueba `publishedAt` (la historia), no `status` (el ahora). Un agente que se
    // devolvió a draft conserva su publishedAt y sigue protegido.
    asMock(prisma.agent.findUnique).mockResolvedValue({
      runtime: "openai",
      publishedAt: new Date("2026-06-01T10:00:00Z"),
    });

    await expect(deleteAgent("a1")).rejects.toMatchObject({ status: 409 });

    // Y se comprueba que el select realmente pide publishedAt: sin eso el guard sería
    // silenciosamente inerte.
    expect(asMock(prisma.agent.findUnique).mock.calls[0][0].select).toHaveProperty("publishedAt");
  });
});
