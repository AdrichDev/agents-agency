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
  { id: "chatbot_basic", name: "Agente IA — Plan Starter", description: "Chatbot con IA, base de conocimiento, widget web y soporte básico", implPrice: 490, maintPrice: 59 },
  { id: "chatbot_pro", name: "Agente IA — Plan Pro", description: "Chatbot multi-canal (web + WhatsApp + email), CRM básico, analytics", implPrice: 990, maintPrice: 99 },
  { id: "chatbot_enterprise", name: "Agente IA — Plan Enterprise", description: "Agente autónomo con integraciones avanzadas, voz, RAG y SLA garantizado", implPrice: 2400, maintPrice: 249 },
  { id: "web_basic", name: "Página Web Profesional", description: "Landing page o web corporativa responsive, SEO básico, panel CMS", implPrice: 890, maintPrice: 35 },
  { id: "web_chatbot", name: "Web Completa + Chatbot Integrado", description: "Web corporativa completa con agente IA integrado y multi-idioma", implPrice: 1690, maintPrice: 89 },
  { id: "automation", name: "Automatización de Procesos (RPA/n8n)", description: "Flujos automatizados: email, CRM, facturación, notificaciones", implPrice: 750, maintPrice: 49 },
  { id: "hours", name: "Horas de Desarrollo a Medida", description: "Integraciones personalizadas, APIs, scripts, desarrollo específico", implPrice: 85, maintPrice: 0 },
  { id: "tokens", name: "Bolsa Mensual Extra de Tokens IA (5M)", description: "Ampliación de capacidad de procesamiento de IA por 5 millones de tokens", implPrice: 0, maintPrice: 29 },
];

/** Map serviceId → service name for prospect candidateServices */
export function serviceIdToName(id: string): string | undefined {
  return SERVICE_CATALOG.find((s) => s.id === id)?.name;
}
