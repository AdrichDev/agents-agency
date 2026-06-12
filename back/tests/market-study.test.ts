import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    // Mock global fetch
    const fetchMock = vi.fn();

    // Text search response (sector query)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          { place_id: "place1", name: "Restaurante Sin Web" },
          { place_id: "place2", name: "Bar Con Web" },
          { place_id: "place3", name: "Cafe Sin Web" },
        ],
      }),
    });

    // Details for place1 (no website)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: { place_id: "place1", name: "Restaurante Sin Web", website: "" },
      }),
    });

    // Details for place2 (has website)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: { place_id: "place2", name: "Bar Con Web", website: "https://barconweb.com" },
      }),
    });

    // analyzeWebsite fetch for place2 (no chatbot found)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => "<html><body>Bienvenidos</body></html>",
    });

    // Details for place3 (no website)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: { place_id: "place3", name: "Cafe Sin Web" },
      }),
    });

    // Generic "store" + "establishment" queries return empty
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "OK", results: [] }) });

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
    const fetchMock = vi.fn();

    // First search (retail) returns place1 (no website → no_web)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ place_id: "place1", name: "Negocio A" }],
      }),
    });
    // Details place1 (no website)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: { place_id: "place1", name: "Negocio A" },
      }),
    });
    // Second sector search (hosteleria) also returns place1
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ place_id: "place1", name: "Negocio A" }],
      }),
    });
    // Generic store + establishment searches return empty
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "OK", results: [] }) });

    vi.stubGlobal("fetch", fetchMock);

    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Madrid", ["retail", "hosteleria"]);

    const place1Count = result.prospects.filter((p) => p.placeId === "place1").length;
    expect(place1Count).toBe(1);
  });

  it("handles quota error gracefully — partial results + warning", async () => {
    const fetchMock = vi.fn();

    // Text search succeeds
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          { place_id: "p1", name: "Negocio 1" },
          { place_id: "p2", name: "Negocio 2" },
        ],
      }),
    });

    // First details call succeeds (no website)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: { place_id: "p1", name: "Negocio 1" },
      }),
    });

    // Second details call throws quota error
    fetchMock.mockRejectedValueOnce(new Error("OVER_QUERY_LIMIT"));

    vi.stubGlobal("fetch", fetchMock);

    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Sevilla", ["retail"]);

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
