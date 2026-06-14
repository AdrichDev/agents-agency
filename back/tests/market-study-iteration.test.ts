import { describe, it, expect, vi, afterEach } from "vitest";
import type { Prospect, StudySection } from "@/lib/market-study/types";

// ── Shared fixtures ───────────────────────────────────────────────────────

const REAL_DATA = {
  acceptedBudgetCount: 5,
  totalAcceptedRevenue: 10000,
  avgAcceptedTicket: 2000,
  activeClientCount: 8,
  revenueByService: [],
  clientsBySector: [],
  revenueByServiceAndSector: [],
};

const INPUTS = { zone: "Madrid", radiusKm: 5, expansionZones: [], targetSectors: ["retail"] };

const VALID_SECTIONS_JSON = JSON.stringify({
  sections: [
    "executive_summary", "swot", "target_segments",
    "zone_analysis", "suggested_pricing", "expansion_plan", "next_steps",
    "action_plan", "recommended_options",
  ].map((key) => ({ key, title: key, markdown: `Content ${key}` })),
  successScore: 3,
});

function mockOpenAI(capture: { messages: any[] }) {
  vi.doMock("@/lib/openai", () => ({
    openai: {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            capture.messages = params.messages;
            return { choices: [{ message: { content: VALID_SECTIONS_JSON } }] };
          }),
        },
      },
    },
    STRONG_MODEL: "gpt-test",
    DEFAULT_MODEL: "gpt-test-mini",
  }));
}

// ── generateStudy: iterative prompt ───────────────────────────────────────

describe("generateStudy: iterative mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("includes previous sections, feedback and iterate instruction in the prompt", async () => {
    const capture = { messages: [] as any[] };
    mockOpenAI(capture);

    const { generateStudy } = await import("@/lib/market-study/study-generator");

    const previousSections: StudySection[] = [
      { key: "swot", title: "Análisis DAFO", markdown: "Contenido DAFO previo con edición manual" },
      { key: "next_steps", title: "Próximos Pasos", markdown: "Pasos previos del estudio" },
    ];

    const result = await generateStudy(INPUTS, REAL_DATA, undefined, {
      previousSections,
      feedback: "Céntrate en el sector salud y ajusta el pricing",
    });

    const userMessage: string = capture.messages[1]?.content ?? "";
    // Previous study content present
    expect(userMessage).toContain("Contenido DAFO previo con edición manual");
    expect(userMessage).toContain("Pasos previos del estudio");
    // User feedback present
    expect(userMessage).toContain("Céntrate en el sector salud y ajusta el pricing");
    expect(userMessage).toContain("INSTRUCCIONES DEL USUARIO PARA ESTA ITERACIÓN");
    // Iterate instruction present
    expect(userMessage).toContain("Itera sobre este estudio");
    expect(userMessage).toContain("no pierdas información valiosa");
    // System prompt still carries current inputs
    expect(capture.messages[0]?.content).toContain("Madrid");
    // Result parsed normally
    expect(result.sections).toHaveLength(10);
    expect(result.successScore).toBe(3);
  });

  it("truncates very long previous sections", async () => {
    const capture = { messages: [] as any[] };
    mockOpenAI(capture);

    const { generateStudy } = await import("@/lib/market-study/study-generator");

    const longMarkdown = "A".repeat(5000);
    await generateStudy(INPUTS, REAL_DATA, undefined, {
      previousSections: [{ key: "swot", title: "DAFO", markdown: longMarkdown }],
    });

    const userMessage: string = capture.messages[1]?.content ?? "";
    expect(userMessage).toContain("[... contenido recortado ...]");
    expect(userMessage).not.toContain("A".repeat(2000));
  });

  it("omits feedback block when no feedback given", async () => {
    const capture = { messages: [] as any[] };
    mockOpenAI(capture);

    const { generateStudy } = await import("@/lib/market-study/study-generator");
    await generateStudy(INPUTS, REAL_DATA, undefined, {
      previousSections: [{ key: "swot", title: "DAFO", markdown: "Previo" }],
    });

    const userMessage: string = capture.messages[1]?.content ?? "";
    expect(userMessage).not.toContain("INSTRUCCIONES DEL USUARIO PARA ESTA ITERACIÓN");
    expect(userMessage).toContain("Itera sobre este estudio");
  });

  it("first generation (no iteration) keeps the original user message", async () => {
    const capture = { messages: [] as any[] };
    mockOpenAI(capture);

    const { generateStudy } = await import("@/lib/market-study/study-generator");
    await generateStudy(INPUTS, REAL_DATA);

    const userMessage: string = capture.messages[1]?.content ?? "";
    expect(userMessage).toBe("Genera el estudio de mercado completo en formato JSON.");
  });
});

// ── mergeProspects ────────────────────────────────────────────────────────

describe("mergeProspects", () => {
  const existing: Prospect[] = [
    { placeId: "p1", name: "Bar A", candidateServices: [], status: "contacted" },
    { placeId: "p2", name: "Tienda B", candidateServices: [], status: "discarded" },
    { placeId: "p3", name: "Cafe C", candidateServices: [], status: "new" },
  ];

  it("preserves contacted/discarded statuses on repeated placeIds and refreshes data", async () => {
    const { mergeProspects } = await import("@/lib/market-study/prospects");

    const incoming: Prospect[] = [
      { placeId: "p1", name: "Bar A Renovado", candidateServices: [], status: "new", rating: 4.5 },
      { placeId: "p2", name: "Tienda B", candidateServices: [], status: "new" },
      { placeId: "p4", name: "Nuevo D", candidateServices: [], status: "new" },
    ];

    const merged = mergeProspects(existing, incoming);

    expect(merged).toHaveLength(4);
    const p1 = merged.find((p) => p.placeId === "p1");
    expect(p1?.status).toBe("contacted"); // status preserved
    expect(p1?.name).toBe("Bar A Renovado"); // data refreshed
    expect(p1?.rating).toBe(4.5);
    expect(merged.find((p) => p.placeId === "p2")?.status).toBe("discarded");
    expect(merged.find((p) => p.placeId === "p3")?.status).toBe("new"); // untouched, still there
    expect(merged.find((p) => p.placeId === "p4")?.status).toBe("new"); // added
  });

  it("returns existing untouched when incoming is empty", async () => {
    const { mergeProspects } = await import("@/lib/market-study/prospects");
    expect(mergeProspects(existing, [])).toEqual(existing);
  });
});

// ── Route POST /:id/generate (iteration + prospects) ──────────────────────

interface RouteMocks {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  generateStudy: ReturnType<typeof vi.fn>;
  searchProspects: ReturnType<typeof vi.fn>;
}

async function setupGenerateRoute(study: any): Promise<{ handler: any; mocks: RouteMocks }> {
  const findUnique = vi.fn().mockResolvedValue(study);
  const update = vi.fn().mockImplementation(async (args: any) => ({ ...study, ...args.data }));
  const generateStudy = vi.fn().mockResolvedValue({
    sections: [{ key: "executive_summary", title: "Resumen", markdown: "Regenerado" }],
    successScore: 4,
  });
  const searchProspects = vi.fn().mockResolvedValue({
    prospects: [
      { placeId: "p1", name: "Bar A Refrescado", candidateServices: [], status: "new" },
      { placeId: "p9", name: "Nuevo", candidateServices: [], status: "new" },
    ],
    partial: false,
  });

  vi.doMock("@/lib/db", () => ({ prisma: { marketStudy: { findUnique, update } } }));
  vi.doMock("@/lib/market-study/study-generator", () => ({
    collectRealData: vi.fn().mockResolvedValue(REAL_DATA),
    generateStudy,
    regenerateSection: vi.fn(),
  }));
  vi.doMock("@/lib/market-study/places", () => ({
    searchProspects,
    isConfigured: () => true,
    geocodeZone: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("@/lib/market-study/competitors", () => ({
    buildCompetitorSection: vi.fn().mockResolvedValue({
      key: "competitors", title: "Competidores", markdown: "x",
    }),
  }));

  const { marketStudiesRouter } = await import("@/routes/market-studies");
  const layer = (marketStudiesRouter as any).stack.find(
    (l: any) => l.route?.path === "/:id/generate" && l.route?.methods?.post
  );
  return { handler: layer.route.stack[0].handle, mocks: { findUnique, update, generateStudy, searchProspects } };
}

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  return res;
}

const EXISTING_PROSPECTS: Prospect[] = [
  { placeId: "p1", name: "Bar A", candidateServices: [], status: "contacted" },
  { placeId: "p2", name: "Tienda B", candidateServices: [], status: "discarded" },
];

const STUDY_WITH_SECTIONS = {
  id: "s1",
  title: "Estudio",
  inputs: INPUTS,
  sections: [{ key: "executive_summary", title: "Resumen", markdown: "Versión previa" }],
  prospects: EXISTING_PROSPECTS,
  status: "ready",
};

describe("POST /:id/generate — iterative behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("without refreshProspects: keeps prospects (and statuses) and does NOT call Places", async () => {
    const { handler, mocks } = await setupGenerateRoute(STUDY_WITH_SECTIONS);
    const res = mockRes();

    await handler({ params: { id: "s1" }, body: { feedback: "Mejora el DAFO" } }, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.searchProspects).not.toHaveBeenCalled();

    // generateStudy received iteration context with previous sections + feedback
    const iterationArg = mocks.generateStudy.mock.calls[0][3];
    expect(iterationArg).toBeDefined();
    expect(iterationArg.previousSections[0].markdown).toBe("Versión previa");
    expect(iterationArg.feedback).toBe("Mejora el DAFO");

    // Final update keeps prospects untouched (contacted/discarded preserved)
    const finalUpdate = mocks.update.mock.calls.find((c: any[]) => c[0]?.data?.prospects);
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate![0].data.prospects).toEqual(EXISTING_PROSPECTS);
    expect(finalUpdate![0].data.status).toBe("ready");
    expect(finalUpdate![0].data.successScore).toBe(4);
  });

  it("with refreshProspects: calls Places and merges by placeId preserving statuses", async () => {
    const { handler, mocks } = await setupGenerateRoute(STUDY_WITH_SECTIONS);
    const res = mockRes();

    await handler({ params: { id: "s1" }, body: { refreshProspects: true } }, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.searchProspects).toHaveBeenCalledOnce();

    const finalUpdate = mocks.update.mock.calls.find((c: any[]) => c[0]?.data?.prospects);
    expect(finalUpdate).toBeDefined();
    const prospects: Prospect[] = finalUpdate![0].data.prospects;
    expect(prospects).toHaveLength(3);
    const p1 = prospects.find((p) => p.placeId === "p1");
    expect(p1?.status).toBe("contacted"); // never lost
    expect(p1?.name).toBe("Bar A Refrescado"); // data refreshed
    expect(prospects.find((p) => p.placeId === "p2")?.status).toBe("discarded");
    expect(prospects.find((p) => p.placeId === "p9")?.status).toBe("new");
  });

  it("first generation (no sections): current behavior intact — Places called, no iteration context", async () => {
    const { handler, mocks } = await setupGenerateRoute({
      ...STUDY_WITH_SECTIONS,
      sections: [],
      prospects: [],
      status: "draft",
    });
    const res = mockRes();

    await handler({ params: { id: "s1" }, body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(mocks.searchProspects).toHaveBeenCalledOnce();
    expect(mocks.generateStudy.mock.calls[0][3]).toBeUndefined();
  });

  it("rejects feedback over 2000 chars with 400", async () => {
    const { handler, mocks } = await setupGenerateRoute(STUDY_WITH_SECTIONS);
    const res = mockRes();

    await handler({ params: { id: "s1" }, body: { feedback: "x".repeat(2001) } }, res);

    expect(res.statusCode).toBe(400);
    expect(mocks.generateStudy).not.toHaveBeenCalled();
  });
});

// ── PATCH /:id accepts inputs ─────────────────────────────────────────────

describe("PATCH /:id — inputs editing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function setupPatchRoute() {
    const update = vi.fn().mockImplementation(async (args: any) => ({ id: "s1", ...args.data }));
    vi.doMock("@/lib/db", () => ({
      prisma: { marketStudy: { findUnique: vi.fn(), update } },
    }));
    vi.doMock("@/lib/market-study/study-generator", () => ({
      collectRealData: vi.fn(), generateStudy: vi.fn(), regenerateSection: vi.fn(),
    }));
    vi.doMock("@/lib/market-study/places", () => ({ searchProspects: vi.fn(), isConfigured: () => false }));
    vi.doMock("@/lib/market-study/competitors", () => ({ buildCompetitorSection: vi.fn() }));

    const { marketStudiesRouter } = await import("@/routes/market-studies");
    const layer = (marketStudiesRouter as any).stack.find(
      (l: any) => l.route?.path === "/:id" && l.route?.methods?.patch
    );
    return { handler: layer.route.stack[0].handle, update };
  }

  it("accepts inputs with the same schema as creation and persists them", async () => {
    const { handler, update } = await setupPatchRoute();
    const res = mockRes();

    const newInputs = {
      zone: "Sevilla", radiusKm: 10, expansionZones: ["Cádiz"],
      targetSectors: ["Salud"], avgBudget: 1500,
    };
    await handler({ params: { id: "s1" }, body: { inputs: newInputs } }, res);

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0].data.inputs).toMatchObject(newInputs);
  });

  it("rejects invalid inputs (empty targetSectors) with 400", async () => {
    const { handler, update } = await setupPatchRoute();
    const res = mockRes();

    await handler({
      params: { id: "s1" },
      body: { inputs: { zone: "Sevilla", radiusKm: 10, expansionZones: [], targetSectors: [] } },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
