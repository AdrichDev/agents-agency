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
  // Datos de contacto parciales: email y teléfono pueden llegar en mensajes distintos
  email?: string;
  phone?: string;
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
  // Si la frase tiene más de 4 palabras (ej: "No, lo que quiero es..."), no es una negativa pura.
  if (text.trim().split(/\s+/).length > 4) return false;
  return /\b(no|nada|gracias|no gracias|de momento no)\b/i.test(text);
}

export function appendContactQuestion(reply: string): string {
  return `${reply}\n\n¿Quieres que alguien del equipo te llame y lo veis juntos?`;
}

/** Petición de datos tras un handoff confirmado (el usuario ya pidió/aceptó contacto humano). */
export function appendContactDetailsRequest(reply: string): string {
  return `${reply}\n\nPara que te contacten, ¿me pasas tu email y un teléfono? 😊`;
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
        reply: "¡Hola! 😊 ¿Cómo te llamas? Así te atiendo mejor.",
        nextState: current,
      };
    }
    // Pregunta directa sin presentarse → pedir el nombre antes de continuar
    if (looksLikeQuestion) {
      return {
        handled: true,
        reply: "¡Claro que sí! Ahora te cuento, pero antes... ¿cómo te llamas?",
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
      reply: `¡Encantado, ${customerName}! 😊 Cuéntame, ¿en qué te puedo ayudar?`,
      nextState: { step: "assisting", customerName },
    };
  }

  if (current.step === "awaiting_contact_consent") {
    if (isPositive(message)) {
      return {
        handled: true,
        reply: "¡Genial! Pásame tu email y un teléfono y aviso al equipo 👍",
        nextState: { ...current, step: "awaiting_contact_details" },
      };
    }
    if (isNegative(message)) {
      return {
        handled: true,
        reply: "Sin problema. ¡Gracias por escribirnos! Aquí me tienes para lo que necesites 😊",
        nextState: { ...current, step: "closed" },
      };
    }
    // Ni sí ni no (p.ej. hace otra pregunta): que el agente la responda con normalidad
    // y la oferta de contacto queda pendiente para cuando conteste claramente.
    return { handled: false, nextState: current };
  }

  if (current.step === "awaiting_contact_details") {
    const details = extractContactDetails(message);
    // Acumular con lo que ya tuviéramos de mensajes anteriores
    const email = details.email ?? current.email;
    const phone = details.phone ?? current.phone;

    // Datos completos → crear lead y cerrar la captura
    if (email && phone) {
      return {
        handled: true,
        reply: "¡Apuntado! ✅ El equipo te contactará muy pronto. ¿Te ayudo con algo más mientras tanto?",
        nextState: { ...current, step: "post_contact", email, phone },
        createLead: {
          customerName: current.customerName ?? "Cliente",
          email,
          phone,
          consent: true,
        },
      };
    }

    // El usuario rehúsa dar sus datos → respetarlo y seguir asistiendo
    if (!details.email && !details.phone && isNegative(message)) {
      return {
        handled: true,
        reply: "Sin problema, no es obligatorio 😊 ¿En qué más te ayudo?",
        nextState: { ...current, step: "assisting" },
      };
    }

    // Aportó solo uno de los dos → pedir únicamente el que falta
    if (details.email || details.phone) {
      return {
        handled: true,
        reply: email
          ? "¡Gracias! ¿Me pasas también un teléfono?"
          : "¡Gracias! ¿Me pasas también tu email?",
        nextState: { ...current, email, phone },
      };
    }

    // Mensaje sin datos de contacto: si habla explícitamente del tema, re-pedir;
    // si habla de OTRA cosa, que el agente responda con normalidad y la petición
    // de datos quede pendiente para cuando los envíe.
    const mentionsContact = /\b(email|correo|tel[eé]fono|m[oó]vil|whatsapp|contacto)\b/i.test(message);
    if (mentionsContact) {
      return {
        handled: true,
        reply: "Para avisar al equipo necesito un email y un teléfono válidos, ¿me los pasas?",
        nextState: { ...current, email, phone },
      };
    }
    return { handled: false, nextState: { ...current, email, phone } };
  }

  if (current.step === "post_contact" && isNegative(message)) {
    return {
      handled: true,
      reply: "¡Perfecto! Gracias por escribirnos, te contactamos muy pronto 👍",
      nextState: { ...current, step: "closed" },
    };
  }

  return { handled: false, nextState: current };
}
