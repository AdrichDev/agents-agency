import { describe, expect, it, beforeEach, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  prospectContact: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  systemConfig: {
    findUnique: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

// Mock global fetch for webhook tests
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import {
  processNewLead,
  createLeadContact,
  resolveAdminEmail,
  notifyLeadViaWebhook,
} from "@/lib/notifications";

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" } as Response);
  process.env.N8N_WEBHOOK_LEAD_URL = "http://n8n.test/webhook/nuevo-lead";
});

describe("notifications — resolveAdminEmail", () => {
  it("prioriza SystemConfig.adminEmail", async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ adminEmail: "config@admin.com" });
    await expect(resolveAdminEmail()).resolves.toBe("config@admin.com");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("cae al primer usuario admin si no hay adminEmail configurado", async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ adminEmail: null });
    prismaMock.user.findFirst.mockResolvedValue({ email: "user@admin.com" });
    await expect(resolveAdminEmail()).resolves.toBe("user@admin.com");
  });

  it("devuelve null si no hay configuración ni admins", async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue(null);
    prismaMock.user.findFirst.mockResolvedValue(null);
    await expect(resolveAdminEmail()).resolves.toBeNull();
  });
});

describe("notifications — createLeadContact", () => {
  it("crea el ProspectContact type=lead con codigo pc-NN secuencial", async () => {
    prismaMock.prospectContact.findMany.mockResolvedValue([{ codigo: "pc-04" }]);
    prismaMock.prospectContact.create.mockImplementation(async ({ data }: any) => ({ id: "p1", ...data }));

    await createLeadContact({ name: "Ana", email: "ana@x.com", phone: "611", source: "landing" });

    expect(prismaMock.prospectContact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        codigo: "pc-05",
        type: "lead",
        name: "Ana",
        email: "ana@x.com",
        phone: "611",
      }),
    });
  });
});

describe("notifications — notifyLeadViaWebhook", () => {
  it("dispara POST al webhook con los datos del lead y adminEmail", async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ adminEmail: "admin@3a.com" });

    await notifyLeadViaWebhook({ name: "Ana", email: "ana@x.com", phone: "611", source: "landing" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://n8n.test/webhook/nuevo-lead",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"name":"Ana"'),
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.adminEmail).toBe("admin@3a.com");
    expect(body.source).toBe("landing");
  });

  it("lanza si N8N_WEBHOOK_LEAD_URL no está configurado", async () => {
    delete process.env.N8N_WEBHOOK_LEAD_URL;
    await expect(notifyLeadViaWebhook({ name: "Ana", source: "landing" })).rejects.toThrow(/N8N_WEBHOOK_LEAD_URL/);
  });

  it("lanza si el webhook responde con error HTTP", async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ adminEmail: "admin@3a.com" });
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "Internal error" } as Response);
    await expect(notifyLeadViaWebhook({ name: "Ana", source: "landing" })).rejects.toThrow(/500/);
  });
});

describe("notifications — processNewLead (hook best-effort)", () => {
  const lead = { name: "Ana", email: "ana@x.com", phone: "611", source: "landing" as const };

  it("crea el contacto y dispara el webhook", async () => {
    const createContact = vi.fn().mockResolvedValue({ id: "p1" });
    const sendNotification = vi.fn().mockResolvedValue(undefined);

    await processNewLead(lead, { createContact, sendNotification });

    expect(createContact).toHaveBeenCalledWith(lead);
    expect(sendNotification).toHaveBeenCalledWith(lead);
  });

  it("un fallo del webhook NO lanza ni impide crear el contacto", async () => {
    const createContact = vi.fn().mockResolvedValue({ id: "p1" });
    const sendNotification = vi.fn().mockRejectedValue(new Error("n8n caído"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(processNewLead(lead, { createContact, sendNotification })).resolves.toBeUndefined();
    expect(createContact).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("un fallo creando el contacto NO impide disparar el webhook ni lanza", async () => {
    const createContact = vi.fn().mockRejectedValue(new Error("db caída"));
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(processNewLead(lead, { createContact, sendNotification })).resolves.toBeUndefined();
    expect(sendNotification).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("con las dependencias reales tampoco lanza aunque todo falle", async () => {
    prismaMock.prospectContact.findMany.mockRejectedValue(new Error("db down"));
    prismaMock.systemConfig.findUnique.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(processNewLead(lead)).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});
