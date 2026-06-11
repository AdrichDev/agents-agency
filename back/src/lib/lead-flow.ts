export type LeadFlowStep =
  | "awaiting_name"
  | "assisting"
  | "awaiting_contact_consent"
  | "awaiting_contact_details"
  | "post_contact"
  | "closed";

export interface LeadFlowState {
  step: LeadFlowStep;
  customerName?: string;
}

export interface LeadFlowResult {
  handled: boolean;
  reply?: string;
  nextState: LeadFlowState;
  createLead?: {
    customerName: string;
    email: string;
    phone: string;
    consent: boolean;
  };
}

export function initialLeadFlowState(): LeadFlowState {
  return { step: "awaiting_name" };
}

export function extractContactDetails(text: string): { email?: string; phone?: string } {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim();
  return { email, phone };
}

function isPositive(text: string) {
  return /\b(si|sí|claro|vale|ok|perfecto|contact|llamad|acepto)\b/i.test(text);
}

function isNegative(text: string) {
  return /\b(no|nada|gracias|no gracias|de momento no)\b/i.test(text);
}

export function appendContactQuestion(reply: string): string {
  return `${reply}\n\n¿Quieres que una persona del equipo se ponga en contacto contigo?`;
}

export function nextLeadFlowStep(state: LeadFlowState | undefined, message: string): LeadFlowResult {
  const current = state ?? initialLeadFlowState();

  if (current.step === "awaiting_name") {
    const cleaned = message.trim();
    const greetingOnly = /^(hola|buenas|buenos días|buenas tardes|buenas noches|hey|hello|hi)[\s!.,]*$/i.test(cleaned);
    const looksLikeQuestion = cleaned.includes("?") || cleaned.split(/\s+/).length > 5;

    // "Hola" a secas → pedir el nombre
    if (greetingOnly) {
      return {
        handled: true,
        reply: "¡Hola! Para poder atenderte mejor, ¿me dices tu nombre?",
        nextState: current,
      };
    }
    // Pregunta directa sin presentarse → pedir el nombre antes de continuar
    if (looksLikeQuestion) {
      return {
        handled: true,
        reply: "¡Encantado de ayudarte! Antes de nada, ¿me dices tu nombre?",
        nextState: current,
      };
    }

    // "Me llamo Adrián" / "Soy Adrián" / "Adrián"
    const namePattern = cleaned.match(/(?:me llamo|soy|mi nombre es)\s+(.+)/i);
    const customerName = (namePattern ? namePattern[1] : cleaned)
      .replace(/[!.,]+$/, "")
      .split(/\s+/)
      .slice(0, 4)
      .join(" ");
    return {
      handled: true,
      reply: `Encantado, ${customerName}. ¿En qué puedo ayudarte?`,
      nextState: { step: "assisting", customerName },
    };
  }

  if (current.step === "awaiting_contact_consent") {
    if (isPositive(message)) {
      return {
        handled: true,
        reply: "Perfecto. Indícame tu email y teléfono para que podamos contactarte.",
        nextState: { ...current, step: "awaiting_contact_details" },
      };
    }
    if (isNegative(message)) {
      return {
        handled: true,
        reply: "De acuerdo. Gracias por contactar con nosotros. Que tengas un buen día.",
        nextState: { ...current, step: "closed" },
      };
    }
    // Ni sí ni no (p.ej. hace otra pregunta): que el agente la responda con normalidad
    // y la oferta de contacto queda pendiente para cuando conteste claramente.
    return { handled: false, nextState: current };
  }

  if (current.step === "awaiting_contact_details") {
    const details = extractContactDetails(message);
    if (!details.email || !details.phone) {
      return {
        handled: true,
        reply: "Necesito un email y un teléfono para poder avisar al equipo. ¿Me los indicas?",
        nextState: current,
      };
    }
    return {
      handled: true,
      reply:
        "Añadido correctamente. Una persona del equipo se pondrá en contacto contigo lo antes posible. ¿Necesitas algo más?",
      nextState: { ...current, step: "post_contact" },
      createLead: {
        customerName: current.customerName ?? "Cliente",
        email: details.email,
        phone: details.phone,
        consent: true,
      },
    };
  }

  if (current.step === "post_contact" && isNegative(message)) {
    return {
      handled: true,
      reply: "Perfecto. Gracias por contactar con nosotros. Nos pondremos en contacto contigo lo antes posible.",
      nextState: { ...current, step: "closed" },
    };
  }

  return { handled: false, nextState: current };
}
