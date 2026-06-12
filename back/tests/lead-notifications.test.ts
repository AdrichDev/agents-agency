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
  integration: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/integrations/oauth", () => ({ getValidToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("@/lib/integrations/gmail", () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true }) }));

import {
  processNewLead,
  createLeadContact,
  buildLeadEmail,
  resolveAdminEmail,
  sendLeadNotificationEmail,
} from "@/lib/notifications";
import { sendEmail } from "@/lib/integrations/gmail";

beforeEach(() => {
  vi.clearAllMocks();
  (sendEmail as any).mockResolvedValue({ ok: true });
});

describe("notifications — buildLeadEmail", () => {
  it("asunto en español con el nombre del lead", () => {
    const { subject, body } = buildLeadEmail({ name: "Laura", email: "l@x.com", phone: "600", source: "landing" });
    expect(subject).toBe("Nuevo lead en la web: Laura");
    expect(body).toContain("Laura");
    expect(body).toContain("l@x.com");
    expect(body).toContain("formulario de la web");
  });

  it("usa guión para datos ausentes y distingue el origen chat", () => {
    const { body } = buildLeadEmail({ name: "Luis", source: "chat" });
    expect(body).toContain("chat del agente");
    expect(body).toContain("Email: —");
    expect(body).toContain("Teléfono: —");
  });
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
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "admin" } })
    );
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

describe("notifications — sendLeadNotificationEmail", () => {
  it("envía con la integración Gmail conectada y el destinatario resuelto", async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ adminEmail: "admin@3a.com" });
    prismaMock.integration.findFirst.mockResolvedValue({ agentId: "agent-1" });

    await sendLeadNotificationEmail({ name: "Ana", source: "landing" });

    expect(prismaMock.integration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: "google", status: "connected" } })
    );
    expect(sendEmail).toHaveBeenCalledWith(
      "tok",
      "admin@3a.com",
      "Nuevo lead en la web: Ana",
      expect.stringContaining("Ana")
    );
  });

  it("lanza si no hay integración Gmail conectada", async () => {
    prismaMock.systemConfig.findUnique.mockResolvedValue({ adminEmail: "admin@3a.com" });
    prismaMock.integration.findFirst.mockResolvedValue(null);
    await expect(sendLeadNotificationEmail({ name: "Ana", source: "landing" })).rejects.toThrow(/Gmail/);
  });
});

describe("notifications — processNewLead (hook best-effort)", () => {
  const lead = { name: "Ana", email: "ana@x.com", phone: "611", source: "landing" as const };

  it("crea el contacto y envía el email", async () => {
    const createContact = vi.fn().mockResolvedValue({ id: "p1" });
    const sendNotification = vi.fn().mockResolvedValue(undefined);

    await processNewLead(lead, { createContact, sendNotification });

    expect(createContact).toHaveBeenCalledWith(lead);
    expect(sendNotification).toHaveBeenCalledWith(lead);
  });

  it("un fallo del email NO lanza ni impide crear el contacto", async () => {
    const createContact = vi.fn().mockResolvedValue({ id: "p1" });
    const sendNotification = vi.fn().mockRejectedValue(new Error("gmail caído"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(processNewLead(lead, { createContact, sendNotification })).resolves.toBeUndefined();
    expect(createContact).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("un fallo creando el contacto NO impide intentar el email ni lanza", async () => {
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
