// Mirror of front/app/facturacion SERVICE_CATALOG
// Front and back are separate packages; kept in sync manually.

export interface ServiceEntry {
  id: string;
  name: string;
  description: string;
  implPrice: number;
  maintPrice: number;
}

export const SERVICE_CATALOG: ServiceEntry[] = [
  { id: "chatbot_basic", name: "Agente IA — Plan Starter", description: "Chatbot con IA, base de conocimiento, widget web y soporte básico", implPrice: 1200, maintPrice: 89 },
  { id: "chatbot_pro", name: "Agente IA — Plan Pro", description: "Chatbot multi-canal (web + WhatsApp + email), CRM básico, analytics", implPrice: 2900, maintPrice: 179 },
  { id: "chatbot_enterprise", name: "Agente IA — Plan Enterprise", description: "Agente autónomo con integraciones avanzadas, voz, RAG y SLA garantizado", implPrice: 6900, maintPrice: 449 },
  { id: "web_basic", name: "Página Web Profesional", description: "Landing page o web corporativa responsive, SEO básico, panel CMS", implPrice: 1190, maintPrice: 49 },
  { id: "web_chatbot", name: "Web Completa + Chatbot Integrado", description: "Web corporativa completa con agente IA integrado y multi-idioma", implPrice: 3400, maintPrice: 149 },
  { id: "automation", name: "Automatización de Procesos (RPA/n8n)", description: "Flujos automatizados: email, CRM, facturación, notificaciones", implPrice: 1900, maintPrice: 119 },
  { id: "hours", name: "Horas de Desarrollo a Medida", description: "Integraciones personalizadas, APIs, scripts, desarrollo específico", implPrice: 95, maintPrice: 0 },
  { id: "tokens", name: "Bolsa Mensual Extra de Tokens IA (5M)", description: "Ampliación de capacidad de procesamiento de IA por 5 millones de tokens", implPrice: 0, maintPrice: 39 },
];

/** Map serviceId → service name for prospect candidateServices */
export function serviceIdToName(id: string): string | undefined {
  return SERVICE_CATALOG.find((s) => s.id === id)?.name;
}
