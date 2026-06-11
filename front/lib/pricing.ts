/**
 * Catálogo de precios de la agencia.
 * Única fuente de verdad: lo consumen la página de Facturación y el generador de presupuestos.
 */

export interface PricingPlan {
  id: string;
  name: string;
  tagline: string;
  setup: number; // implementación (€, pago único)
  monthly: number; // mantenimiento (€/mes)
  features: string[];
  highlight?: boolean; // "Mejor valor"
}

export interface PricingSection {
  id: string;
  title: string;
  subtitle: string;
  plans: PricingPlan[];
}

export interface ExtraItem {
  id: string;
  name: string;
  price: number;
  unit: string; // "pago único" | "€/mes" | "€/hora" | "€/sesión"
}

export const PRICING_SECTIONS: PricingSection[] = [
  {
    id: "agents",
    title: "Agentes de IA (chatbots)",
    subtitle: "Asistentes entrenados con el conocimiento del negocio, desplegados en web, API, Telegram o WhatsApp.",
    plans: [
      {
        id: "agent-basic",
        name: "Agente Básico",
        tagline: "Para resolver dudas frecuentes con la información de tu web.",
        setup: 490,
        monthly: 49,
        features: [
          "Chatbot entrenado con tu web y documentos (RAG)",
          "Widget personalizado con tus colores y logo",
          "Captura de leads (nombre, email, teléfono)",
          "Hasta 500 conversaciones/mes",
        ],
      },
      {
        id: "agent-pro",
        name: "Agente Pro",
        tagline: "Con integraciones y acciones reales en tus herramientas.",
        setup: 990,
        monthly: 99,
        highlight: true,
        features: [
          "Todo lo del Agente Básico",
          "Integraciones: Gmail, Calendar, Slack o Jira (2 incluidas)",
          "1 automatización sin código (p.ej. email → ticket)",
          "Hasta 2.000 conversaciones/mes",
          "Informe mensual de conversaciones y leads",
        ],
      },
      {
        id: "agent-premium",
        name: "Agente Premium",
        tagline: "Multicanal y a medida para procesos críticos.",
        setup: 1990,
        monthly: 199,
        features: [
          "Todo lo del Agente Pro",
          "Multicanal: web + WhatsApp/Telegram",
          "Integraciones y automatizaciones ilimitadas",
          "Conversaciones ilimitadas",
          "Soporte prioritario y ajustes mensuales del prompt",
        ],
      },
    ],
  },
  {
    id: "webs",
    title: "Páginas web (sin chatbot)",
    subtitle: "Diseño moderno, rápido y optimizado para buscadores.",
    plans: [
      {
        id: "web-landing",
        name: "Landing Page",
        tagline: "Una página de impacto para captar clientes.",
        setup: 690,
        monthly: 29,
        features: [
          "1 página con diseño a medida",
          "Formulario de contacto y analítica",
          "SEO técnico básico",
          "Hosting y dominio gestionados",
        ],
      },
      {
        id: "web-corporate",
        name: "Web Corporativa",
        tagline: "Hasta 6 secciones para presentar tu negocio.",
        setup: 1490,
        monthly: 49,
        highlight: true,
        features: [
          "Hasta 6 páginas (inicio, servicios, sobre nosotros…)",
          "Blog autoadministrable",
          "SEO on-page completo",
          "Mantenimiento y copias de seguridad",
        ],
      },
      {
        id: "web-ecommerce",
        name: "E-commerce",
        tagline: "Tienda online lista para vender.",
        setup: 2990,
        monthly: 99,
        features: [
          "Catálogo, carrito y pasarela de pago",
          "Gestión de stock y pedidos",
          "Emails transaccionales",
          "Formación de 2 horas para tu equipo",
        ],
      },
    ],
  },
  {
    id: "combos",
    title: "Web + Chatbot (packs con descuento)",
    subtitle: "La web y el agente de IA integrados desde el primer día — ahorra frente a contratarlos por separado.",
    plans: [
      {
        id: "combo-starter",
        name: "Pack Starter",
        tagline: "Landing + Agente Básico.",
        setup: 990,
        monthly: 69,
        features: [
          "Landing page a medida",
          "Agente Básico integrado en la web",
          "Ahorro de 190€ en implementación",
        ],
      },
      {
        id: "combo-business",
        name: "Pack Business",
        tagline: "Web corporativa + Agente Pro.",
        setup: 2190,
        monthly: 129,
        highlight: true,
        features: [
          "Web corporativa completa",
          "Agente Pro con 2 integraciones",
          "Ahorro de 290€ en implementación",
          "Informe mensual unificado web + chat",
        ],
      },
      {
        id: "combo-commerce",
        name: "Pack Commerce",
        tagline: "E-commerce + Agente Premium.",
        setup: 4490,
        monthly: 269,
        features: [
          "Tienda online completa",
          "Agente Premium multicanal (web + WhatsApp)",
          "Recomendador de productos con IA",
          "Ahorro de 490€ en implementación",
        ],
      },
    ],
  },
];

export const EXTRAS: ExtraItem[] = [
  { id: "x-integration", name: "Integración adicional (Gmail, Slack, Jira, Calendar…)", price: 190, unit: "pago único" },
  { id: "x-automation", name: "Automatización a medida (email → CRM, informes…)", price: 290, unit: "pago único" },
  { id: "x-hours", name: "Bolsa de horas de desarrollo", price: 45, unit: "€/hora" },
  { id: "x-training", name: "Sesión de formación al equipo (1,5 h)", price: 150, unit: "€/sesión" },
  { id: "x-seo", name: "SEO y contenidos mensuales", price: 199, unit: "€/mes" },
  { id: "x-copy", name: "Redacción de contenidos web (por página)", price: 90, unit: "pago único" },
  { id: "x-brand", name: "Mini identidad de marca (logo + paleta + tipografías)", price: 390, unit: "pago único" },
  { id: "x-audit", name: "Auditoría IA de procesos del negocio", price: 450, unit: "pago único" },
];

export const euro = (n: number) =>
  n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
