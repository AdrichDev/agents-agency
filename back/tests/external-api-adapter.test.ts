/**
 * T1.2 — aa-agent-external-crm-and-lead-qualification F1 (design.md §B).
 * Cubre `ExternalApiAdapter` con `fetchImpl` inyectado (mock, sin red real):
 * método→endpoint→body correctos, gate de capability, Bearer presente/
 * ausente, input SOLO como query/body (nunca interpolado en la URL),
 * `cancelarReserva`/`consultarPedido` no-soportado honesto, timeout → error
 * de tool, `notificar` NUNCA lanza.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ExternalApiAdapter,
  CapabilityNotEnabledError,
  ExternalApiNotSupportedError,
  ExternalApiRequestError,
} from "@/lib/agent-backend/external-api";

vi.mock("@/lib/agent-backend/notify-dispatcher", () => ({
  dispatchNotification: vi.fn(),
}));
import { dispatchNotification } from "@/lib/agent-backend/notify-dispatcher";

function jsonResponse(status: number, body: unknown) {
  return { status, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

describe("ExternalApiAdapter — guardarLead", () => {
  it("POST /api/public/leads con businessId + body correctos, sin Bearer si no hay apiKey", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { id: "lead-1" }));
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      capabilities: ["leads"],
      fetchImpl,
    });

    const lead = await adapter.guardarLead({ nombre: "Ana", email: "ana@x.com" }, "quiere presupuesto");

    expect(lead.id).toBe("lead-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/api/public/leads");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      businessId: "biz-1",
      nombre: "Ana",
      email: "ana@x.com",
      telefono: undefined,
      peticion: "quiere presupuesto",
    });
  });

  it("agrega Bearer cuando apiKey está configurada", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { id: "lead-2" }));
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      apiKey: "secret-123",
      businessId: "biz-1",
      capabilities: ["leads"],
      fetchImpl,
    });

    await adapter.guardarLead({ nombre: "Ana" }, "info");

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer secret-123");
  });

  it("rechaza sin llamar a fetch si la capability 'leads' no está habilitada", async () => {
    const fetchImpl = vi.fn();
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      capabilities: ["reservas"],
      locationId: "loc-1",
      fetchImpl,
    });

    await expect(adapter.guardarLead({ nombre: "Ana" }, "info")).rejects.toBeInstanceOf(
      CapabilityNotEnabledError
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("status no-201 del CRM → ExternalApiRequestError honesto", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, { error: { message: "nombre inválido" } }));
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      capabilities: ["leads"],
      fetchImpl,
    });

    await expect(adapter.guardarLead({ nombre: "Ana" }, "info")).rejects.toBeInstanceOf(
      ExternalApiRequestError
    );
  });
});

describe("ExternalApiAdapter — consultarDisponibilidad", () => {
  it("itera 1 request GET por día, con businessId/date/serviceId/locationId como query (no URL interpolada)", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const u = new URL(url);
      const date = u.searchParams.get("date");
      if (date === "2026-08-01") {
        return Promise.resolve(
          jsonResponse(200, [
            { hora: "09:00", disponible: true },
            { hora: "09:30", disponible: true },
            { hora: "10:00", disponible: false },
          ])
        );
      }
      return Promise.resolve(jsonResponse(200, []));
    });
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      locationId: "loc-1",
      capabilities: ["reservas"],
      fetchImpl,
    });

    const slots = await adapter.consultarDisponibilidad("corte", {
      desde: new Date("2026-08-01T00:00:00.000Z"),
      hasta: new Date("2026-08-02T00:00:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2); // 01 y 02 de agosto, inclusive
    const [url0, init0] = fetchImpl.mock.calls[0];
    const u0 = new URL(url0);
    expect(u0.pathname).toBe("/api/public/availability");
    expect(u0.searchParams.get("businessId")).toBe("biz-1");
    expect(u0.searchParams.get("serviceId")).toBe("corte");
    expect(u0.searchParams.get("locationId")).toBe("loc-1");
    expect(init0.method).toBe("GET");

    // Solo los disponibles=true entran, paso deducido de 09:00→09:30 = 30min
    expect(slots).toEqual([
      { startTime: "2026-08-01T09:00:00.000Z", endTime: "2026-08-01T09:30:00.000Z" },
      { startTime: "2026-08-01T09:30:00.000Z", endTime: "2026-08-01T10:00:00.000Z" },
    ]);
  });

  it("rechaza sin llamar a fetch si la capability 'reservas' no está habilitada", async () => {
    const fetchImpl = vi.fn();
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      capabilities: ["leads"],
      fetchImpl,
    });

    await expect(
      adapter.consultarDisponibilidad("corte", { desde: new Date(), hasta: new Date() })
    ).rejects.toBeInstanceOf(CapabilityNotEnabledError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("construir el adapter con capability 'reservas' sin locationId falla rápido (config inválida)", () => {
    expect(
      () =>
        new ExternalApiAdapter({
          agentId: "a1",
          apiBaseUrl: "https://crm.example.com",
          businessId: "biz-1",
          capabilities: ["reservas"],
        })
    ).toThrow(/locationId/);
  });
});

describe("ExternalApiAdapter — crearReserva", () => {
  it("POST /api/public/bookings con body correcto → Reserva mapeada", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { id: "book-1" }));
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      locationId: "loc-1",
      capabilities: ["reservas"],
      fetchImpl,
    });

    const slot = { startTime: "2026-08-01T09:00:00.000Z", endTime: "2026-08-01T09:30:00.000Z" };
    const reserva = await adapter.crearReserva("corte", slot, { nombre: "Ana", telefono: "600" });

    expect(reserva).toEqual({
      id: "book-1",
      servicioId: "corte",
      servicioNombre: "corte",
      startTime: slot.startTime,
      endTime: slot.endTime,
      estado: "PENDING",
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://crm.example.com/api/public/bookings");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      businessId: "biz-1",
      locationId: "loc-1",
      serviceId: "corte",
      start: slot.startTime,
      notes: undefined,
      customer: { nombre: "Ana", email: undefined, telefono: "600" },
    });
  });

  it("409 del CRM (slot ya no disponible) → ExternalApiRequestError con status 409", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: { message: "conflicto" } }));
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      locationId: "loc-1",
      capabilities: ["reservas"],
      fetchImpl,
    });

    const slot = { startTime: "2026-08-01T09:00:00.000Z", endTime: "2026-08-01T09:30:00.000Z" };
    await expect(adapter.crearReserva("corte", slot, { nombre: "Ana" })).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("ExternalApiAdapter — no soportado honesto (sin tocar la red)", () => {
  it("cancelarReserva lanza ExternalApiNotSupportedError sin llamar a fetch", async () => {
    const fetchImpl = vi.fn();
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      capabilities: ["reservas", "leads"],
      locationId: "loc-1",
      fetchImpl,
    });

    await expect(adapter.cancelarReserva("res-1")).rejects.toBeInstanceOf(ExternalApiNotSupportedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("consultarPedido devuelve encontrado:false sin llamar a fetch (pedidos nunca habilitable, T1.5)", async () => {
    const fetchImpl = vi.fn();
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      capabilities: ["reservas", "leads"],
      locationId: "loc-1",
      fetchImpl,
    });

    await expect(adapter.consultarPedido("P-1")).resolves.toEqual({ encontrado: false, codigo: "P-1" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ExternalApiAdapter — timeout y notificar", () => {
  beforeEach(() => {
    vi.mocked(dispatchNotification).mockReset();
  });

  it("timeout (AbortController) → ExternalApiRequestError, no cuelga el test", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      capabilities: ["leads"],
      fetchImpl,
      timeoutMs: 5,
    });

    await expect(adapter.guardarLead({ nombre: "Ana" }, "info")).rejects.toBeInstanceOf(
      ExternalApiRequestError
    );
  });

  it("notificar delega en dispatchNotification y NUNCA lanza, incluso si éste rechaza", async () => {
    vi.mocked(dispatchNotification).mockRejectedValueOnce(new Error("telegram caído"));
    const adapter = new ExternalApiAdapter({
      agentId: "a1",
      apiBaseUrl: "https://crm.example.com",
      businessId: "biz-1",
      capabilities: ["leads"],
      fetchImpl: vi.fn(),
    });

    await expect(adapter.notificar("nuevo_lead", { nombre: "Ana" })).resolves.toBeUndefined();
    expect(dispatchNotification).toHaveBeenCalledWith("a1", "nuevo_lead", { nombre: "Ana" });
  });
});
