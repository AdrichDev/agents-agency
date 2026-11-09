/**
 * S3 (conversation-persistence, T2) — retención y purga de conversaciones.
 *
 * El riesgo de esta tarea es un borrado masivo de datos: si la purga se equivoca de filtro,
 * borra hilos de Telegram/WhatsApp que son de por vida del contacto y que nadie puede
 * reconstruir. Por eso las dos mitades se prueban por separado:
 *
 *  1. el PLAN (`planWidgetPurge`) es puro: dice exactamente qué ids se borran, y una prueba
 *     recorre los canales del sistema contra `usesExpiringSession` para que el filtro SQL y la
 *     semántica de sesión no puedan discrepar;
 *  2. el RUNNER (`purgeExpiredConversations`) se pina por sus ARGUMENTOS: el `deleteMany` lleva
 *     los ids planificados y el filtro de canal. Un `deleteMany({ updatedAt: { lt } })` a secas
 *     —el error caro— pondría roja la prueba de E4.
 *
 * No se toca ninguna BD: el cliente Prisma se inyecta (y `@/lib/db` va mockeado por si algún
 * import colateral lo pidiera).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { conversation: { findMany: vi.fn(), deleteMany: vi.fn() } },
}));

import { usesExpiringSession } from "@/lib/agent/conversation-session";
import {
  DEFAULT_RETENTION_DAYS,
  PURGE_CHUNK_SIZE,
  planWidgetPurge,
  purgeExpiredConversations,
  resolveRetentionDays,
  retentionCutoff,
  type RetentionCandidate,
  type RetentionPrisma,
} from "@/lib/conversation-retention";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function conv(over: Partial<RetentionCandidate> & { id: string }): RetentionCandidate {
  return { channel: "widget", metadata: {}, createdAt: daysAgo(1), updatedAt: daysAgo(1), ...over };
}

/** Doble mínimo de Prisma: sólo los dos métodos que usa el runner. */
function fakePrisma(rows: RetentionCandidate[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const deleteMany = vi.fn(async (args: { where: { id: { in: string[] } } }) => ({
    count: args.where.id.in.length,
  }));
  return { prisma: { conversation: { findMany, deleteMany } } as unknown as RetentionPrisma, findMany, deleteMany };
}

// ── Configuración ────────────────────────────────────────────────────────────

describe("resolveRetentionDays — CONVERSATION_RETENTION_DAYS", () => {
  it("sin configurar usa 30 días", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(30);
    expect(resolveRetentionDays(undefined)).toEqual({ days: 30, invalid: false });
    expect(resolveRetentionDays("")).toEqual({ days: 30, invalid: false });
    expect(resolveRetentionDays("   ")).toEqual({ days: 30, invalid: false });
  });

  it("un valor válido manda", () => {
    expect(resolveRetentionDays("7")).toEqual({ days: 7, invalid: false });
    expect(resolveRetentionDays(" 90 ")).toEqual({ days: 90, invalid: false });
  });

  it("un valor inválido cae al default y lo señala (para avisar una vez)", () => {
    for (const raw of ["cero", "0", "-3", "NaN", "Infinity"]) {
      expect(resolveRetentionDays(raw), raw).toEqual({ days: 30, invalid: true });
    }
  });
});

describe("retentionCutoff — función pura, sin reloj propio", () => {
  it("resta los días pedidos", () => {
    expect(retentionCutoff(NOW, 30).toISOString()).toBe("2026-05-16T12:00:00.000Z");
    expect(retentionCutoff(NOW, 1).toISOString()).toBe("2026-06-14T12:00:00.000Z");
  });

  it("no muta `now`", () => {
    const ahora = new Date(NOW);
    retentionCutoff(ahora, 10);
    expect(ahora.toISOString()).toBe(NOW.toISOString());
  });
});

// ── El plan (puro) ───────────────────────────────────────────────────────────

describe("planWidgetPurge — qué ids se borran, decidido sin BD", () => {
  const cutoff = retentionCutoff(NOW, 30);

  it("borra la conversación del widget inactiva", () => {
    const ids = planWidgetPurge([conv({ id: "vieja", updatedAt: daysAgo(31) })], cutoff);
    expect(ids).toEqual(["vieja"]);
  });

  it("no borra la conversación del widget que sigue dentro de la retención", () => {
    expect(planWidgetPurge([conv({ id: "viva", updatedAt: daysAgo(29) })], cutoff)).toEqual([]);
  });

  it("borra la conversación CERRADA aunque su actividad sea reciente", () => {
    const cerrada = conv({
      id: "cerrada",
      updatedAt: daysAgo(1),
      metadata: { session: { closedAt: daysAgo(1).toISOString() } },
    });
    expect(planWidgetPurge([cerrada], cutoff)).toEqual(["cerrada"]);
  });

  it("la marca de cierre de un flujo de captación no cuenta como cierre de sesión", () => {
    const captacion = conv({ id: "lead", metadata: { leadFlow: { step: "closed" } } });
    expect(planWidgetPurge([captacion], cutoff)).toEqual([]);
  });

  it("una fila sin canal se trata como widget (filas anteriores a persistir el canal)", () => {
    const sinCanal = conv({ id: "antigua", channel: null, updatedAt: daysAgo(40) });
    expect(planWidgetPurge([sinCanal], cutoff)).toEqual(["antigua"]);
  });

  it("sin actividad registrada no hay caducidad que afirmar: no se borra por tiempo", () => {
    const sinFecha = conv({ id: "sin-fecha", updatedAt: null, createdAt: null });
    expect(planWidgetPurge([sinFecha], cutoff)).toEqual([]);
  });

  it("usa createdAt cuando la fila todavía no tiene updatedAt", () => {
    const soloCreada = conv({ id: "solo-creada", updatedAt: undefined, createdAt: daysAgo(45) });
    expect(planWidgetPurge([soloCreada], cutoff)).toEqual(["solo-creada"]);
  });

  it("RIESGO — ningún canal de mensajería se purga, ni viejo ni cerrado ni sin metadata", () => {
    for (const channel of ["telegram", "whatsapp", "openclaw"]) {
      const rows = [
        conv({ id: `${channel}-vieja`, channel, updatedAt: daysAgo(9999), createdAt: daysAgo(9999) }),
        conv({
          id: `${channel}-cerrada`,
          channel,
          updatedAt: daysAgo(1),
          metadata: { session: { closedAt: daysAgo(1).toISOString() } },
        }),
        conv({ id: `${channel}-sin-meta`, channel, metadata: null, updatedAt: daysAgo(5000) }),
      ];
      expect(planWidgetPurge(rows, cutoff), channel).toEqual([]);
    }
  });

  it("filtro SQL y semántica de sesión dicen lo mismo canal a canal", () => {
    // `planWidgetPurge` filtra por canal con la MISMA regla que `usesExpiringSession`. Si alguien
    // cambia una de las dos, esta prueba lo dice antes de que la purga borre un hilo ajeno.
    for (const channel of ["widget", null, "telegram", "whatsapp", "openclaw"]) {
      const ids = planWidgetPurge(
        [conv({ id: "x", channel, updatedAt: daysAgo(9999), createdAt: daysAgo(9999) })],
        cutoff
      );
      expect(ids.length === 1, String(channel)).toBe(usesExpiringSession(channel));
    }
  });

  it("devuelve ids, no filas: lo que se borra es exactamente lo planificado", () => {
    const rows = [
      conv({ id: "a", updatedAt: daysAgo(31) }),
      conv({ id: "b", updatedAt: daysAgo(2) }),
      conv({ id: "c", channel: "telegram", updatedAt: daysAgo(400) }),
    ];
    expect(planWidgetPurge(rows, cutoff)).toEqual(["a"]);
  });
});

// ── El runner ────────────────────────────────────────────────────────────────

describe("purgeExpiredConversations — lectura acotada + borrado por ids", () => {
  it("lee candidatas por el índice nuevo, con el canal acotado en SQL", async () => {
    const { prisma, findMany } = fakePrisma([]);

    await purgeExpiredConversations(prisma, { now: NOW, retentionDays: 30 });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toEqual({
      where: {
        updatedAt: { lt: retentionCutoff(NOW, 30) },
        // El filtro de canal NO se aplica en memoria: una conversación de telegram no debe
        // entrar siquiera en el conjunto de candidatas.
        OR: [{ channel: "widget" }, { channel: null }],
      },
      select: { id: true, channel: true, metadata: true, updatedAt: true },
    });
  });

  it("RIESGO — el deleteMany lleva los ids planificados Y el filtro de canal (nunca sólo la fecha)", async () => {
    const rows = [
      conv({ id: "w1", updatedAt: daysAgo(31) }),
      conv({ id: "w2", updatedAt: daysAgo(40) }),
      // Aunque la lectura ya lo impide, la prueba comprueba que el borrado tampoco arrastraría un
      // hilo de canal si alguna vez llegara en el lote.
      conv({ id: "tg1", channel: "telegram", updatedAt: daysAgo(400) }),
      conv({ id: "viva", updatedAt: daysAgo(1) }),
    ];
    const { prisma, deleteMany } = fakePrisma(rows);

    const out = await purgeExpiredConversations(prisma, { now: NOW, retentionDays: 30 });

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const where = (deleteMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.id).toEqual({ in: ["w1", "w2"] });
    expect(where.OR).toEqual([{ channel: "widget" }, { channel: null }]);
    // Y lo que NO puede haber: un borrado por fecha a secas.
    expect(where).not.toHaveProperty("updatedAt");
    expect(where).not.toHaveProperty("createdAt");
    expect(out).toEqual({ deleted: 2, chunks: 1 });
  });

  it("una conversación de canal nunca aparece en el borrado, ni siquiera si la lectura la trae", async () => {
    const { prisma, deleteMany } = fakePrisma([
      conv({ id: "tg1", channel: "telegram", updatedAt: daysAgo(400) }),
      conv({ id: "wa1", channel: "whatsapp", updatedAt: daysAgo(400) }),
    ]);

    const out = await purgeExpiredConversations(prisma, { now: NOW, retentionDays: 30 });

    expect(deleteMany).not.toHaveBeenCalled();
    expect(out).toEqual({ deleted: 0, chunks: 0 });
  });

  it("borra en trozos de 500 ids (una sola sentencia por trozo) y suma los borrados reales", async () => {
    const rows: RetentionCandidate[] = Array.from({ length: 1201 }, (_, i) =>
      conv({ id: `c${i}`, updatedAt: daysAgo(31) })
    );
    const { prisma, deleteMany } = fakePrisma(rows);

    const out = await purgeExpiredConversations(prisma, { now: NOW, retentionDays: 30 });

    expect(PURGE_CHUNK_SIZE).toBe(500);
    expect(deleteMany).toHaveBeenCalledTimes(3);
    const sizes = deleteMany.mock.calls.map(
      (c) => (c[0] as { where: { id: { in: string[] } } }).where.id.in.length
    );
    expect(sizes).toEqual([500, 500, 201]);
    expect(out).toEqual({ deleted: 1201, chunks: 3 });
  });

  it("cuenta lo que la BD dice haber borrado, no lo que pidió", async () => {
    const { prisma, deleteMany } = fakePrisma([
      conv({ id: "w1", updatedAt: daysAgo(31) }),
      conv({ id: "w2", updatedAt: daysAgo(31) }),
    ]);
    // Otra transacción se llevó una fila delante de nosotros.
    deleteMany.mockResolvedValue({ count: 1 });

    const out = await purgeExpiredConversations(prisma, { now: NOW, retentionDays: 30 });

    expect(out).toEqual({ deleted: 1, chunks: 1 });
  });

  it("sin candidatas no llama a deleteMany (no hay borrado vacío)", async () => {
    const { prisma, deleteMany } = fakePrisma([]);

    const out = await purgeExpiredConversations(prisma, { now: NOW, retentionDays: 30 });

    expect(deleteMany).not.toHaveBeenCalled();
    expect(out).toEqual({ deleted: 0, chunks: 0 });
  });

  it("el default de retención es 30 días y se puede inyectar otro", async () => {
    const { prisma, findMany } = fakePrisma([]);

    await purgeExpiredConversations(prisma, { now: NOW });
    expect(findMany.mock.calls[0][0].where.updatedAt.lt).toEqual(retentionCutoff(NOW, 30));

    await purgeExpiredConversations(prisma, { now: NOW, retentionDays: 7 });
    expect(findMany.mock.calls[1][0].where.updatedAt.lt).toEqual(retentionCutoff(NOW, 7));
  });
});
