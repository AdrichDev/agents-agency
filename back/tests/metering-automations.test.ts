/**
 * H1 (aa-metering-fail-closed) — El consumo de las automatizaciones también se contabiliza.
 *
 * `runAutomation` llama a `runAgent` **directamente**, sin pasar por `chatWithAgent`. El gate
 * de saldo lo heredaba (vive en `runAgent`), pero la contabilidad estaba sólo en
 * `chatWithAgent`: un tenant que usara únicamente automatizaciones consumía la cuenta LLM sin
 * incrementar `tokensUsed` y sin dejar fila en `uso_tokens`. Invisible para el cupo, y por
 * tanto invisible para las cuotas de H4.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agent/engine", () => ({ runAgent: vi.fn() }));
vi.mock("@/lib/token-metering", () => ({ deductTokens: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    automation: { findUnique: vi.fn(), update: vi.fn() },
    automationRun: { create: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { runAgent } from "@/lib/agent/engine";
import { deductTokens } from "@/lib/token-metering";
import { runAutomation } from "@/lib/automations/engine";
import { HttpError } from "@/lib/http";

const mockRunAgent = runAgent as ReturnType<typeof vi.fn>;
const mockDeduct = deductTokens as ReturnType<typeof vi.fn>;
const mockFind = prisma.automation.findUnique as ReturnType<typeof vi.fn>;
const mockRunCreate = prisma.automationRun.create as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFind.mockResolvedValue({
    id: "auto-1",
    agentId: "a1",
    trigger: "schedule",
    prompt: "Resume el día",
    config: null,
    lastRunAt: null,
    agent: { integrations: [] },
  });
  mockRunCreate.mockResolvedValue({});
  (prisma.automation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe("metering de automatizaciones", () => {
  it("descuenta contra el tenant resuelto por el motor, con operacion 'automation'", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Hecho",
      toolCalls: [],
      tokensUsed: 88,
      model: "gpt-4o",
      meteredTenantId: "tenant-1",
    });

    const res = await runAutomation("auto-1");

    expect(res.status).toBe("ok");
    // Sin conversación asociada → conversationId null (la columna es opcional en el schema).
    expect(mockDeduct).toHaveBeenCalledWith("tenant-1", "a1", null, 88, "gpt-4o", "automation");
  });

  it("agente sin tenant en modo prueba: no hay a quién cobrar, no descuenta", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Hecho",
      toolCalls: [],
      tokensUsed: 10,
      model: "gpt-4o",
      meteredTenantId: null,
    });

    await runAutomation("auto-1");

    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it("sin tokens consumidos no se crea fila de consumo", async () => {
    mockRunAgent.mockResolvedValue({
      text: "SIN_NOVEDADES",
      toolCalls: [],
      tokensUsed: 0,
      model: "gpt-4o",
      meteredTenantId: "tenant-1",
    });

    const res = await runAutomation("auto-1");

    expect(res.status).toBe("skipped");
    expect(mockDeduct).not.toHaveBeenCalled();
  });

  it("el corte por cupo del gate queda registrado en el AutomationRun", async () => {
    mockRunAgent.mockRejectedValue(new HttpError(402, "Límite de uso del asistente excedido."));

    const res = await runAutomation("auto-1");

    expect(res.status).toBe("error");
    expect(res.summary).toMatch(/límite de uso/i);
    expect(mockDeduct).not.toHaveBeenCalled();
    // La ejecución se registra igual: el operador ve por qué no corrió.
    expect(mockRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "error" }) })
    );
  });
});
