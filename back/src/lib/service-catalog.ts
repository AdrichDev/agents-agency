// FICHERO GENERADO — no editar a mano.
// Fuente: front/lib/service-catalog.json · regenerar con `npm run catalog:sync`.
//
// El precio se cambia en ese JSON y en ningún otro sitio. Este espejo existe porque front y back son
// paquetes con deploys separados y el back no puede leer el fichero del front en producción. Hay un
// test (`tests/catalogo-precios-fuente-unica.test.ts`) que compara este fichero con la salida del
// generador: editarlo a mano, o cambiar el JSON sin regenerar, sale en rojo.

export interface ServiceEntry {
  id: string;
  name: string;
  description: string;
  /** Puesta en marcha, pago único, sin IVA. */
  implPrice: number;
  /** Mensualidad, sin IVA. */
  maintPrice: number;
  /** Cupo mensual de tokens incluido, o `null` si el servicio no lleva agente. */
  tokens: number | null;
}

/** Catálogo oficial 2026. Precios SIN IVA. Orden y contenido calcados del JSON del front. */
export const SERVICE_CATALOG: ServiceEntry[] = [
  { id: "chatbot_basic", name: "Agente IA — Starter", description: "Chatbot Web con base de conocimiento + Soporte", implPrice: 540, maintPrice: 39, tokens: 10000000 },
  { id: "chatbot_plus", name: "Agente IA — Plus", description: "Página Web + Agente IA Multi-canal + cobertura Google + Hosting", implPrice: 1290, maintPrice: 99, tokens: 10000000 },
  { id: "chatbot_pro", name: "Agente IA — Pro", description: "Agente autónomo con integraciones avanzadas, voz, RAG", implPrice: 1730, maintPrice: 149, tokens: 10000000 },
  { id: "web_basic", name: "Página Web Profesional (Landing Page)", description: "Web responsive, SEO básico  + captación de Leads + Hosting", implPrice: 890, maintPrice: 59, tokens: null },
  { id: "web_chatbot", name: "Web Completa + Chatbot", description: "Web corporativa con agente IA integrado y multi-idioma. Incluye CRM, base de conocimiento, automatizaciones y analytics.", implPrice: 2950, maintPrice: 180, tokens: 10000000 },
  { id: "automation", name: "Automatización RPA/n8n", description: "Flujos automatizados: email, CRM, facturación y notificaciones", implPrice: 750, maintPrice: 49, tokens: null },
  { id: "crm", name: "CRM a Medida", description: "CRM desde 2.000€ según los módulos contratados (clientes, trabajadores, producto, facturación...)", implPrice: 2000, maintPrice: 99, tokens: null },
  { id: "hours", name: "Desarrollo a Medida", description: "Integraciones personalizadas, APIs, scripts y desarrollo específico (precio por hora)", implPrice: 75, maintPrice: 0, tokens: null },
  { id: "tokens_5m", name: "Tokens IA Extra (5M)", description: "Ampliación de capacidad: 5 millones de tokens de IA al mes", implPrice: 0, maintPrice: 17, tokens: null },
  { id: "tokens_10m", name: "Tokens IA Extra (10M)", description: "Ampliación de capacidad: 10 millones de tokens de IA al mes", implPrice: 0, maintPrice: 30, tokens: null },
];
