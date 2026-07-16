import { describe, expect, it } from "vitest";
import { extractContactDetails, initialLeadFlowState, nextLeadFlowStep } from "@/lib/lead-flow";

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

describe("lead flow", () => {
  describe("F5 (AC6): flujo relajado — no bloquea pidiendo el nombre", () => {
    it("arranca en assisting, no en awaiting_name", () => {
      expect(initialLeadFlowState().step).toBe("assisting");
    });

    it("un saludo NO se intercepta: responde el agente (handled=false)", () => {
      const result = nextLeadFlowStep(undefined, "hola");
      expect(result.handled).toBe(false);
      expect(result.nextState.step).toBe("assisting");
    });

    it("una pregunta directa NO se bloquea pidiendo el nombre", () => {
      const result = nextLeadFlowStep(undefined, "¿cuánto cuesta el servicio premium?");
      expect(result.handled).toBe(false);
      expect(result.reply).toBeUndefined();
    });

    it("captura pasiva: 'me llamo X' guarda el nombre SIN interceptar la respuesta", () => {
      const result = nextLeadFlowStep(undefined, "Hola, me llamo Adrián, ¿tenéis cita mañana?");
      expect(result.handled).toBe(false);
      expect(result.nextState.customerName).toBe("Adrián");
    });

    it("un mensaje suelto NO se interpreta como nombre", () => {
      const result = nextLeadFlowStep(undefined, "Adrian");
      expect(result.handled).toBe(false);
      expect(result.nextState.customerName).toBeUndefined();
    });

    it("estado legado awaiting_name (conversaciones persistidas) deja de bloquear", () => {
      const result = nextLeadFlowStep({ step: "awaiting_name" }, "¿hacéis envíos a Canarias?");
      expect(result.handled).toBe(false);
      expect(result.nextState.step).toBe("assisting");
    });

    it("no sobreescribe un nombre ya conocido", () => {
      const result = nextLeadFlowStep(
        { step: "assisting", customerName: "Marta" },
        "soy cliente desde hace años"
      );
      expect(result.nextState.customerName).toBe("Marta");
    });
  });

  it("detects positive contact consent", () => {
    const result = nextLeadFlowStep({ step: "awaiting_contact_consent", customerName: "Adrian" }, "si por favor");

    expect(result.handled).toBe(true);
    expect(result.nextState.step).toBe("awaiting_contact_details");
  });

  it("extracts email and phone", () => {
    expect(extractContactDetails("correo test@example.com y telefono +34 600 123 123")).toEqual({
      email: "test@example.com",
      phone: "+34 600 123 123",
    });
  });

  describe("estilo natural de las respuestas fijas", () => {
    it("ninguna respuesta fija suena robótica ni encadena dos preguntas", () => {
      const replies = [
        nextLeadFlowStep({ step: "awaiting_contact_consent", customerName: "Marta" }, "vale").reply,
        nextLeadFlowStep({ step: "awaiting_contact_consent", customerName: "Marta" }, "no").reply,
        nextLeadFlowStep({ step: "awaiting_contact_details", customerName: "Marta" }, "test@example.com y 600123123").reply,
      ].filter(Boolean) as string[];

      expect(replies.length).toBeGreaterThan(0);
      for (const reply of replies) {
        expect(reply).not.toMatch(/absolutamente|no dudes en|encantado de asistir|asistente virtual/i);
        const questions = (reply.match(/\?/g) ?? []).length;
        expect(questions).toBeLessThanOrEqual(1);
        expect((reply.match(EMOJI_RE) ?? []).length).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("awaiting_contact_details", () => {
    const state = { step: "awaiting_contact_details" as const, customerName: "Adrian" };

    it("creates the lead when both email and phone arrive together", () => {
      const result = nextLeadFlowStep(state, "test@example.com y +34 600 123 123");

      expect(result.handled).toBe(true);
      expect(result.nextState.step).toBe("post_contact");
      expect(result.createLead).toMatchObject({ email: "test@example.com", consent: true });
    });

    it("accumulates partial details across messages (email first, phone later)", () => {
      const afterEmail = nextLeadFlowStep(state, "mi correo es test@example.com");

      expect(afterEmail.handled).toBe(true);
      expect(afterEmail.nextState.email).toBe("test@example.com");
      expect(afterEmail.nextState.step).toBe("awaiting_contact_details");
      expect(afterEmail.reply).toContain("teléfono");

      const afterPhone = nextLeadFlowStep(afterEmail.nextState, "600123123");

      expect(afterPhone.handled).toBe(true);
      expect(afterPhone.nextState.step).toBe("post_contact");
      expect(afterPhone.createLead).toMatchObject({ email: "test@example.com", phone: "600123123" });
    });

    it("does NOT loop when the user changes topic — lets the agent answer", () => {
      const result = nextLeadFlowStep(state, "¿cuánto cuesta una limpieza dental?");

      expect(result.handled).toBe(false);
      expect(result.nextState.step).toBe("awaiting_contact_details");
    });

    it("re-asks only when the user talks about contact details without providing them", () => {
      const result = nextLeadFlowStep(state, "no me acuerdo de mi correo ahora");

      expect(result.handled).toBe(true);
      expect(result.nextState.step).toBe("awaiting_contact_details");
    });

    it("respects refusal and goes back to assisting", () => {
      const result = nextLeadFlowStep(state, "no gracias");

      expect(result.handled).toBe(true);
      expect(result.nextState.step).toBe("assisting");
    });
  });
});
