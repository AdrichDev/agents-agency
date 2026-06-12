import { describe, it, expect, vi, afterEach } from "vitest";
import type { MarketStudyInputs, RealBusinessData } from "@/lib/market-study/types";

// SSRF guard usa dns.lookup; en tests lo resolvemos a una IP pública determinista.
vi.mock("node:dns", () => {
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  return { default: { promises: { lookup } }, promises: { lookup } };
});

// ── Fixtures ──────────────────────────────────────────────────────────────

const REAL_DATA: RealBusinessData = {
  acceptedBudgetCount: 5,
  totalAcceptedRevenue: 10000,
  avgAcceptedTicket: 2000,
  activeClientCount: 8,
  revenueByService: [],
  clientsBySector: [],
  revenueByServiceAndSector: [],
};

const INPUTS: MarketStudyInputs = {
  zone: "Salamanca",
  postalCode: "37001",
  radiusKm: 7,
  expansionZones: ["Valladolid"],
  targetSectors: ["restauración", "clínicas"],
};

// ── buildSystemPrompt: zone anchoring + concreteness + real pricing ──────

describe("study-generator: buildSystemPrompt zone & pricing", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("anchors every section to the zone and radius", async () => {
    const { buildSystemPrompt } = await import("@/lib/market-study/study-generator");
    const prompt = buildSystemPrompt(REAL_DATA, INPUTS);

    expect(prompt).toContain("Salamanca");
    expect(prompt).toContain("CP 37001");
    expect(prompt).toContain("7 km");
    expect(prompt).toContain("ANCLAJE GEOGRÁFICO");
    expect(prompt).toContain("CADA sección debe referirse explícitamente a Salamanca");
    expect(prompt).toContain("barrios, distritos, calles comerciales");
  });

  it("prohibits generic filler and hedging", async () => {
    const { buildSystemPrompt } = await import("@/lib/market-study/study-generator");
    const prompt = buildSystemPrompt(REAL_DATA, INPUTS);

    expect(prompt).toContain("PROHIBIDO el relleno genérico");
    expect(prompt).toContain("depende del mercado");
    expect(prompt).toContain("(estimación)");
    // Original anti-hallucination rules preserved
    expect(prompt).toContain("NUNCA inventes cifras");
    expect(prompt).toContain("NUNCA inventes competidores");
  });

  it("injects the real service catalog with exact prices", async () => {
    const { buildSystemPrompt } = await import("@/lib/market-study/study-generator");
    const { SERVICE_CATALOG } = await import("@/lib/service-catalog");
    const prompt = buildSystemPrompt(REAL_DATA, INPUTS);

    expect(prompt).toContain("CATÁLOGO DE SERVICIOS Y PRECIOS REALES");
    for (const service of SERVICE_CATALOG) {
      expect(prompt).toContain(service.name);
      expect(prompt).toContain(`${service.implPrice.toLocaleString("es-ES")} €`);
    }
    expect(prompt).toContain("PROHIBIDO inventar precios");
    expect(prompt).toContain("REGLAS DE PRICING");
  });
});

// ── email-extractor ───────────────────────────────────────────────────────

describe("email-extractor: extractEmails", () => {
  it("extracts emails from mailto links first", async () => {
    const { extractEmails } = await import("@/lib/market-study/email-extractor");
    const html = `
      <p>Escríbenos a info@agencia.es</p>
      <a href="mailto:hola@agencia.es">Contacto</a>
    `;
    const emails = extractEmails(html);
    expect(emails[0]).toBe("hola@agencia.es");
    expect(emails).toContain("info@agencia.es");
  });

  it("extracts plain-text emails", async () => {
    const { extractEmails } = await import("@/lib/market-study/email-extractor");
    expect(extractEmails("<p>contacto: ventas@empresa.com</p>")).toEqual(["ventas@empresa.com"]);
  });

  it("decodes URL-encoded mailto addresses", async () => {
    const { extractEmails } = await import("@/lib/market-study/email-extractor");
    const html = '<a href="mailto:hola%40agencia.es?subject=Hola">Email</a>';
    expect(extractEmails(html)).toEqual(["hola@agencia.es"]);
  });

  it("dedupes and lowercases", async () => {
    const { extractEmails } = await import("@/lib/market-study/email-extractor");
    const html = '<a href="mailto:Hola@Agencia.es">x</a> hola@agencia.es HOLA@AGENCIA.ES';
    expect(extractEmails(html)).toEqual(["hola@agencia.es"]);
  });

  it("filters asset filenames and junk domains", async () => {
    const { extractEmails } = await import("@/lib/market-study/email-extractor");
    const html = `
      <img src="logo@2x.png" /> icon@3x.jpg
      <script>e="error@sentry.io";x="test@example.com";</script>
      <p>real@negocio.es</p>
    `;
    expect(extractEmails(html)).toEqual(["real@negocio.es"]);
  });

  it("caps results at 3", async () => {
    const { extractEmails } = await import("@/lib/market-study/email-extractor");
    const html = "a@x.es b@x.es c@x.es d@x.es e@x.es";
    expect(extractEmails(html)).toHaveLength(3);
  });

  it("returns empty array for empty/no-email html", async () => {
    const { extractEmails } = await import("@/lib/market-study/email-extractor");
    expect(extractEmails("")).toEqual([]);
    expect(extractEmails("<p>sin correo aquí</p>")).toEqual([]);
  });
});

// ── scraper: fetchHtml timeout ────────────────────────────────────────────

describe("scraper: scrapeUrl/fetchHtml timeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("aborts the fetch after the timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, opts: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
      })
    ));
    const { scrapeUrl } = await import("@/lib/scraper/web");
    await expect(scrapeUrl("https://very-slow.example", 50)).rejects.toThrow();
  });

  it("passes an abort signal to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => "<html><body><main>Hola</main></body></html>",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { scrapeUrl } = await import("@/lib/scraper/web");
    const text = await scrapeUrl("https://example.com");
    expect(text).toBe("Hola");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

// ── competitors: radius filter + email column ─────────────────────────────

function jsonRes(body: unknown) {
  return { ok: true, json: async () => body };
}

describe("competitors: radius-aware search with email extraction", () => {
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("@/lib/openai");
  });

  it("findCompetitors drops results outside the action radius", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "fake-key";
    vi.resetModules();

    const center = { lat: 40.96, lng: -5.66 }; // Salamanca
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/textsearch/")) {
        return jsonRes({
          status: "OK",
          results: [
            { place_id: "near", name: "Agencia Cercana", rating: 4.0, geometry: { location: { lat: 40.97, lng: -5.65 } } },
            { place_id: "far", name: "Agencia Lejana", rating: 4.5, geometry: { location: { lat: 41.65, lng: -4.72 } } }, // Valladolid ~100km
          ],
        });
      }
      if (url.includes("/details/")) {
        return jsonRes({ status: "OK", result: { place_id: "near", name: "Agencia Cercana" } });
      }
      return jsonRes({ status: "ZERO_RESULTS", results: [] });
    }));

    const { findCompetitors } = await import("@/lib/market-study/competitors");
    const competitors = await findCompetitors("Salamanca", { center, radiusKm: 7 });

    const ids = competitors.map((c) => c.placeId);
    expect(ids).toContain("near");
    expect(ids).not.toContain("far");
  });

  it("buildCompetitorSection includes contact email extracted from competitor site", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "fake-key";
    vi.resetModules();

    vi.doMock("@/lib/openai", () => ({
      openai: {
        chat: {
          completions: {
            create: vi.fn().mockImplementation(async (params: any) => {
              const sys: string = params.messages[0]?.content ?? "";
              if (sys.includes("analista de mercado")) {
                return { choices: [{ message: { content: '["Chatbots IA", "Webs corporativas"]' } }] };
              }
              return { choices: [{ message: { content: "Análisis de diferenciación concreto." } }] };
            }),
          },
        },
      },
      STRONG_MODEL: "gpt-test",
      DEFAULT_MODEL: "gpt-test-mini",
    }));

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/geocode/")) {
        return jsonRes({ status: "OK", results: [{ geometry: { location: { lat: 40.96, lng: -5.66 } } }] });
      }
      if (url.includes("/textsearch/")) {
        return jsonRes({
          status: "OK",
          results: [{ place_id: "c1", name: "Agencia IA Salamanca", rating: 4.2, geometry: { location: { lat: 40.96, lng: -5.66 } } }],
        });
      }
      if (url.includes("/details/")) {
        return jsonRes({
          status: "OK",
          result: { place_id: "c1", name: "Agencia IA Salamanca", website: "https://agenciaia.example" },
        });
      }
      // Competitor website fetch (raw HTML with mailto)
      return {
        ok: true,
        text: async () => '<html><body><main>Servicios IA</main><a href="mailto:hola@agenciaia.es">Contacto</a></body></html>',
      };
    }));

    const { buildCompetitorSection } = await import("@/lib/market-study/competitors");
    const section = await buildCompetitorSection("Salamanca", INPUTS, true);

    expect(section.key).toBe("competitors");
    expect(section.markdown).toContain("| Competidor | Web | Email | Rating | Servicios detectados |");
    expect(section.markdown).toContain("hola@agenciaia.es");
    expect(section.markdown).toContain("Agencia IA Salamanca");
    expect(section.markdown).toContain("radio de 7 km");
  });
});

// ── places: searchProspects radius filter ─────────────────────────────────

describe("places: searchProspects strict radius filter", () => {
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("drops prospects verifiably outside the radius when geocode succeeds", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "fake-key";
    vi.resetModules();

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/geocode/")) {
        return jsonRes({ status: "OK", results: [{ geometry: { location: { lat: 40.96, lng: -5.66 } } }] });
      }
      if (url.includes("/textsearch/")) {
        expect(url).toContain("location=40.96,-5.66");
        expect(url).toContain("radius=7000");
        return jsonRes({
          status: "OK",
          results: [
            { place_id: "near", name: "Bar Cercano", rating: 4.0, geometry: { location: { lat: 40.97, lng: -5.65 } } },
            { place_id: "far", name: "Bar Lejano", rating: 4.0, geometry: { location: { lat: 41.65, lng: -4.72 } } },
          ],
        });
      }
      if (url.includes("/details/")) {
        return jsonRes({ status: "OK", result: { place_id: "near", name: "Bar Cercano", rating: 4.0 } });
      }
      return jsonRes({ status: "ZERO_RESULTS", results: [] });
    }));

    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Salamanca", ["restauración"], { radiusKm: 7, postalCode: "37001" });

    const ids = result.prospects.map((p) => p.placeId);
    expect(ids).toContain("near");
    expect(ids).not.toContain("far");
  });

  it("keeps legacy behavior (no geocode call) when no radius option is passed", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "fake-key";
    vi.resetModules();

    const fetchMock = vi.fn(async (url: string) => {
      expect(url).not.toContain("/geocode/");
      return jsonRes({ status: "OK", results: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Salamanca", ["retail"]);
    expect(result.prospects).toEqual([]);
  });
});
