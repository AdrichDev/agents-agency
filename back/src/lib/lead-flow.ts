type LeadFlowStep =
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

/**
 * F5 (aa-agent-backend-foundation, AC6): el flujo YA NO arranca bloqueando la
 * conversación para pedir el nombre ("awaiting_name" queda solo como estado
 * legado en conversaciones persistidas). El nombre se captura de forma pasiva
 * si el usuario se presenta, y el agente lo pide solo ante intención real
 * (guiado por prompt en engine.ts + record_lead_intent / handoff).
 */
export function initialLeadFlowState(): LeadFlowState {
  return { step: "assisting" };
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

/** Petición de datos tras un handoff confirmado (el usuario ya pidió/aceptó contacto humano). */
export function appendContactDetailsRequest(reply: string): string {
  return `${reply}\n\nPara que te contacten, ¿me pasas tu email y un teléfono? 😊`;
}

/**
 * Captura pasiva del nombre: solo presentaciones EXPLÍCITAS ("me llamo X",
 * "mi nombre es X", "soy X"). Nunca interpreta un mensaje suelto como nombre.
 */
function extractExplicitName(message: string): string | undefined {
  const m = message.trim().match(/(?:me llamo|mi nombre es|soy)\s+(.+)/i);
  if (!m) return undefined;
  const name = m[1]
    .split(/[,.;:!?¿¡]/)[0] // corta en la primera puntuación: "Adrián, ¿precio?" → "Adrián"
    .split(/\s+/)
    .slice(0, 4)
    .join(" ")
    .trim();
  return name || undefined;
}

export function nextLeadFlowStep(state: LeadFlowState | undefined, message: string): LeadFlowResult {
  let current = state ?? initialLeadFlowState();

  // F5: "awaiting_name" legado (conversaciones persistidas antes del cambio)
  // deja de bloquear — se trata como "assisting".
  if (current.step === "awaiting_name") {
    current = { ...current, step: "assisting" };
  }

  // Captura pasiva del nombre en cualquier paso conversacional: se guarda en
  // el estado SIN interceptar la respuesta (handled=false → responde el LLM,
  // que ya recibe el nombre vía contextFacts).
  if (!current.customerName) {
    const customerName = extractExplicitName(message);
    if (customerName) current = { ...current, customerName };
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
