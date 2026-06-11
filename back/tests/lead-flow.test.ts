import { describe, expect, it } from "vitest";
import { extractContactDetails, nextLeadFlowStep } from "@/lib/lead-flow";

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
});
