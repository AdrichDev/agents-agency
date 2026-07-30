/**
 * La fuente de un fragmento solo sale hacia el modelo cuando es una URL
 * (aa-widget-3a-en-su-propia-web, T5.3).
 *
 * El agente de 3A respondía a un visitante "(fuente: servicios.md)", y a "cítame el
 * documento exacto del que lo lees" lo repetía. Prohibírselo en el prompt aguanta hasta que
 * alguien pregunta; por eso el nombre del fichero interno directamente no viaja.
 *
 * Se cubren los DOS caminos por los que el conocimiento sale de la base hacia el modelo:
 * la recuperación anticipada (`buildKnowledgeBlock`, en engine.test.ts) y la herramienta
 * `search_knowledge` (aquí). El tercer camino, `POST /api/knowledge/:agentId/search`, es del
 * panel del tenant —su propio documento— y NO se toca.
 */
import { describe, expect, it, vi } from "vitest";

const searchKnowledge = vi.fn();
vi.mock("@/lib/embeddings", async () => {
  const real = await vi.importActual<typeof import("@/lib/embeddings")>("@/lib/embeddings");
  return { ...real, searchKnowledge: (...args: unknown[]) => searchKnowledge(...args) };
});

import { publicSource } from "@/lib/embeddings";
import { executeTool } from "@/lib/agent/executor";

describe("publicSource", () => {
  it("deja pasar las URLs", () => {
    expect(publicSource("https://3aestudio.vercel.app/servicios")).toBe(
      "https://3aestudio.vercel.app/servicios",
    );
    expect(publicSource("http://ejemplo.es")).toBe("http://ejemplo.es");
  });

  it("descarta los documentos internos", () => {
    for (const fuente of ["servicios.md", "tarifas.pdf", "notas internas.docx", "proceso"]) {
      expect(publicSource(fuente)).toBeNull();
    }
  });

  it("descarta el vacío y el hueco", () => {
    expect(publicSource(null)).toBeNull();
    expect(publicSource(undefined)).toBeNull();
    expect(publicSource("   ")).toBeNull();
  });
});

describe("search_knowledge", () => {
  it("no devuelve la fuente cuando es un documento interno", async () => {
    searchKnowledge.mockResolvedValue([{ source: "servicios.md", content: "uno", distance: 0.1 }]);

    const out = (await executeTool("agente-1", "search_knowledge", { query: "servicios" })) as
      Record<string, unknown>[];

    // Se omite la clave entera, no se manda a null: una `source: null` seguiría anunciando
    // que hay un origen que no se está enseñando, y eso invita a preguntar por él.
    expect(out[0]).not.toHaveProperty("source");
    expect(JSON.stringify(out)).not.toContain("servicios.md");
    expect(out[0].content).toBe("uno");
  });

  it("devuelve la fuente cuando es una URL", async () => {
    searchKnowledge.mockResolvedValue([
      { source: "https://3aestudio.vercel.app", content: "dos", distance: 0.1 },
    ]);

    const out = (await executeTool("agente-1", "search_knowledge", { query: "servicios" })) as
      Record<string, unknown>[];

    expect(out[0].source).toBe("https://3aestudio.vercel.app");
  });
});
