/**
 * T1.4 (aa-puesta-en-marcha-agente) — `computeOnboardingState`.
 * Función pura, sin mocks ni BD. Cubre GWT4 (monotonía), GWT5/GWT6 (las dos
 * vías de `alcanzable`), GWT7/GWT8 (las dos exclusiones de `probado`) y AC2.
 */
import { describe, it, expect } from "vitest";
import {
  computeOnboardingState,
  ONBOARDING_STEPS,
  type OnboardingInput,
} from "@/lib/agent/onboarding";

const PUBLISHED_AT = new Date("2026-07-27T18:47:00Z");

/** Agente publicado, alcanzable por widget y con tráfico: el caso completo. */
function fullyLaunched(over: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    status: "published",
    publishedAt: PUBLISHED_AT,
    tenantId: "tenant_1",
    systemPrompt: "Eres el asistente de la peluquería.",
    channel: "widget",
    widgetInstalledAt: new Date("2026-07-27T18:49:00Z"),
    channelConnections: [],
    lastPublicConversationAt: new Date("2026-07-27T20:31:00Z"),
    ...over,
  };
}

describe("computeOnboardingState — el caso completo", () => {
  it("marca los cuatro escalones y no deja nada pendiente", () => {
    const s = computeOnboardingState(fullyLaunched());
    expect(s).toMatchObject({
      step: "probado",
      configurado: true,
      publicado: true,
      alcanzable: true,
      probado: true,
      nextLabel: null,
      nextTab: null,
    });
    expect(s.blocking).toEqual([]);
  });
});

describe("configurado", () => {
  it("es falso sin cliente asignado, y lo dice", () => {
    const s = computeOnboardingState(fullyLaunched({ tenantId: null }));
    expect(s.configurado).toBe(false);
    expect(s.step).toBeNull();
    expect(s.blocking.length).toBeGreaterThan(0);
    expect(s.nextLabel).toMatch(/cliente/i);
    // Sin pestaña a propósito: `tenantId` sólo se asigna en el wizard de creación, así
    // que desde la ficha no hay dónde arreglarlo. Un enlace aquí sería un callejón.
    expect(s.nextTab).toBeNull();
  });

  it("sin prompt, la acción manda a Ajustes: ahí es donde se edita", () => {
    // No a «Datos del negocio». El `systemPrompt` vive en `AgentModelPanel`, pestaña
    // Ajustes. Mandar a la pestaña equivocada quema el mismo clic que se quería ahorrar.
    const s = computeOnboardingState(fullyLaunched({ systemPrompt: "" }));
    expect(s.nextTab).toBe("ajustes");
    expect(s.nextLabel).toMatch(/prompt/i);
  });

  it("es falso con el prompt vacío o sólo espacios", () => {
    expect(computeOnboardingState(fullyLaunched({ systemPrompt: null })).configurado).toBe(false);
    expect(computeOnboardingState(fullyLaunched({ systemPrompt: "   " })).configurado).toBe(false);
  });

  it("sin configurar, todo lo demás cae aunque los datos digan que sí", () => {
    // AC2: la cascada no deja que un agente sin cliente parezca en marcha.
    const s = computeOnboardingState(fullyLaunched({ tenantId: null }));
    expect([s.publicado, s.alcanzable, s.probado]).toEqual([false, false, false]);
  });
});

describe("publicado", () => {
  it("GWT4 — un borrador con el widget instalado NO es alcanzable", () => {
    const s = computeOnboardingState(fullyLaunched({ status: "draft", publishedAt: null }));
    expect(s.publicado).toBe(false);
    expect(s.alcanzable).toBe(false);
    expect(s.probado).toBe(false);
    expect(s.step).toBe("configurado");
    expect(s.nextTab).toBe("implementacion");
  });

  it("`suspended` no cuenta como publicado: factura pero no atiende", () => {
    const s = computeOnboardingState(fullyLaunched({ status: "suspended" }));
    expect(s.publicado).toBe(false);
  });

  it("`archived` no cuenta como publicado", () => {
    expect(computeOnboardingState(fullyLaunched({ status: "archived" })).publicado).toBe(false);
  });

  it("`published` sin `publishedAt` es un dato roto y no cuenta", () => {
    const s = computeOnboardingState(fullyLaunched({ publishedAt: null }));
    expect(s.publicado).toBe(false);
  });
});

describe("alcanzable", () => {
  it("GWT6 — basta el ping del widget, sin ninguna conexión de canal", () => {
    const s = computeOnboardingState(fullyLaunched({ channelConnections: [] }));
    expect(s.alcanzable).toBe(true);
  });

  it("GWT5 — basta una conexión de canal activa, sin ping de widget", () => {
    const s = computeOnboardingState(
      fullyLaunched({
        widgetInstalledAt: null,
        channel: "whatsapp",
        channelConnections: [{ provider: "whatsapp", status: "active" }],
      })
    );
    expect(s.alcanzable).toBe(true);
  });

  it("una conexión pendiente o en error no alcanza", () => {
    for (const status of ["pending", "error"]) {
      const s = computeOnboardingState(
        fullyLaunched({
          widgetInstalledAt: null,
          channel: "telegram",
          channelConnections: [{ provider: "telegram", status }],
        })
      );
      expect(s.alcanzable, `status=${status}`).toBe(false);
    }
  });

  it("publicado sin widget ni canal se queda en `publicado`", () => {
    const s = computeOnboardingState(
      fullyLaunched({ widgetInstalledAt: null, channelConnections: [] })
    );
    expect(s.step).toBe("publicado");
    expect(s.nextTab).toBe("implementacion");
  });
});

describe("probado", () => {
  it("GWT7 — el tráfico anterior a la publicación no cuenta", () => {
    const s = computeOnboardingState(
      fullyLaunched({ lastPublicConversationAt: new Date("2026-07-20T10:00:00Z") })
    );
    expect(s.alcanzable).toBe(true);
    expect(s.probado).toBe(false);
    expect(s.step).toBe("alcanzable");
    expect(s.nextLabel).toMatch(/todavía no ha recibido/i);
    // Sin pestaña: la consola de pruebas marca `isTest` y no mueve este escalón, así que
    // mandar a «Probar agente» sería prometer un avance que no va a pasar.
    expect(s.nextTab).toBeNull();
  });

  it("GWT8 — sin ninguna conversación no-test, no está probado", () => {
    // `lastPublicConversationAt` ya llega filtrado por `isTest: false`: si la
    // única conversación es de la consola de pruebas, aquí llega null.
    const s = computeOnboardingState(fullyLaunched({ lastPublicConversationAt: null }));
    expect(s.probado).toBe(false);
  });

  it("el tráfico exactamente en el instante de publicar no cuenta (comparación estricta)", () => {
    const s = computeOnboardingState(fullyLaunched({ lastPublicConversationAt: PUBLISHED_AT }));
    expect(s.probado).toBe(false);
  });
});

describe("monotonía (AC2)", () => {
  it("los escalones nunca se saltan, sea cual sea la combinación de entrada", () => {
    const combos: Partial<OnboardingInput>[] = [
      {},
      { tenantId: null },
      { systemPrompt: "" },
      { status: "draft" },
      { status: "suspended" },
      { status: "archived" },
      { publishedAt: null },
      { widgetInstalledAt: null },
      { widgetInstalledAt: null, channelConnections: [{ provider: "telegram", status: "active" }] },
      { lastPublicConversationAt: null },
      { lastPublicConversationAt: new Date("2020-01-01T00:00:00Z") },
      { tenantId: null, status: "draft", widgetInstalledAt: null, lastPublicConversationAt: null },
    ];

    for (const over of combos) {
      const s = computeOnboardingState(fullyLaunched(over));
      const label = JSON.stringify(over);
      if (s.publicado) expect(s.configurado, label).toBe(true);
      if (s.alcanzable) expect(s.publicado, label).toBe(true);
      if (s.probado) expect(s.alcanzable, label).toBe(true);

      // `step` es siempre el último escalón en true, y coincide con las banderas.
      const reached = [s.configurado, s.publicado, s.alcanzable, s.probado].lastIndexOf(true);
      expect(s.step, label).toBe(reached === -1 ? null : ONBOARDING_STEPS[reached]);

      // Mientras quede algo pendiente, siempre se dice QUÉ falta. La pestaña es
      // opcional: hay dos pendientes que no se arreglan en ninguna pestaña de la ficha
      // (asignar cliente, recibir tráfico de fuera) y para esos `nextTab` es null.
      if (!s.probado) expect(s.nextLabel, label).toBeTruthy();
    }
  });
});

describe("warnings", () => {
  it("el canal declarado sin conexión avisa, pero no bloquea ni impide alcanzar", () => {
    // 3 de los agentes que sirven tráfico en producción declaran `whatsapp` sin
    // conexión y atienden por widget. Es un aviso, nunca un freno.
    const s = computeOnboardingState(fullyLaunched({ channel: "whatsapp", channelConnections: [] }));
    expect(s.blocking).toEqual([]);
    expect(s.warnings.length).toBeGreaterThan(0);
    expect(s.alcanzable).toBe(true);
  });
});
