/**
 * Lectura de fechas del modelo (aa-reservas-fecha-y-zona-del-modelo, bloque A).
 *
 * Fallo REAL medido contra el agente de Lafayette en produccion: el LLM emite el ISO SIN
 * offset ("2026-08-07T20:30:00") y `new Date()` lo leia en la zona del proceso, que en Render
 * es UTC. Las 20:30 acordadas con el cliente se convertian en las 22:30 de Madrid, asi que
 * `crear_reserva` buscaba un hueco inexistente y devolvia SIEMPRE "el slot ya no esta
 * disponible" — que el modelo traslada al cliente como "estamos completos". Cuatro intentos,
 * cero reservas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { agentSchedule: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { parseIsoInZone, getAgentTimezone, DEFAULT_TIMEZONE } from "@/lib/booking/timezone";

const mFindUnique = prisma.agentSchedule.findUnique as ReturnType<typeof vi.fn>;

describe("parseIsoInZone (AC1)", () => {
  it("un ISO naive se lee en la zona del negocio", () => {
    const d = parseIsoInZone("2026-08-08T21:00:00", "Europe/Madrid");
    // Las 21:00 de un cliente que habla con un restaurante de Madrid son las 21:00 de Madrid.
    expect(d.toUTC().toISO()).toBe("2026-08-08T19:00:00.000Z");
  });

  it("un ISO con offset se respeta tal cual", () => {
    // Ya es un instante sin ambiguedad: reinterpretarlo en otra zona lo moveria. Es la forma
    // en la que `generateSlots` devuelve los huecos y en la que el modelo los repite.
    const d = parseIsoInZone("2026-08-08T21:00:00+02:00", "Atlantic/Canary");
    expect(d.toUTC().toISO()).toBe("2026-08-08T19:00:00.000Z");
  });

  it("un ISO con Z tampoco se reinterpreta", () => {
    const d = parseIsoInZone("2026-08-08T19:00:00.000Z", "Europe/Madrid");
    expect(d.toUTC().toISO()).toBe("2026-08-08T19:00:00.000Z");
  });

  it("una fecha sin hora se ancla a la medianoche del negocio", () => {
    const d = parseIsoInZone("2026-08-08", "Europe/Madrid");
    expect(d.toUTC().toISO()).toBe("2026-08-07T22:00:00.000Z");
  });

  it("respeta una zona distinta de la peninsular", () => {
    const d = parseIsoInZone("2026-08-08T21:00:00", "Atlantic/Canary");
    expect(d.toUTC().toISO()).toBe("2026-08-08T20:00:00.000Z");
  });

  it("un ISO invalido no se da por bueno", () => {
    expect(parseIsoInZone("el sabado por la noche", "Europe/Madrid").isValid).toBe(false);
  });
});

describe("getAgentTimezone", () => {
  beforeEach(() => {
    mFindUnique.mockReset();
  });

  it("devuelve la zona configurada del agente", async () => {
    mFindUnique.mockResolvedValue({ timezone: "Atlantic/Canary" });
    await expect(getAgentTimezone("a1")).resolves.toBe("Atlantic/Canary");
  });

  it("cae a la zona por defecto si el agente no tiene horario", async () => {
    mFindUnique.mockResolvedValue(null);
    await expect(getAgentTimezone("a1")).resolves.toBe(DEFAULT_TIMEZONE);
  });
});
