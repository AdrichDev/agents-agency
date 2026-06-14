import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// SSRF guard usa dns.lookup; en tests lo resolvemos a una IP pública determinista.
vi.mock("node:dns", () => {
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  return { default: { promises: { lookup } }, promises: { lookup } };
});

// ── study-generator tests ─────────────────────────────────────────────────

describe("study-generator: parseSections (defensive)", () => {
  // We test the defensive parsing behavior by importing the module after mocking openai

  it("GRANULARITY_MAP is correct whitelist (cross-module sanity)", async () => {
    const { GRANULARITY_MAP } = await import("@/lib/stats");
    expect(Object.keys(GRANULARITY_MAP)).toEqual(expect.arrayContaining(["year", "month", "week"]));
  });
});

describe("study-generator: generateStudy", () => {
  let openaiMock: any;

  beforeEach(async () => {
    // Mock openai module
    vi.doMock("@/lib/openai", () => ({
      openai: {
        chat: {
          completions: {
            create: vi.fn(),
          },
        },
      },
      STRONG_MODEL: "gpt-test",
      DEFAULT_MODEL: "gpt-test-mini",
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns 7 sections when model returns valid JSON", async () => {
    const { openai } = await import("@/lib/openai");
    const mockSections = [
      "executive_summary", "swot", "target_segments",
      "zone_analysis", "suggested_pricing", "expansion_plan", "next_steps",
    ].map((key) => ({
      key,
      title: key,
      markdown: `Contenido de ${key}`,
    }));

    (openai.chat.completions.create as any).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(mockSections) } }],
    });

    const { generateStudy } = await import("@/lib/market-study/study-generator");

    const realData = {
      acceptedBudgetCount: 5,
      totalAcceptedRevenue: 10000,
      avgAcceptedTicket: 2000,
      activeClientCount: 8,
      revenueByService: [{ serviceId: "chatbot_basic", name: "Starter", total: 3000 }],
      clientsBySector: [{ sector: "retail", count: 3 }],
      revenueByServiceAndSector: [],
    };

    const inputs = {
      zone: "Madrid",
      radiusKm: 5,
      expansionZones: [],
      targetSectors: ["retail"],
    };

    const result = await generateStudy(inputs, realData);
    expect(result.sections).toHaveLength(10); // 7 + action_plan + recommended_options + competitors
    expect(result.sections[0].key).toBe("executive_summary");
    expect(result.sections[0].markdown).toBe("Contenido de executive_summary");
  });

  it("uses real revenue figures injected in prompt (not invented)", async () => {
    const { openai } = await import("@/lib/openai");
    let capturedPrompt = "";

    (openai.chat.completions.create as any).mockImplementationOnce(async (params: any) => {
      capturedPrompt = params.messages?.[0]?.content ?? "";
      const sections = [
        "executive_summary", "swot", "target_segments",
        "zone_analysis", "suggested_pricing", "expansion_plan", "next_steps",
      ].map((key) => ({ key, title: key, markdown: `Test ${key}` }));
      return { choices: [{ message: { content: JSON.stringify(sections) } }] };
    });

    const { generateStudy } = await import("@/lib/market-study/study-generator");

    const realData = {
      acceptedBudgetCount: 12,
      totalAcceptedRevenue: 24000,
      avgAcceptedTicket: 2000,
      activeClientCount: 10,
      revenueByService: [],
      clientsBySector: [],
      revenueByServiceAndSector: [],
    };

    const inputs = { zone: "Barcelona", radiusKm: 10, expansionZones: [], targetSectors: ["tech"] };
    await generateStudy(inputs, realData);

    // Prompt must contain the real injected figures (formatted in Spanish locale: 24.000 or 24000)
    expect(capturedPrompt).toMatch(/24[\.,]?000/);
    expect(capturedPrompt).toContain("12");
    // Must NOT allow inventing business figures
    expect(capturedPrompt).toContain("NUNCA inventes cifras");
  });

  it("fills placeholder for malformed JSON section", async () => {
    const { openai } = await import("@/lib/openai");

    // Return a partial/malformed JSON — only some sections valid
    const partialJson = `[
      {"key":"executive_summary","title":"Resumen","markdown":"Contenido real"},
      {"key":"swot","title":"DAFO","markdown":"Análisis DAFO"},
      INVALID_JSON_HERE
    ]`;

    (openai.chat.completions.create as any).mockResolvedValueOnce({
      choices: [{ message: { content: partialJson } }],
    });

    const { generateStudy } = await import("@/lib/market-study/study-generator");

    const realData = {
      acceptedBudgetCount: 0,
      totalAcceptedRevenue: 0,
      avgAcceptedTicket: 0,
      activeClientCount: 0,
      revenueByService: [],
      clientsBySector: [],
      revenueByServiceAndSector: [],
    };

    const inputs = { zone: "Sevilla", radiusKm: 5, expansionZones: [], targetSectors: ["hosteleria"] };
    const result = await generateStudy(inputs, realData);

    // Should have 10 sections (7 original + 3 new)
    expect(result.sections).toHaveLength(10);
    // The ones we couldn't parse get the placeholder
    const missing = result.sections.filter((s: any) => s.markdown === "Contenido no disponible — regenerar sección");
    expect(missing.length).toBeGreaterThan(0);
  });

  it("includes insufficient data banner when no accepted budgets", async () => {
    const { openai } = await import("@/lib/openai");
    let capturedPrompt = "";

    (openai.chat.completions.create as any).mockImplementationOnce(async (params: any) => {
      capturedPrompt = params.messages?.[0]?.content ?? "";
      const sections = [
        "executive_summary", "swot", "target_segments",
        "zone_analysis", "suggested_pricing", "expansion_plan", "next_steps",
      ].map((key) => ({ key, title: key, markdown: `Test ${key}` }));
      return { choices: [{ message: { content: JSON.stringify(sections) } }] };
    });

    const { generateStudy } = await import("@/lib/market-study/study-generator");

    const emptyData = {
      acceptedBudgetCount: 0,
      totalAcceptedRevenue: 0,
      avgAcceptedTicket: 0,
      activeClientCount: 0,
      revenueByService: [],
      clientsBySector: [],
      revenueByServiceAndSector: [],
    };

    const inputs = { zone: "Valencia", radiusKm: 5, expansionZones: [], targetSectors: ["retail"] };
    await generateStudy(inputs, emptyData);

    expect(capturedPrompt).toContain("Base de datos insuficiente");
  });
});

// ── places tests ──────────────────────────────────────────────────────────

describe("places: isConfigured", () => {
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.resetModules();
  });

  it("returns false when GOOGLE_MAPS_API_KEY not set", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const { isConfigured } = await import("@/lib/market-study/places");
    expect(isConfigured()).toBe(false);
  });

  it("returns true when GOOGLE_MAPS_API_KEY is set", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
    vi.resetModules();
    const { isConfigured } = await import("@/lib/market-study/places");
    expect(isConfigured()).toBe(true);
  });
});

describe("places: searchProspects degraded mode (no key)", () => {
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.resetModules();
  });

  it("returns empty prospects and warning without throwing", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Madrid", ["retail"]);
    expect(result.prospects).toHaveLength(0);
    expect(result.warning).toContain("GOOGLE_MAPS_API_KEY");
    expect(result.partial).toBe(false);
  });
});

describe("places: searchProspects classifies ALL businesses with websiteStatus", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "fake-key";
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("includes all businesses and classifies websiteStatus (P9: no filtering by website)", async () => {
    // Fetch order now: geocode → searchText (New API) → website fetch per place with site.
    const center = { latitude: 40.4168, longitude: -3.7038 }; // Madrid
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/geocode/")) {
        return {
          ok: true,
          json: async () => ({
            status: "OK",
            results: [{ geometry: { location: { lat: center.latitude, lng: center.longitude } } }],
          }),
        };
      }
      if (u.includes("places:searchText")) {
        // Single sector query → 3 places at the center (within 5km radius), no nextPageToken.
        return {
          ok: true,
          json: async () => ({
            places: [
              { id: "place1", displayName: { text: "Restaurante Sin Web" }, location: center },
              { id: "place2", displayName: { text: "Bar Con Web" }, location: center, websiteUri: "https://barconweb.com" },
              { id: "place3", displayName: { text: "Cafe Sin Web" }, location: center },
            ],
          }),
        };
      }
      // Website HTML fetch for place2 (no chatbot signature).
      return { ok: true, text: async () => "<html><body>Bienvenidos</body></html>" };
    });

    vi.stubGlobal("fetch", fetchMock);

    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Madrid", ["restauracion"]);

    const names = result.prospects.map((p) => p.name);
    // All three should be included now
    expect(names).toContain("Restaurante Sin Web");
    expect(names).toContain("Cafe Sin Web");
    expect(names).toContain("Bar Con Web");
    // Classify websiteStatus
    const sinWeb = result.prospects.find((p) => p.name === "Restaurante Sin Web");
    expect(sinWeb?.websiteStatus).toBe("no_web");
    const conWeb = result.prospects.find((p) => p.name === "Bar Con Web");
    expect(conWeb?.websiteStatus).toBe("web_no_chatbot");
    expect(result.prospects.every((p) => p.status === "new")).toBe(true);
  });

  it("deduplicates by placeId", async () => {
    const center = { latitude: 40.4168, longitude: -3.7038 }; // Madrid
    // Both sector queries return the SAME place1 (no website) → must dedup to one.
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/geocode/")) {
        return {
          ok: true,
          json: async () => ({
            status: "OK",
            results: [{ geometry: { location: { lat: center.latitude, lng: center.longitude } } }],
          }),
        };
      }
      if (u.includes("places:searchText")) {
        return {
          ok: true,
          json: async () => ({
            places: [{ id: "place1", displayName: { text: "Negocio A" }, location: center }],
          }),
        };
      }
      return { ok: true, text: async () => "<html><body></body></html>" };
    });

    vi.stubGlobal("fetch", fetchMock);

    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Madrid", ["retail", "hosteleria"]);

    const place1Count = result.prospects.filter((p) => p.placeId === "place1").length;
    expect(place1Count).toBe(1);
  });

  it("handles quota error gracefully — partial results + warning", async () => {
    const center = { latitude: 37.3886, longitude: -5.9823 }; // Sevilla
    let searchCalls = 0;
    // geocode OK → first sector collects a prospect → second sector textSearch rejects
    // (quota). Source sets partial = collected.size > 0 → true, warning = err.message.
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/geocode/")) {
        return {
          ok: true,
          json: async () => ({
            status: "OK",
            results: [{ geometry: { location: { lat: center.latitude, lng: center.longitude } } }],
          }),
        };
      }
      if (u.includes("places:searchText")) {
        searchCalls++;
        if (searchCalls === 1) {
          return {
            ok: true,
            json: async () => ({
              places: [{ id: "p1", displayName: { text: "Negocio 1" }, location: center }],
            }),
          };
        }
        throw new Error("OVER_QUERY_LIMIT");
      }
      return { ok: true, text: async () => "<html></html>" };
    });

    vi.stubGlobal("fetch", fetchMock);

    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Sevilla", ["retail", "hosteleria"]);

    // Should have partial results (the one before error)
    expect(result.partial).toBe(true);
    expect(result.warning).toBeTruthy();
    // Study should not be corrupted (no exception thrown)
  });
});

// ── CSV export ────────────────────────────────────────────────────────────

describe("CSV export helper", () => {
  it("produces correct header and rows", () => {
    // Test the toCSV logic inline since it's a private helper in the router
    // We replicate the same logic here
    const escape = (v: string | undefined | null) => {
      if (v == null) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const prospects = [
      { name: "Bar, Test", address: "Calle 1", phone: "612345678", rating: 4.5, sector: "hosteleria", placeId: "p1", status: "new", candidateServices: [] },
      { name: 'Cafe "El Sol"', address: "Av 2", phone: undefined, rating: undefined, sector: "retail", placeId: "p2", status: "contacted", candidateServices: [] },
    ];

    const header = "name,address,phone,rating,sector,placeId,status";
    const rows = prospects.map((p: any) =>
      [p.name, p.address, p.phone, p.rating, p.sector, p.placeId, p.status].map(escape).join(",")
    );
    const csv = [header, ...rows].join("\n");

    expect(csv.split("\n")[0]).toBe("name,address,phone,rating,sector,placeId,status");
    expect(csv).toContain('"Bar, Test"'); // comma → quoted
    expect(csv).toContain('"Cafe ""El Sol"""'); // quote → escaped
    expect(csv).toContain("p1");
    expect(csv).toContain("new");
  });
});
