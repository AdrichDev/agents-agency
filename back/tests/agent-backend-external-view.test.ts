/**
 * T2.1 (aa-external-api-ui, design.md §C / validation.md AC3) — vista SEGURA del
 * backend de datos en `getAgentDetail` (GET /api/agents/:id).
 * Para el modo external_api la vista expone campos NO secretos (apiBaseUrl,
 * apiKeySet, businessId, locationId) pero NUNCA la API key ni su cifrado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/n8n/client", () => ({ isConfigured: vi.fn(() => false) }));

import { prisma } from "@/lib/db";
import { getAgentDetail } from "@/lib/agent/service";

const mockFindUnique = prisma.agent.findUnique as ReturnType<typeof vi.fn>;

function agentRow(dataBackend: unknown) {
  return {
    id: "a1",
    name: "Bot",
    ecommerceConfig: {},
    tenant: null,
    integrations: [],
    skills: [],
    automations: [],
    dataBackend,
    _count: { knowledge: 0, conversations: 0, leads: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAgentDetail — vista segura del backend external_api (T2.1)", () => {
  it("expone apiBaseUrl + apiKeySet + businessId/locationId y NUNCA la key", async () => {
    mockFindUnique.mockResolvedValue(
      agentRow({
        mode: "external_api",
        capabilities: ["reservas", "leads"],
        notificationConfig: {},
        dbUrlEncrypted: null,
        apiBaseUrl: "https://crm.example.com",
        apiKeyEncrypted: "enc:v1:secreto-cifrado",
        dbSchema: { businessId: "biz1", locationId: "loc1" },
      })
    );

    const detail = await getAgentDetail("a1");

    expect(detail.dataBackend).toMatchObject({
      mode: "external_api",
      apiBaseUrl: "https://crm.example.com",
      apiKeySet: true,
      businessId: "biz1",
      locationId: "loc1",
    });
    // AC3/AC7: ni la key en claro ni el cifrado salen por la vista.
    const serialized = JSON.stringify(detail.dataBackend);
    expect(serialized).not.toContain("enc:v1:secreto-cifrado");
    expect(serialized).not.toContain("apiKeyEncrypted");
  });

  // aa-managed-db-conexion-compartida F2 (AC3): managed_db usa la conexion
  // compartida de la app y aparece como listo (provisioned:true) SIN dbUrlEncrypted.
  it("managed_db → provisioned:true sin dbUrlEncrypted (AC3)", async () => {
    mockFindUnique.mockResolvedValue(
      agentRow({
        mode: "managed_db",
        capabilities: ["reservas", "leads"],
        notificationConfig: {},
        dbUrlEncrypted: null,
        apiBaseUrl: null,
        apiKeyEncrypted: null,
        dbSchema: null,
      })
    );

    const detail = await getAgentDetail("a1");

    expect(detail.dataBackend).toMatchObject({
      mode: "managed_db",
      provisioned: true,
    });
  });

  it("none_yet → provisioned:false (sin cambio de comportamiento, AC7)", async () => {
    mockFindUnique.mockResolvedValue(
      agentRow({
        mode: "none_yet",
        capabilities: [],
        notificationConfig: {},
        dbUrlEncrypted: null,
        apiBaseUrl: null,
        apiKeyEncrypted: null,
        dbSchema: null,
      })
    );

    const detail = await getAgentDetail("a1");

    expect(detail.dataBackend).toMatchObject({ mode: "none_yet", provisioned: false });
  });

  it("apiKeySet=false y apiBaseUrl=null cuando no hay key/URL configuradas", async () => {
    mockFindUnique.mockResolvedValue(
      agentRow({
        mode: "external_api",
        capabilities: [],
        notificationConfig: {},
        dbUrlEncrypted: null,
        apiBaseUrl: null,
        apiKeyEncrypted: null,
        dbSchema: null,
      })
    );

    const detail = await getAgentDetail("a1");

    expect(detail.dataBackend).toMatchObject({
      apiBaseUrl: null,
      apiKeySet: false,
      businessId: null,
      locationId: null,
    });
  });
});
