// Mirror of front/app/facturacion SERVICE_CATALOG
// Front and back are separate packages; kept in sync manually.

export interface ServiceEntry {
  id: string;
  name: string;
  description: string;
  implPrice: number;
  maintPrice: number;
}

// Catálogo oficial 2026. Precios SIN IVA. Espejo de front/components/facturacion/types.ts.
export const SERVICE_CATALOG: ServiceEntry[] = [
  { id: "chatbot_basic", name: "Agente IA — Starter", description: "Chatbot Web con base de conocimiento + Soporte", implPrice: 540, maintPrice: 39 },
  { id: "chatbot_plus", name: "Agente IA — Plus", description: "Página Web + Agente IA Multi-canal + cobertura Google + Hosting", implPrice: 1290, maintPrice: 99 },
  { id: "chatbot_pro", name: "Agente IA — Pro", description: "Agente autónomo con integraciones avanzadas, voz, RAG", implPrice: 1730, maintPrice: 149 },
  { id: "web_basic", name: "Página Web Profesional (Landing Page)", description: "Web responsive, SEO básico + captación de Leads + Hosting", implPrice: 890, maintPrice: 59 },
  { id: "web_chatbot", name: "Web Completa + Chatbot", description: "Web corporativa con agente IA integrado y multi-idioma. Incluye CRM, base de conocimiento, automatizaciones y analytics.", implPrice: 2950, maintPrice: 180 },
  { id: "automation", name: "Automatización RPA/n8n", description: "Flujos automatizados: email, CRM, facturación y notificaciones", implPrice: 750, maintPrice: 49 },
  { id: "crm", name: "CRM a Medida", description: "CRM desde 2.000€ según los módulos contratados (clientes, trabajadores, producto, facturación...)", implPrice: 2000, maintPrice: 99 },
  { id: "hours", name: "Desarrollo a Medida", description: "Integraciones personalizadas, APIs, scripts y desarrollo específico", implPrice: 75, maintPrice: 0 },
  { id: "tokens_5m", name: "Tokens IA Extra (5M)", description: "Ampliación de capacidad: 5 millones de tokens de IA al mes", implPrice: 0, maintPrice: 17 },
  { id: "tokens_10m", name: "Tokens IA Extra (10M)", description: "Ampliación de capacidad: 10 millones de tokens de IA al mes", implPrice: 0, maintPrice: 30 },
];
