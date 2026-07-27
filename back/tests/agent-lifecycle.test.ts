/**
 * H3 (aa-agente-ciclo-vida-publicacion) — Unidad de `lib/agent/lifecycle.ts`.
 *
 * Lo que se prueba aquí es la premisa del change: que el estado CAMBIA el comportamiento
 * observable. Un `status` que nadie comprueba no es un estado, es una etiqueta — y encima
 * factura. Así que la matriz del gate, el recuento facturable y el rastro de transiciones
 * se prueban juntos, porque son las tres cosas que hacen que el estado signifique algo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), count: vi.fn() },
    agentStatusEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import {
  AGENT_STATUSES,
  BILLABLE_STATUSES,
  SERVABLE_STATUSES,
  isServable,
  assertAgentServable,
  assertAgentServableById,
  countBillableAgents,
  transitionAgentStatus,
  checkPublishPreconditions,
} from "@/lib/agent/lifecycle";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // `$transaction([...])` devuelve el array de resultados; aquí se resuelven las promesas
  // que los delegates mockeados ya devolvieron.
  asMock(prisma.$transaction).mockImplementation((ops: any[]) => Promise.all(ops));
});

describe("T1.1 — los estados son cuatro y cada conjunto dice algo distinto", () => {
  it("draft y suspended callan igual, pero sólo suspended factura", () => {
    // Ésta es la razón de que sea un enum de 4 y no un booleano `isPublished`: un booleano
    // obligaría a inferir la causa en otro sitio (el bug que H4/T1 deshizo con isActive).
    expect(isServable("draft")).toBe(false);
    expect(isServable("suspended")).toBe(false);
    expect(BILLABLE_STATUSES).toContain("suspended");
    expect(BILLABLE_STATUSES).not.toContain("draft");
  });

  it("sólo published sirve tráfico, y todo estado facturable o servible es un estado válido", () => {
    expect(SERVABLE_STATUSES).toEqual(["published"]);
    for (const s of [...BILLABLE_STATUSES, ...SERVABLE_STATUSES]) {
      expect(AGENT_STATUSES).toContain(s);
    }
  });
});

describe("T2.1 — gate de publicación (fail-closed)", () => {
  it("published atiende", () => {
    expect(() => assertAgentServable("published")).not.toThrow();
  });

  it("draft no atiende: 403 y el motivo es la publicación", () => {
    expect(() => assertAgentServable("draft")).toThrowError(/no está publicado/i);
    try {
      assertAgentServable("draft");
    } catch (e: any) {
      expect(e.status).toBe(403);
    }
  });

  it("suspended devuelve 402, igual que el corte por impago de H1", () => {
    try {
      assertAgentServable("suspended");
      throw new Error("no cortó");
    } catch (e: any) {
      expect(e.status).toBe(402);
      // Hacia fuera es el mismo hecho que el kill switch de tenant: "desactivado". El
      // visitante no tiene por qué distinguir si el corte viene del tenant o del agente.
      expect(e.message).toMatch(/desactivado/i);
    }
  });

  it("archived devuelve 403 con motivo propio (retirado, no 'aún no publicado')", () => {
    try {
      assertAgentServable("archived");
      throw new Error("no cortó");
    } catch (e: any) {
      expect(e.status).toBe(403);
      expect(e.message).toMatch(/retirado/i);
    }
  });

  it("un estado desconocido NO atiende (dato corrupto ⇒ fail-closed)", () => {
    // No servir es recuperable; servir por error factura y expone.
    expect(() => assertAgentServable("")).toThrow();
    expect(() => assertAgentServable("publicado")).toThrow();
    expect(() => assertAgentServable("PUBLISHED")).toThrow();
  });
});

describe("T2.2 — exención de la consola de pruebas, y hasta dónde llega", () => {
  it("draft + isTest atiende: el flujo es crear → probar → publicar", () => {
    expect(() => assertAgentServable("draft", { isTest: true })).not.toThrow();
  });

  it("isTest NO exime a suspended ni a archived", () => {
    // Si eximiera, la consola sería la vía para seguir atendiendo a un tenant que dejó de
    // pagar, y desarchivar a escondidas.
    expect(() => assertAgentServable("suspended", { isTest: true })).toThrowError(/desactivado/i);
    expect(() => assertAgentServable("archived", { isTest: true })).toThrowError(/retirado/i);
  });

  it("isTest tampoco exime a un estado desconocido", () => {
    expect(() => assertAgentServable("zzz", { isTest: true })).toThrow();
  });
});

describe("T2.5 — gate por id para las vías sin LLM", () => {
  it("agente inexistente ⇒ 404 (no 403: no se confirma qué ids existen)", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue(null);
    await expect(assertAgentServableById("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("lee el estado y aplica la misma matriz", async () => {
    asMock(prisma.agent.findUnique).mockResolvedValue({ status: "draft" });
    await expect(assertAgentServableById("a1")).rejects.toMatchObject({ status: 403 });

    asMock(prisma.agent.findUnique).mockResolvedValue({ status: "published" });
    await expect(assertAgentServableById("a1")).resolves.toBeUndefined();
  });
});

describe("T4.1 — recuento facturable derivado", () => {
  /**
   * `count` mockeado aplicando el `where` real contra una tabla en memoria. Así el test mide
   * el filtro que se escribió, no el número que devolvería un stub — que es lo único que
   * puede estar mal aquí.
   */
  const TABLA = [
    { id: "1", tenantId: "tenant-1", status: "published" },
    { id: "2", tenantId: "tenant-1", status: "suspended" },
    { id: "3", tenantId: "tenant-1", status: "draft" },
    { id: "4", tenantId: "tenant-1", status: "draft" },
    { id: "5", tenantId: "tenant-1", status: "archived" },
    { id: "6", tenantId: "tenant-2", status: "published" },
    { id: "7", tenantId: null, status: "published" },
  ];

  beforeEach(() => {
    asMock(prisma.agent.count).mockImplementation(async ({ where }: any) =>
      TABLA.filter((a) => a.tenantId === where.tenantId && where.status.in.includes(a.status))
        .length
    );
  });

  it("1 published + 1 suspended + 2 draft + 1 archived ⇒ 2", async () => {
    await expect(countBillableAgents("tenant-1")).resolves.toBe(2);
  });

  it("no cuenta los agentes de otro tenant ni los huérfanos", async () => {
    await expect(countBillableAgents("tenant-2")).resolves.toBe(1);
    await expect(countBillableAgents("tenant-sin-agentes")).resolves.toBe(0);
  });

  it("se deriva del estado: sin contador materializado en Tenant", async () => {
    // Un contador se desincroniza del hecho que dice contar — misma razón por la que H4
    // calcula el consumo desde `uso_tokens` en vez de fiarse de un acumulado.
    await countBillableAgents("tenant-1");
    expect(prisma.agent.count).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", status: { in: ["published", "suspended"] } },
    });
  });
});

describe("T3.3 / T3.5 — transiciones: idempotencia y rastro", () => {
  it("publicar por primera vez sella publishedAt y deja evento con from/to/actor", async () => {
    asMock(prisma.agent.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "draft",
      publishedAt: null,
    });
    asMock(prisma.agent.update).mockResolvedValue({ id: "a1", status: "published" });
    asMock(prisma.agentStatusEvent.create).mockResolvedValue({ id: "ev1" });

    const { changed } = await transitionAgentStatus("a1", "published", { actor: "u1" });

    expect(changed).toBe(true);
    const updateArg = asMock(prisma.agent.update).mock.calls[0][0];
    expect(updateArg.data.status).toBe("published");
    expect(updateArg.data.publishedAt).toBeInstanceOf(Date);
    expect(updateArg.data.statusChangedAt).toBeInstanceOf(Date);
    expect(asMock(prisma.agentStatusEvent.create).mock.calls[0][0].data).toMatchObject({
      agentId: "a1",
      from: "draft",
      to: "published",
      actor: "u1",
    });
  });

  it("republicar NO reescribe publishedAt: es el inicio de la historia de cobro", async () => {
    const primera = new Date("2026-06-01T10:00:00Z");
    asMock(prisma.agent.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "draft",
      publishedAt: primera,
    });
    asMock(prisma.agent.update).mockResolvedValue({ id: "a1", status: "published" });
    asMock(prisma.agentStatusEvent.create).mockResolvedValue({ id: "ev2" });

    await transitionAgentStatus("a1", "published", { actor: "u1" });

    const updateArg = asMock(prisma.agent.update).mock.calls[0][0];
    expect(updateArg.data).not.toHaveProperty("publishedAt");
    // statusChangedAt sí se mueve: es la última transición, no la primera.
    expect(updateArg.data.statusChangedAt).toBeInstanceOf(Date);
  });

  it("transición al mismo estado no escribe nada ni duplica evento", async () => {
    asMock(prisma.agent.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "published",
      publishedAt: new Date(),
    });

    const { changed } = await transitionAgentStatus("a1", "published", { actor: "u1" });

    expect(changed).toBe(false);
    expect(prisma.agent.update).not.toHaveBeenCalled();
    expect(prisma.agentStatusEvent.create).not.toHaveBeenCalled();
  });

  it("el cambio de fila y su evento van en la MISMA transacción", async () => {
    // Un cambio de estado sin su evento es peor que ninguno de los dos: la fila diría una
    // cosa y el historial otra, y el historial es lo que responde una reclamación de factura.
    asMock(prisma.agent.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "published",
      publishedAt: new Date(),
    });
    asMock(prisma.agent.update).mockResolvedValue({ id: "a1", status: "draft" });
    asMock(prisma.agentStatusEvent.create).mockResolvedValue({ id: "ev3" });

    await transitionAgentStatus("a1", "draft", { actor: "u1", reason: "unpublished by owner" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(asMock(prisma.$transaction).mock.calls[0][0]).toHaveLength(2);
    expect(asMock(prisma.agentStatusEvent.create).mock.calls[0][0].data).toMatchObject({
      from: "published",
      to: "draft",
      reason: "unpublished by owner",
    });
  });
});

describe("T3.1 — precondiciones de publicación", () => {
  const completo = {
    tenantId: "tenant-1",
    systemPrompt: "Eres útil",
    channel: "widget",
    channelConnections: [] as { provider: string }[],
  };

  it("agente completo: nada bloquea, nada avisa", () => {
    expect(checkPublishPreconditions(completo)).toEqual({ blocking: [], warnings: [] });
  });

  it("sin tenant bloquea: sin cliente asignado no hay a quién cobrar", () => {
    const { blocking } = checkPublishPreconditions({ ...completo, tenantId: null });
    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toMatch(/cliente/i);
  });

  it("prompt vacío o en blanco bloquea", () => {
    expect(checkPublishPreconditions({ ...completo, systemPrompt: null }).blocking).toHaveLength(1);
    expect(checkPublishPreconditions({ ...completo, systemPrompt: "   " }).blocking).toHaveLength(1);
  });

  it("enumera TODO lo que falta, no sólo el primero", () => {
    const { blocking } = checkPublishPreconditions({
      ...completo,
      tenantId: null,
      systemPrompt: "",
    });
    expect(blocking).toHaveLength(2);
  });

  it("canal de mensajería sin conexión AVISA, no bloquea", () => {
    // T0.1b lo tumbó con datos: 3 de los 6 agentes que servían tráfico en producción tienen
    // channel="whatsapp" sin conexión y funcionan por widget. La regla como bloqueante habría
    // rechazado la mitad de los agentes vendidos.
    const r = checkPublishPreconditions({ ...completo, channel: "whatsapp" });
    expect(r.blocking).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/whatsapp/i);
  });

  it("canal de mensajería CON su conexión no avisa", () => {
    const r = checkPublishPreconditions({
      ...completo,
      channel: "telegram",
      channelConnections: [{ provider: "telegram" }],
    });
    expect(r.warnings).toHaveLength(0);
  });

  it("una conexión de otro proveedor no cuenta como la del canal declarado", () => {
    const r = checkPublishPreconditions({
      ...completo,
      channel: "whatsapp",
      channelConnections: [{ provider: "telegram" }],
    });
    expect(r.warnings).toHaveLength(1);
  });
});
