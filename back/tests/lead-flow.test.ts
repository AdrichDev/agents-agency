import { describe, expect, it } from "vitest";
import { extractContactDetails, initialLeadFlowState, nextLeadFlowStep } from "@/lib/lead-flow";

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

describe("lead flow", () => {
  it("starts by storing the customer name", () => {
    const result = nextLeadFlowStep(undefined, "Adrian");

    expect(result.handled).toBe(true);
    expect(result.nextState.customerName).toBe("Adrian");
    expect(result.nextState.step).toBe("assisting");
    expect(result.reply).toContain("Adrian");
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
    it("el saludo inicial es cercano y lleva como mucho un emoji", () => {
      const result = nextLeadFlowStep(initialLeadFlowState(), "hola");
      expect(result.reply).toBeTruthy();
      expect((result.reply!.match(EMOJI_RE) ?? []).length).toBeLessThanOrEqual(1);
      expect(result.reply!.length).toBeLessThan(120); // corto, estilo chat
    });

    it("ninguna respuesta fija suena robótica ni encadena dos preguntas", () => {
      const replies = [
        nextLeadFlowStep(initialLeadFlowState(), "hola").reply,
        nextLeadFlowStep(initialLeadFlowState(), "¿cuánto cuesta el servicio premium?").reply,
        nextLeadFlowStep(undefined, "Marta").reply,
        nextLeadFlowStep({ step: "awaiting_contact_consent", customerName: "Marta" }, "vale").reply,
        nextLeadFlowStep({ step: "awaiting_contact_consent", customerName: "Marta" }, "no").reply,
      ].filter(Boolean) as string[];

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
