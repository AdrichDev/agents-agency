import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// SSRF guard usa dns.lookup; en tests lo resolvemos a una IP pública determinista.
vi.mock("node:dns", () => {
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  return { default: { promises: { lookup } }, promises: { lookup } };
});

// ── website-analyzer: analyzeWebsite ──────────────────────────────────────

describe("analyzeWebsite: chatbot detection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("detects intercom signature → web_chatbot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><head><script src="https://widget.intercom.io/widget/abc"></script></head></html>',
    }));
    const { analyzeWebsite } = await import("@/lib/market-study/website-analyzer");
    const result = await analyzeWebsite("https://example.com");
    expect(result.websiteStatus).toBe("web_chatbot");
    expect(result.unverified).toBeUndefined();
  });

  it("detects crisp.chat signature → web_chatbot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><script>var s1=document.createElement("script");s1.async=true;s1.src="https://client.crisp.chat/l.js";</script></html>',
    }));
    const { analyzeWebsite } = await import("@/lib/market-study/website-analyzer");
    const result = await analyzeWebsite("https://example.com");
    expect(result.websiteStatus).toBe("web_chatbot");
  });

  it("no chatbot signature → web_no_chatbot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => "<html><body><h1>Restaurante El Bodegón</h1><p>Bienvenidos</p></body></html>",
    }));
    const { analyzeWebsite } = await import("@/lib/market-study/website-analyzer");
    const result = await analyzeWebsite("https://example.com");
    expect(result.websiteStatus).toBe("web_no_chatbot");
    expect(result.unverified).toBeUndefined();
  });

  it("fetch fails → web_no_chatbot + unverified: true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Network error")));
    const { analyzeWebsite } = await import("@/lib/market-study/website-analyzer");
    const result = await analyzeWebsite("https://example.com");
    expect(result.websiteStatus).toBe("web_no_chatbot");
    expect(result.unverified).toBe(true);
  });

  it("HTTP error response → web_no_chatbot + unverified: true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    }));
    const { analyzeWebsite } = await import("@/lib/market-study/website-analyzer");
    const result = await analyzeWebsite("https://example.com");
    expect(result.websiteStatus).toBe("web_no_chatbot");
    expect(result.unverified).toBe(true);
  });

  it("detects tawk.to signature → web_chatbot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => '<script>var Tawk_API=Tawk_API||{}; s1.src="https://embed.tawk.to/xxx";</script>',
    }));
    const { analyzeWebsite } = await import("@/lib/market-study/website-analyzer");
    const result = await analyzeWebsite("https://example.com");
    expect(result.websiteStatus).toBe("web_chatbot");
  });

  it("detects wa.me whatsapp widget signature → web_chatbot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body><a href="https://wa.me/34612345678">WhatsApp</a></body></html>',
    }));
    const { analyzeWebsite } = await import("@/lib/market-study/website-analyzer");
    const result = await analyzeWebsite("https://example.com");
    expect(result.websiteStatus).toBe("web_chatbot");
  });
});

// ── computeOpportunityScore ───────────────────────────────────────────────

describe("computeOpportunityScore: heuristic", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("no_web → 5", async () => {
    const { computeOpportunityScore } = await import("@/lib/market-study/website-analyzer");
    expect(computeOpportunityScore("no_web", false)).toBe(5);
  });

  it("web_no_chatbot verified → 4", async () => {
    const { computeOpportunityScore } = await import("@/lib/market-study/website-analyzer");
    expect(computeOpportunityScore("web_no_chatbot", false)).toBe(4);
  });

  it("web_no_chatbot unverified → 3", async () => {
    const { computeOpportunityScore } = await import("@/lib/market-study/website-analyzer");
    expect(computeOpportunityScore("web_no_chatbot", true)).toBe(3);
  });

  it("web_chatbot → 2", async () => {
    const { computeOpportunityScore } = await import("@/lib/market-study/website-analyzer");
    expect(computeOpportunityScore("web_chatbot", false)).toBe(2);
  });

  it("no_web + low rating (3.0) → 5 (clamped)", async () => {
    const { computeOpportunityScore } = await import("@/lib/market-study/website-analyzer");
    // base 5 + 1 rating bonus = 6 → clamped to 5
    expect(computeOpportunityScore("no_web", false, 3.0)).toBe(5);
  });

  it("web_no_chatbot + low rating (2.8) → 5", async () => {
    const { computeOpportunityScore } = await import("@/lib/market-study/website-analyzer");
    // base 4 + 1 = 5
    expect(computeOpportunityScore("web_no_chatbot", false, 2.8)).toBe(5);
  });

  it("web_no_chatbot + high rating (4.5) → 3", async () => {
    const { computeOpportunityScore } = await import("@/lib/market-study/website-analyzer");
    // base 4 - 1 = 3
    expect(computeOpportunityScore("web_no_chatbot", false, 4.5)).toBe(3);
  });

  it("web_chatbot + high rating (4.8) → 1 (clamped)", async () => {
    const { computeOpportunityScore } = await import("@/lib/market-study/website-analyzer");
    // base 2 - 1 = 1
    expect(computeOpportunityScore("web_chatbot", false, 4.8)).toBe(1);
  });

  it("no_web + mid rating (4.0) → 5 (no adjustment)", async () => {
    const { computeOpportunityScore } = await import("@/lib/market-study/website-analyzer");
    // rating 4.0 is between 3.5 and 4.2 → no adjustment
    expect(computeOpportunityScore("no_web", false, 4.0)).toBe(5);
  });

  it("web_chatbot + unverified + low rating → min 1", async () => {
    const { computeOpportunityScore } = await import("@/lib/market-study/website-analyzer");
    // base 2, unverified doesn't change for web_chatbot, low rating +1 → 3
    expect(computeOpportunityScore("web_chatbot", true, 2.0)).toBe(3);
  });
});

// ── classified prospects ──────────────────────────────────────────────────

describe("places: searchProspects classifies websiteStatus", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "fake-key";
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("assigns no_web status to prospects without website", async () => {
    const center = { latitude: 40.4168, longitude: -3.7038 }; // Madrid
    // Fetch order: geocode → searchText (New API). websiteUri comes in the search field mask.
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
            places: [{ id: "p1", displayName: { text: "Tienda Sin Web" }, rating: 4.0, location: center }],
          }),
        };
      }
      return { ok: true, text: async () => "<html></html>" };
    });

    vi.stubGlobal("fetch", fetchMock);

    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Madrid", ["tienda"]);

    const prospect = result.prospects.find((p) => p.placeId === "p1");
    expect(prospect).toBeDefined();
    expect(prospect?.websiteStatus).toBe("no_web");
    expect(prospect?.opportunityScore).toBe(5); // no_web, mid rating → 5
  });

  it("assigns web_no_chatbot to prospects with website and no chatbot", async () => {
    const center = { latitude: 40.4168, longitude: -3.7038 }; // Madrid
    // geocode → searchText (place carries websiteUri) → website HTML (no chatbot).
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
            places: [{ id: "p2", displayName: { text: "Bar Con Web Simple" }, rating: 3.8, location: center, websiteUri: "https://barconweb.com" }],
          }),
        };
      }
      // Website HTML with no chatbot signature.
      return { ok: true, text: async () => "<html><body>Bienvenidos al bar</body></html>" };
    });

    vi.stubGlobal("fetch", fetchMock);

    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Madrid", ["restauracion"]);

    const prospect = result.prospects.find((p) => p.placeId === "p2");
    expect(prospect).toBeDefined();
    expect(prospect?.websiteStatus).toBe("web_no_chatbot");
    expect(prospect?.websiteUrl).toBe("https://barconweb.com");
    expect(prospect?.opportunityScore).toBe(4);
  });

  it("assigns web_chatbot to prospects with chatbot detected", async () => {
    const center = { latitude: 40.4168, longitude: -3.7038 }; // Madrid
    // geocode → searchText (place carries websiteUri) → website HTML with intercom.
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
            places: [{ id: "p3", displayName: { text: "Hotel Con Chatbot" }, rating: 4.5, location: center, websiteUri: "https://hotel.com" }],
          }),
        };
      }
      // Website HTML with intercom chatbot signature.
      return { ok: true, text: async () => '<script src="https://widget.intercom.io/widget/xyz"></script>' };
    });

    vi.stubGlobal("fetch", fetchMock);

    const { searchProspects } = await import("@/lib/market-study/places");
    const result = await searchProspects("Madrid", ["hotel"]);

    const prospect = result.prospects.find((p) => p.placeId === "p3");
    expect(prospect).toBeDefined();
    expect(prospect?.websiteStatus).toBe("web_chatbot");
    // web_chatbot (2) + high rating 4.5 → 2 - 1 = 1
    expect(prospect?.opportunityScore).toBe(1);
  });
});

// ── competitors ───────────────────────────────────────────────────────────

describe("competitors: findCompetitors", () => {
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns up to 8 unique competitors from Places search", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "fake-key";
    vi.resetModules();

    // findCompetitors(zone) with no center → no geocode, no radius filter. It runs
    // the COMPETITOR_QUERIES via searchText (New API), then getPlaceDetails per hit.
    let searchCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("places:searchText")) {
        searchCalls++;
        const byCall: Record<number, any[]> = {
          1: [
            { id: "c1", displayName: { text: "Agencia IA Madrid" }, rating: 4.0 },
            { id: "c2", displayName: { text: "TechIA Solutions" }, rating: 3.5 },
          ],
          2: [{ id: "c3", displayName: { text: "Agencia IA" }, rating: 4.2 }],
          3: [{ id: "c4", displayName: { text: "Marketing Digital IA" }, rating: 3.8 }],
        };
        return { ok: true, json: async () => ({ places: byCall[searchCalls] ?? [] }) };
      }
      // getPlaceDetails per competitor (no website resolved).
      return { ok: true, json: async () => ({ id: "x", displayName: { text: "x" } }) };
    });

    vi.stubGlobal("fetch", fetchMock);

    const { findCompetitors } = await import("@/lib/market-study/competitors");
    const competitors = await findCompetitors("Madrid");

    expect(competitors.length).toBeGreaterThanOrEqual(3);
    expect(competitors.length).toBeLessThanOrEqual(8);
    const ids = competitors.map((c) => c.placeId);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
    expect(ids).toContain("c3");
  });

  it("deduplicates competitors across queries", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "fake-key";
    vi.resetModules();

    // All searchText queries return the same competitor → must dedup to one.
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("places:searchText")) {
        return {
          ok: true,
          json: async () => ({ places: [{ id: "c1", displayName: { text: "Same Agency" }, rating: 4.0 }] }),
        };
      }
      // getPlaceDetails (no website).
      return { ok: true, json: async () => ({ id: "c1", displayName: { text: "Same Agency" } }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { findCompetitors } = await import("@/lib/market-study/competitors");
    const competitors = await findCompetitors("Sevilla");

    const c1Count = competitors.filter((c) => c.placeId === "c1").length;
    expect(c1Count).toBe(1);
  });
});

describe("competitors: buildCompetitorSection degraded without Places key", () => {
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.resetModules();
  });

  it("returns degraded section when no Places key", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.resetModules();

    const { buildCompetitorSection } = await import("@/lib/market-study/competitors");
    const inputs = {
      zone: "Madrid", radiusKm: 10, expansionZones: [], targetSectors: ["restauracion"],
    };
    const section = await buildCompetitorSection("Madrid", inputs, false);

    expect(section.key).toBe("competitors");
    expect(section.markdown).toContain("GOOGLE_MAPS_API_KEY");
  });
});

// ── successScore persistence via PATCH ───────────────────────────────────

describe("market-studies PATCH /:id successScore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("patchSchema accepts successScore 1-5", async () => {
    const { z } = await import("zod");
    const patchSchema = z.object({
      title: z.string().min(1).optional(),
      successScore: z.number().int().min(1).max(5).nullable().optional(),
    });

    expect(patchSchema.safeParse({ successScore: 3 }).success).toBe(true);
    expect(patchSchema.safeParse({ successScore: 5 }).success).toBe(true);
    expect(patchSchema.safeParse({ successScore: 0 }).success).toBe(false);
    expect(patchSchema.safeParse({ successScore: 6 }).success).toBe(false);
    expect(patchSchema.safeParse({ successScore: null }).success).toBe(true);
    expect(patchSchema.safeParse({ title: "Updated" }).success).toBe(true);
  });
});

// ── study-generator: extractSuccessScore ────────────────────────────────

describe("study-generator: successScore extraction", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("generateStudy returns successScore from LLM response", async () => {
    vi.doMock("@/lib/openai", () => ({
      openai: {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValueOnce({
              choices: [{
                message: {
                  content: JSON.stringify({
                    sections: [
                      "executive_summary", "swot", "target_segments",
                      "zone_analysis", "suggested_pricing", "expansion_plan", "next_steps",
                      "action_plan", "recommended_options",
                    ].map((key) => ({ key, title: key, markdown: `Content ${key}` })),
                    successScore: 4,
                    successScoreRationale: "Good market conditions",
                  }),
                },
              }],
            }),
          },
        },
      },
      STRONG_MODEL: "gpt-test",
      DEFAULT_MODEL: "gpt-test-mini",
    }));

    const { generateStudy } = await import("@/lib/market-study/study-generator");
    const realData = {
      acceptedBudgetCount: 3,
      totalAcceptedRevenue: 6000,
      avgAcceptedTicket: 2000,
      activeClientCount: 5,
      revenueByService: [],
      clientsBySector: [],
      revenueByServiceAndSector: [],
    };
    const inputs = {
      zone: "Madrid", radiusKm: 5, expansionZones: [], targetSectors: ["retail"],
    };

    const result = await generateStudy(inputs, realData);
    expect(result.successScore).toBe(4);
    expect(result.sections.length).toBeGreaterThan(0);
  });

  it("generateStudy returns successScore null when missing from LLM", async () => {
    vi.doMock("@/lib/openai", () => ({
      openai: {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValueOnce({
              choices: [{
                message: {
                  content: JSON.stringify([
                    "executive_summary", "swot", "target_segments",
                    "zone_analysis", "suggested_pricing", "expansion_plan", "next_steps",
                    "action_plan", "recommended_options",
                  ].map((key) => ({ key, title: key, markdown: `Content ${key}` }))),
                },
              }],
            }),
          },
        },
      },
      STRONG_MODEL: "gpt-test",
      DEFAULT_MODEL: "gpt-test-mini",
    }));

    const { generateStudy } = await import("@/lib/market-study/study-generator");
    const inputs = {
      zone: "Madrid", radiusKm: 5, expansionZones: [], targetSectors: ["retail"],
    };
    const realData = {
      acceptedBudgetCount: 0, totalAcceptedRevenue: 0, avgAcceptedTicket: 0,
      activeClientCount: 0, revenueByService: [], clientsBySector: [], revenueByServiceAndSector: [],
    };

    const result = await generateStudy(inputs, realData);
    expect(result.successScore).toBeNull();
  });
});
