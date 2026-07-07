/**
 * service-operator-agenda.test.ts — aa-bot-agenda-citas-tool.
 *
 * Cubre GET /service/operator/agenda y /agenda/huecos: listado de citas de la
 * agenda del owner (PlatformAppointment, espejo de Google Calendar) y cálculo
 * de huecos libres por día. Mismo patrón que service-operator.test.ts: prisma
 * mockeado, handlers importados y llamados con req/res simulados.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prismaMock: any = {
    platformAppointment: { findMany: vi.fn() },
  };
  return { prisma: prismaMock };
});
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { prisma } from "@/lib/db";
import { agendaListarHandler, agendaHuecosHandler } from "@/routes/service-operator";

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = vi.fn((b: any) => {
    res.body = b;
    return res;
  });
  return res;
}

function mockReq(query: Record<string, string> = {}) {
  return { query } as any;
}

/** Construye una cita local (hora de pared) para el día/hora dados. */
function appt(dateStr: string, hh: number, mm: number, durMin = 30, extra: Record<string, unknown> = {}) {
  const startAt = new Date(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`);
  const endAt = new Date(startAt.getTime() + durMin * 60_000);
  return { id: "x", client: "Cliente", service: "Servicio", status: "Confirmada", startAt, endAt, ...extra };
}

beforeEach(() => {
  (prisma.platformAppointment.findMany as any).mockReset();
});

describe("GET /service/operator/agenda", () => {
  it("devuelve las citas del rango mapeadas a fecha/hora/cliente/servicio/estado", async () => {
    (prisma.platformAppointment.findMany as any).mockResolvedValue([
      appt("2026-07-07", 17, 0, 30, { client: "Cita Hospital", service: "Cita Hospital" }),
    ]);
    const res = mockRes();
    await agendaListarHandler(mockReq({ desde: "2026-07-06", hasta: "2026-07-12" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.citas[0]).toMatchObject({
      fecha: "2026-07-07",
      hora: "17:00",
      cliente: "Cita Hospital",
      servicio: "Cita Hospital",
      estado: "Confirmada",
    });
  });

  it("rechaza fechas con formato inválido con 400", async () => {
    const res = mockRes();
    await agendaListarHandler(mockReq({ desde: "07-2026" }), res);
    expect(res.statusCode).toBe(400);
    expect(prisma.platformAppointment.findMany as any).not.toHaveBeenCalled();
  });

  it("excluye las canceladas vía filtro de la query", async () => {
    (prisma.platformAppointment.findMany as any).mockResolvedValue([]);
    const res = mockRes();
    await agendaListarHandler(mockReq({ desde: "2026-07-07", hasta: "2026-07-07" }), res);
    const whereArg = (prisma.platformAppointment.findMany as any).mock.calls[0][0].where;
    expect(whereArg.status).toEqual({ not: "Cancelada" });
  });
});

describe("GET /service/operator/agenda/huecos", () => {
  it("cuenta 19 huecos libres en un día con una sola cita (20 slots − 1)", async () => {
    (prisma.platformAppointment.findMany as any).mockResolvedValue([appt("2026-07-07", 9, 0)]);
    const res = mockRes();
    await agendaHuecosHandler(mockReq({ desde: "2026-07-07", hasta: "2026-07-07" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.dias).toEqual([{ dia: "2026-07-07", huecos_libres: 19 }]);
  });

  it("un día sin citas tiene 20 huecos libres (09:00–19:00, 30 min)", async () => {
    (prisma.platformAppointment.findMany as any).mockResolvedValue([]);
    const res = mockRes();
    await agendaHuecosHandler(mockReq({ desde: "2026-07-08", hasta: "2026-07-08" }), res);
    expect(res.body.dias).toEqual([{ dia: "2026-07-08", huecos_libres: 20 }]);
  });
});
