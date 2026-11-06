/**
 * aa-reservas-comensales-obligatorios — una mesa para dos no puede guardarse como una para uno.
 *
 * El caso real (Lafayette, 8 de agosto): el visitante pidió mesa para dos, el bot confirmó dos y
 * la fila guardó `comensales: 1`, porque el modelo omitió el campo, el schema permitía omitirlo
 * y `normalisePartySize` rellenaba con 1 en silencio. La prosa del schema ("pregunta cuántas
 * serán") no es una garantía: `required` sí lo es, y el executor tampoco puede adivinar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    integration: { findUnique: vi.fn(), findMany: vi.fn() },
    agentSchedule: { findUnique: vi.fn(async () => ({ timezone: "Europe/Madrid" })) },
    agentDataBackend: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/agent-backend/managed-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-backend/managed-db")>();
  return { ...actual, resolveAgentBackendAdapter: vi.fn(), enabledBackendCapabilities: vi.fn() };
});
vi.mock("@/lib/integrations/gmail", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/integrations/slack", () => ({ sendMessage: vi.fn() }));
vi.mock("@/lib/integrations/jira", () => ({ createIssue: vi.fn() }));
vi.mock("@/lib/integrations/calendar", () => ({ createEvent: vi.fn() }));
vi.mock("@/lib/integrations/oauth", () => ({
  getValidToken: vi.fn(async () => "t"),
  decryptToken: vi.fn((v: string) => v),
  encryptToken: vi.fn((v: string) => v),
}));
vi.mock("@/lib/integrations/service-map", () => ({ toPhysicalProvider: vi.fn((p: string) => p) }));

import { prisma } from "@/lib/db";
import { resolveAgentBackendAdapter } from "@/lib/agent-backend/managed-db";
import { executeTool } from "@/lib/agent/executor";
import { BACKEND_TOOLS_BY_CAPABILITY } from "@/lib/agent/tools";

const asMock = (v: unknown) => v as ReturnType<typeof vi.fn>;

// Las tools de reserva viven en BACKEND_TOOLS_BY_CAPABILITY (carril de datos del negocio).
function toolSchema(name: string) {
  for (const list of Object.values(BACKEND_TOOLS_BY_CAPABILITY)) {
    const found = (list as Array<{ name: string; input_schema: { required?: string[] } }>).find(
      (t) => t.name === name,
    );
    if (found) return found;
  }
  throw new Error(`tool no encontrada: ${name}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.agent.findUnique).mockResolvedValue({
    ecommerceConfig: {},
    tenant: { email: "negocio@restaurante.es", phone: null },
    integrations: [],
  });
  asMock(prisma.lead.findUnique).mockResolvedValue({ email: "visita@ejemplo.es", phone: null });
  asMock(prisma.conversation.findUnique).mockResolvedValue({ metadata: {} });
  asMock(prisma.conversation.update).mockImplementation(async ({ data }: any) => ({ metadata: data.metadata }));
});

describe("el schema OBLIGA a decir cuántas personas (no solo lo pide en prosa)", () => {
  it("crear_reserva exige comensales", () => {
    expect(toolSchema("crear_reserva").input_schema.required).toContain("comensales");
  });

  it("consultar_disponibilidad también: la disponibilidad depende del grupo", () => {
    expect(toolSchema("consultar_disponibilidad").input_schema.required).toContain("comensales");
  });
});

describe("el executor no rellena en silencio", () => {
  const crearReserva = vi.fn(async () => ({
    id: "r1", servicioNombre: "Cena", startTime: "2026-08-08T20:00:00.000Z", comensales: 2,
  }));

  beforeEach(() => {
    asMock(resolveAgentBackendAdapter).mockResolvedValue({ crearReserva, notificar: vi.fn() });
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ mode: "managed_db", capabilities: ["bookings"] });
  });

  const args = {
    servicio: "Cena",
    startIso: "2026-08-08T20:00:00",
    endIso: "2026-08-08T21:30:00",
    nombre: "Ana",
    email: "visita@ejemplo.es",
  };

  it("sin comensales devuelve un error que pide el dato, y NO crea la reserva", async () => {
    await expect(executeTool("a1", "crear_reserva", args, "conv-1")).rejects.toThrow(
      /cu[aá]ntas personas|comensales/i,
    );
    expect(crearReserva).not.toHaveBeenCalled();
  });

  it("un valor inservible (0, negativo, texto) tampoco se convierte en 1", async () => {
    for (const malo of [0, -3, "muchos"]) {
      await expect(
        executeTool("a1", "crear_reserva", { ...args, comensales: malo }, "conv-1"),
      ).rejects.toThrow(/comensales/i);
    }
    expect(crearReserva).not.toHaveBeenCalled();
  });

  it("con comensales explícito se reserva para ese número", async () => {
    await executeTool("a1", "crear_reserva", { ...args, comensales: 2 }, "conv-1");
    expect(crearReserva).toHaveBeenCalledTimes(1);
    const payload = (crearReserva.mock.calls as unknown as Array<[string, unknown, { comensales: number }]>)[0][2];
    expect(payload.comensales).toBe(2);
  });
});
