/**
 * H6 (aa-stripe-suscripciones, T5.4) — E4 y E5: el corte por impago.
 *
 * Las dos mitades son inseparables. E4 exige que un `past_due` corte; E5 exige que un `null` NO corte.
 * Un gate que hiciera sólo lo primero dejaría mudos, el día del despliegue, a los tenants que hay hoy
 * en producción — que no tienen suscripción y por tanto tienen `subscriptionStatus = null`.
 *
 * Y hay una tercera cosa que probar y que no está en la lista de escenarios: que los tres mensajes son
 * DISTINTOS (AC7). Si el corte por impago reutilizara el texto de suspensión, todos los tests de
 * comportamiento pasarían igual y el cliente seguiría sin saber que tiene que pagar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), updateMany: vi.fn() },
    agent: { count: vi.fn() },
    tokenUsage: { aggregate: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { DEFAULT_TOKEN_QUOTA_PER_AGENT } from "@/lib/quota";
import { checkClientBalance } from "@/lib/token-metering";

const mockFind = prisma.tenant.findUnique as ReturnType<typeof vi.fn>;
const PERIOD_START = new Date("2026-07-27T00:00:00.000Z");

const tenant = (over: Record<string, unknown> = {}) => ({
  isActive: true,
  subscriptionStatus: null,
  tokenBalance: null,
  plan: null,
  tokensUsedPeriod: 0,
  periodStart: PERIOD_START,
  periodAnchorDay: 27,
  credentialMode: "platform",
  ...over,
});

/** Ejecuta el gate y devuelve el mensaje del 402, o null si no cortó. */
async function mensajeDeCorte(estado: Record<string, unknown>): Promise<string | null> {
  mockFind.mockResolvedValue(estado);
  try {
    await checkClientBalance("t1");
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.tenant.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
  (prisma.agent.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  (prisma.tokenUsage.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
    _sum: { tokens: 0 },
  });
});

// ---------------------------------------------------------------------------
// E4 (AC6, AC7) — impago corta con su propio mensaje
// ---------------------------------------------------------------------------

describe("E4 (AC6, AC7) — el impago corta", () => {
  it("past_due corta con un mensaje que habla de pago", async () => {
    const msg = await mensajeDeCorte(tenant({ subscriptionStatus: "past_due" }));
    expect(msg).toMatch(/pago/i);
  });

  it("unpaid y canceled cortan igual", async () => {
    for (const estado of ["unpaid", "canceled"]) {
      const msg = await mensajeDeCorte(tenant({ subscriptionStatus: estado }));
      expect(msg, estado).toMatch(/pago/i);
    }
  });

  it("el mensaje de impago NO es el de cuota ni el de suspensión (AC7: tres textos distintos)", async () => {
    const impago = await mensajeDeCorte(tenant({ subscriptionStatus: "past_due" }));
    const suspendido = await mensajeDeCorte(tenant({ isActive: false }));
    const sinCupo = await mensajeDeCorte(
      tenant({ tokenBalance: 10, tokensUsedPeriod: 10 })
    );

    expect(impago).toBeTruthy();
    expect(suspendido).toBeTruthy();
    expect(sinCupo).toBeTruthy();
    expect(new Set([impago, suspendido, sinCupo]).size).toBe(3);
    // Y el de impago no manda al administrador: quien tiene que actuar es el propio cliente.
    expect(impago).not.toMatch(/administrador/i);
  });

  it("corta ANTES del cupo: con cupo agotado Y past_due gana el mensaje de pago", async () => {
    // El orden es la parte útil. Con el mensaje de cuota, un cliente moroso se pondría a investigar
    // por qué gasta tanto en lugar de mirar su suscripción.
    const msg = await mensajeDeCorte(
      tenant({
        subscriptionStatus: "past_due",
        tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT,
      })
    );
    expect(msg).toMatch(/pago/i);
  });

  it("pero la suspensión manual sigue teniendo prioridad sobre el impago", async () => {
    // `isActive === false` es la decisión de una persona; es la que se le comunica primero.
    const msg = await mensajeDeCorte(
      tenant({ isActive: false, subscriptionStatus: "past_due" })
    );
    expect(msg).toMatch(/administrador/i);
  });
});

// ---------------------------------------------------------------------------
// T5.3 — los dos modos de credencial
// ---------------------------------------------------------------------------

describe("T5.3 — byok no dispensa del impago", () => {
  it("un tenant byok en past_due también se corta", async () => {
    // Traer tu propia clave paga los tokens, no la plataforma. Si byok esquivara este corte, sería la
    // forma de seguir atendido sin pagar la suscripción.
    const msg = await mensajeDeCorte(
      tenant({ credentialMode: "byok", subscriptionStatus: "past_due" })
    );
    expect(msg).toMatch(/pago/i);
  });

  it("un tenant byok al corriente sigue atendiéndose y sin pasar por el cupo", async () => {
    mockFind.mockResolvedValue(
      tenant({
        credentialMode: "byok",
        subscriptionStatus: "active",
        tokensUsedPeriod: DEFAULT_TOKEN_QUOTA_PER_AGENT * 10,
      })
    );
    // El cupo no aplica en byok (H2): paga sus tokens. Lo que sí aplica es la suscripción.
    await expect(checkClientBalance("t1")).resolves.toBe("byok");
  });
});

// ---------------------------------------------------------------------------
// E5 (AC6) — null no corta
// ---------------------------------------------------------------------------

describe("E5 (AC6) — sin suscripción no se corta a nadie", () => {
  it("subscriptionStatus null atiende con normalidad", async () => {
    mockFind.mockResolvedValue(tenant({ subscriptionStatus: null }));
    await expect(checkClientBalance("t1")).resolves.toBe("platform");
  });

  it("undefined (columna ausente en un select viejo) tampoco corta", async () => {
    const { subscriptionStatus: _omitido, ...sinColumna } = tenant();
    mockFind.mockResolvedValue(sinColumna);
    await expect(checkClientBalance("t1")).resolves.toBe("platform");
  });

  it("con null, el cupo y el isActive siguen cortando igual", async () => {
    // El fail-open está acotado a ESTA columna. Aflojar de paso el fail-closed de H1 sería regalar el
    // servicio a cualquiera sin suscripción.
    expect(
      await mensajeDeCorte(tenant({ subscriptionStatus: null, isActive: false }))
    ).toBeTruthy();
    expect(
      await mensajeDeCorte(
        tenant({ subscriptionStatus: null, tokenBalance: 5, tokensUsedPeriod: 5 })
      )
    ).toBeTruthy();
  });

  it("los estados no bloqueantes de Stripe no cortan", async () => {
    // `trialing`: está dentro de lo pactado. `incomplete`: el primer cobro se está resolviendo, cortar
    // ahí sería cortar durante el alta. `paused`: lo pausa el propietario en Stripe, y si quiere cortar
    // el servicio tiene `isActive`.
    for (const estado of ["active", "trialing", "incomplete", "paused"]) {
      mockFind.mockResolvedValue(tenant({ subscriptionStatus: estado }));
      await expect(checkClientBalance("t1"), estado).resolves.toBe("platform");
    }
  });

  it("un estado desconocido de Stripe no corta", async () => {
    // Fail-open deliberado ante lo desconocido: la lista de bloqueo es explícita. Si Stripe inventa un
    // estado nuevo, el efecto es seguir atendiendo, no cortar a un cliente que paga por un valor que
    // nadie ha revisado todavía.
    mockFind.mockResolvedValue(tenant({ subscriptionStatus: "estado_que_stripe_aun_no_tiene" }));
    await expect(checkClientBalance("t1")).resolves.toBe("platform");
  });
});
