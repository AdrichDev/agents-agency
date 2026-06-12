export interface BudgetService {
  id: string;
  name: string;
  description: string;
  implPrice: number;
  maintPrice: number;
  selected: boolean;
  quantity: number;
}

export const SERVICES_CATALOG: BudgetService[] = [
  { id: "chatbot_basic", name: "Agente IA — Plan Starter", description: "Chatbot con IA, base de conocimiento, widget web y soporte básico", implPrice: 1200, maintPrice: 89, selected: false, quantity: 1 },
  { id: "chatbot_pro", name: "Agente IA — Plan Pro", description: "Chatbot multi-canal (web + WhatsApp + email), CRM básico, analytics", implPrice: 2900, maintPrice: 179, selected: false, quantity: 1 },
  { id: "chatbot_enterprise", name: "Agente IA — Plan Enterprise", description: "Agente autónomo con integraciones avanzadas, voz, RAG y SLA garantizado", implPrice: 6900, maintPrice: 449, selected: false, quantity: 1 },
  { id: "web_basic", name: "Página Web Profesional", description: "Landing page o web corporativa responsive, SEO básico, panel CMS", implPrice: 1190, maintPrice: 49, selected: false, quantity: 1 },
  { id: "web_chatbot", name: "Web Completa + Chatbot Integrado", description: "Web corporativa completa con agente IA integrado y multi-idioma", implPrice: 3400, maintPrice: 149, selected: false, quantity: 1 },
  { id: "automation", name: "Automatización de Procesos (RPA/n8n)", description: "Flujos automatizados: email, CRM, facturación, notificaciones", implPrice: 1900, maintPrice: 119, selected: false, quantity: 1 },
  { id: "hours", name: "Horas de Desarrollo a Medida", description: "Integraciones personalizadas, APIs, scripts, desarrollo específico", implPrice: 95, maintPrice: 0, selected: false, quantity: 10 },
  { id: "tokens", name: "Bolsa Mensual Extra de Tokens IA (5M)", description: "Ampliación de capacidad de procesamiento de IA por 5 millones de tokens", implPrice: 0, maintPrice: 39, selected: false, quantity: 1 },
];

export const fmt = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export type BudgetStatus = "generada" | "aceptada" | "caducada" | "rechazada";

export interface BudgetRecord {
  id: string;
  quoteNumber: string;
  status: BudgetStatus;
  subtotalImpl: number;
  subtotalMaint: number;
  totalImpl: number;
  totalMaint: number;
  clientId?: string | null;
  client?: { id: string; name: string; cif?: string | null } | null;
  clientSnapshot: any;
  issuerSnapshot: any;
  lines: any[];
  createdAt: string;
}
