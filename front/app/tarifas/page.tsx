"use client";

import { useState } from "react";

export default function Tarifas() {
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");

  const plans = [
    {
      name: "Plan Agente de IA",
      description: "Ideal para automatizar tu atención al cliente y soporte técnico.",
      implPrice: 1200,
      maintPrice: billingInterval === "monthly" ? 89 : 890,
      savings: billingInterval === "yearly" ? "¡Ahorras 178€ al año!" : "Equivale a 2.97€ al día",
      features: [
        "Agente de IA entrenado con tus datos (PDF, Web, Docs)",
        "Integración en tu web mediante Widget de Chat",
        "Panel de conversaciones y analíticas básico",
        "Soporte técnico por email",
        "Actualizaciones de conocimiento estándar",
      ],
      badge: null,
      color: "border-edge hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-500/5",
      buttonText: "Contratar Agente",
      isRecommended: false,
    },
    {
      name: "Plan Web + Chatbot Pack",
      description: "La solución definitiva para una presencia web moderna e inteligente.",
      implPrice: 3400,
      maintPrice: billingInterval === "monthly" ? 149 : 1490,
      savings: billingInterval === "yearly" ? "¡Ahorras 298€ al año!" : "Equivale a 4.97€ al día",
      features: [
        "Diseño web completo (5 secciones) + Chatbot integrado",
        "Agente de IA avanzado con base de conocimientos dinámica",
        "Captura de leads y agendamiento automático de reuniones",
        "Hosting de alta velocidad y dominio gratis primer año",
        "Soporte técnico prioritario y actualizaciones ilimitadas",
      ],
      badge: "Mejor valor",
      color: "border-emerald-500/30 hover:border-emerald-400 hover:shadow-xl hover:shadow-emerald-500/10",
      buttonText: "Comenzar ahora",
      isRecommended: true,
    },
    {
      name: "Plan Desarrollo Web",
      description: "Diseño y estructura web a medida para máxima velocidad y SEO.",
      implPrice: 1190,
      maintPrice: billingInterval === "monthly" ? 49 : 490,
      savings: billingInterval === "yearly" ? "¡Ahorras 98€ al año!" : "Equivale a 1.63€ al día",
      features: [
        "Diseño premium 100% responsivo y personalizado",
        "Optimización de velocidad de carga y SEO On-Page",
        "Panel auto-administrable para editar textos e imágenes",
        "Copias de seguridad automáticas semanales",
        "Soporte y mantenimiento de hosting mensual",
      ],
      badge: null,
      color: "border-edge hover:border-fuchsia-500 hover:shadow-xl hover:shadow-fuchsia-500/5",
      buttonText: "Contratar Web",
      isRecommended: false,
    },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto py-4">
      {/* Encabezado */}
      <div className="text-center mb-10">
        <span className="kicker mb-2">Planes de Precios</span>
        <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl">
          Nuestras Tarifas de Servicio
        </h1>
        <p className="mt-4 text-base text-slate-400 max-w-xl mx-auto">
          Impulsa tu negocio con webs de alta conversión y agentes inteligentes entrenados a medida.
        </p>

        {/* Switcher Mensual / Anual */}
        <div className="mt-8 inline-flex items-center gap-2 p-1 rounded-xl bg-white/[0.02] border border-edge">
          <button
            onClick={() => setBillingInterval("monthly")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              billingInterval === "monthly"
                ? "bg-indigo-500 text-white shadow-md shadow-indigo-500/25"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Facturación Mensual
          </button>
          <button
            onClick={() => setBillingInterval("yearly")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              billingInterval === "yearly"
                ? "bg-indigo-500 text-white shadow-md shadow-indigo-500/25"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Facturación Anual
            <span className="bg-emerald-500/20 text-emerald-300 text-[10px] px-1.5 py-0.5 rounded-full font-black">
              2 MESES GRATIS
            </span>
          </button>
        </div>
      </div>

      {/* Grid de Planes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {plans.map((p) => (
          <div
            key={p.name}
            className={`card p-6 flex flex-col justify-between border-2 transition-all relative ${p.color} ${
              p.isRecommended ? "bg-white/[0.01]" : ""
            }`}
          >
            {p.badge && (
              <span className="absolute -top-3 right-6 bg-emerald-500 text-white text-[10px] uppercase tracking-wider font-extrabold px-3 py-1 rounded-full shadow-lg shadow-emerald-500/20">
                {p.badge}
              </span>
            )}

            <div>
              <h3 className="text-xl font-bold text-white mb-2">{p.name}</h3>
              <p className="text-xs text-slate-500 min-h-[32px] leading-relaxed mb-6">
                {p.description}
              </p>

              {/* Bloque Precio */}
              <div className="mb-6">
                <div className="flex items-baseline">
                  <span className="text-4xl font-black text-white">
                    {p.maintPrice}€
                  </span>
                  <span className="text-slate-400 text-sm font-semibold ml-1.5">
                    /{billingInterval === "monthly" ? "mes" : "año"}
                  </span>
                </div>
                
                {/* Coste de Implantación */}
                <p className="text-xs text-indigo-400 font-bold mt-1.5">
                  +{p.implPrice}€ de implantación (pago único)
                </p>

                {/* Subtexto de Ahorro */}
                <p className="text-[11px] text-emerald-400 font-bold mt-1">
                  {p.savings}
                </p>
              </div>

              {/* Características */}
              <ul className="space-y-3 mb-8 text-xs text-slate-300">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="text-emerald-500 text-sm select-none">✔</span>
                    <span className="leading-normal">{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Acción */}
            <div>
              <button
                className={`w-full py-3 rounded-xl font-bold text-xs transition duration-300 ${
                  p.isRecommended
                    ? "bg-indigo-500 text-white hover:bg-indigo-600 shadow-lg shadow-indigo-500/25"
                    : "bg-white/[0.04] text-white border border-edge hover:bg-white/[0.08]"
                }`}
              >
                {p.buttonText}
              </button>
              <p className="text-[10px] text-center text-slate-600 mt-3">
                Soporte y actualizaciones continuas
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Tarifas Oficiales (Catálogo Completo) */}
      <div className="card p-6 mt-12 mb-8 mx-auto w-full lg:max-w-4xl">
        <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-5">Tarifas Oficiales 2026 (Catálogo Completo)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-edge text-slate-500 text-xs uppercase tracking-wider">
                <th className="pb-2.5">Servicio</th>
                <th className="pb-2.5 text-right">Puesta en marcha</th>
                <th className="pb-2.5 text-right">Mensualidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge text-slate-300">
              {[
                ["Agente IA — Starter", "490 €", "59 € / mes"],
                ["Agente IA — Pro", "990 €", "99 € / mes"],
                ["Agente IA — Enterprise", "2.400 €", "249 € / mes"],
                ["Página Web Profesional", "890 €", "35 € / mes"],
                ["Web Completa + Chatbot", "1.690 €", "89 € / mes"],
                ["Automatización RPA/n8n", "750 €", "49 € / mes"],
                ["Desarrollo a Medida", "85 € / h", "—"],
                ["Tokens IA Extra (5M)", "—", "29 € / mes"],
              ].map(([name, impl, maint]) => (
                <tr key={name}>
                  <td className="py-2.5 font-medium text-white">{name}</td>
                  <td className="py-2.5 text-right tabular-nums">{impl}</td>
                  <td className="py-2.5 text-right tabular-nums">{maint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pie de Página */}
      <div className="text-center mt-12 text-xs text-slate-500">
        <p>Precios vigentes para contratos de mantenimiento activo. Todos los precios mostrados no incluyen IVA (21%).</p>
        <p className="mt-1">Puedes modificar o cambiar de plan cuando quieras. Los servicios se gestionan bajo acuerdo de nivel de servicio (SLA).</p>
      </div>
    </div>
  );
}
