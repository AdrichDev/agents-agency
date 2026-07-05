"use client";

import { useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/hooks/usePagination";
import {
  SERVICES_CATALOG,
  fmt,
  withIva,
} from "@/components/presupuestos/types";

/** Bullets de marketing por plan destacado (presentación, no precios). */
const HIGHLIGHTS: Record<string, string[]> = {
  chatbot_plus: [
    "Página web + Agente IA multi-canal",
    "Cobertura en Google + hosting incluido",
    "Base de conocimiento entrenada con tu Web",
    "Soporte y actualizaciones",
  ],
  web_chatbot: [
    "Web corporativa completa + agente IA integrado",
    "CRM, base de conocimiento y automatizaciones",
    "Multi-idioma y analítica avanzada",
    "Soporte prioritario",
  ],
  chatbot_pro: [
    "Agente autónomo con integraciones avanzadas",
    "Voz + RAG sobre tu base documental",
    "Automatizaciones a medida",
    "Soporte dedicado",
  ],
};

/** Orden explícito de las 3 cards destacadas. */
const FEATURED_IDS = ["chatbot_plus", "web_chatbot", "chatbot_pro"];

/** Formatea tokens grandes: 10000000 → "10M". */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}K`;
  return String(n);
}

const RECOMMENDED_ID = "web_chatbot";

export default function Tarifas() {
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">(
    "monthly",
  );
  const [promo, setPromo] = useState(false);
  const catalogPg = usePagination(SERVICES_CATALOG);

  // 10% de descuento del mes: solo al pasar el ratón por el rótulo promo.
  const promoFactor = promo ? 0.9 : 1;
  const price = (n: number) => withIva(n) * promoFactor; // importe final mostrado (IVA + dto)

  // Planes destacados (orden fijo): Plus, Web Completa + Chatbot, Pro.
  const featured = FEATURED_IDS.map((id) =>
    SERVICES_CATALOG.find((s) => s.id === id),
  ).filter((s): s is NonNullable<typeof s> => Boolean(s));

  // Mensualidad mostrada: anual = 9 meses (3 gratis).
  const maintFor = (m: number) => (billingInterval === "yearly" ? m * 9 : m);
  const unit = billingInterval === "yearly" ? "año" : "mes";

  return (
    <div className="w-full max-w-5xl mx-auto py-4">
      {/* Encabezado */}
      <div className="text-center mb-10">
        <span className="kicker mb-2">Planes de Precios</span>
        <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl">
          Nuestras Tarifas de Servicio
        </h1>
        <p className="mt-4 text-base text-slate-400 max-w-xl mx-auto">
          Impulsa tu negocio con webs de alta conversión y agentes inteligentes
          entrenados a medida.
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
              3 MESES GRATIS
            </span>
          </button>
        </div>

        {/* Rótulo promo: al pasar el ratón recalcula los precios con 10% dto */}
        <div className="mt-4 flex justify-center">
          <div
            onMouseEnter={() => setPromo(true)}
            onMouseLeave={() => setPromo(false)}
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border cursor-pointer transition-all ${
              promo
                ? "bg-fuchsia-500/25 border-fuchsia-400 shadow-lg shadow-fuchsia-500/20 scale-105"
                : "bg-gradient-to-r from-fuchsia-500/15 to-indigo-500/15 border-fuchsia-500/40"
            }`}
          >
            <span className="text-sm">🎉</span>
            <span className="text-xs font-black text-white uppercase tracking-wide">
              Solo durante este mes:{" "}
              <span className="text-fuchsia-300">10% de descuento</span>
            </span>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-slate-500">
          Todos los precios mostrados incluyen IVA (21%).
          {promo && (
            <span className="text-fuchsia-300 font-bold">
              {" "}
              · 10% dto. aplicado.
            </span>
          )}
        </p>
      </div>

      {/* Grid de Planes destacados */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {featured.map((p) => {
          const isRec = p.id === RECOMMENDED_ID;
          const maintBase = maintFor(p.maintPrice);
          // Color de acento por plan: borde + hover-borde + hover-bg (tono del borde con transparencia).
          const accent: Record<string, string> = {
            chatbot_plus:
              "border-fuchsia-500/40 hover:border-fuchsia-400 hover:!bg-fuchsia-500/10 hover:shadow-xl hover:shadow-fuchsia-500/10",
            web_chatbot:
              "border-emerald-500/40 hover:border-emerald-400 hover:!bg-emerald-500/10 hover:shadow-xl hover:shadow-emerald-500/10",
            chatbot_pro:
              "border-indigo-500/40 hover:border-indigo-400 hover:!bg-indigo-500/10 hover:shadow-xl hover:shadow-indigo-500/10",
          };
          return (
            <div
              key={p.id}
              className={`card p-6 flex flex-col justify-between border-2 !bg-transparent transition-all duration-300 hover:-translate-y-1.5 relative ${
                isRec ? "md:scale-[1.06] md:-my-2 z-10" : ""
              } ${accent[p.id] ?? "border-edge hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-500/5"}`}
            >
              {isRec && (
                <span className="absolute -top-3 right-6 bg-emerald-500 text-white text-[10px] uppercase tracking-wider font-extrabold px-3 py-1 rounded-full shadow-lg shadow-emerald-500/20">
                  Mejor valor
                </span>
              )}

              <div>
                {/* Nombre + descripción breve entre paréntesis */}
                <h3 className="text-xl font-bold text-white mb-1">{p.name}</h3>
                <p className="text-[11px] text-slate-500 leading-relaxed mb-3 min-h-[32px]">
                  ({p.description})
                </p>

                {/* Tokens incluidos */}
                {p.tokens && (
                  <div className="inline-flex items-center gap-1.5 mb-4 px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30">
                    <span className="text-sm">⚡</span>
                    <span className="text-[11px] font-bold text-indigo-300">
                      {fmtTokens(p.tokens)} tokens IA / mes incluidos
                    </span>
                  </div>
                )}

                {/* Bloque Precio (con IVA, y 10% dto si promo activa) */}
                <div className="mb-6">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black text-white">
                      {fmt(price(maintBase))}€
                    </span>
                    <span className="text-slate-400 text-sm font-semibold">
                      /{unit}
                    </span>
                    {promo && (
                      <span className="text-sm text-slate-500 line-through">
                        {fmt(withIva(maintBase))}€
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {fmt(maintBase * promoFactor)}€ /{unit} sin IVA
                  </p>
                  <p className="text-xs text-indigo-400 font-bold mt-1.5">
                    +{fmt(price(p.implPrice))}€ de implantación (IVA incl., pago
                    único)
                  </p>
                  {billingInterval === "yearly" ? (
                    <p className="text-[11px] text-emerald-400 font-bold mt-1">
                      {/* Ahorro anual = 3 meses gratis + (si promo) 10% sobre 9 meses pagados + 10% implantación */}
                      ¡Ahorras{" "}
                      {fmt(
                        withIva(p.maintPrice * 3) +
                          (promo
                            ? withIva(p.maintPrice * 9) * 0.1 +
                              withIva(p.implPrice) * 0.1
                            : 0),
                      )}
                      € al año!
                    </p>
                  ) : (
                    promo && (
                      <p className="text-[11px] text-emerald-400 font-bold mt-1">
                        {/* Mensual + promo: 10% mensualidad ×12 + 10% implantación (pago único) */}
                        ¡Ahorras{" "}
                        {fmt(
                          withIva(p.maintPrice) * 0.1 * 12 +
                            withIva(p.implPrice) * 0.1,
                        )}
                        € al año!
                      </p>
                    )
                  )}
                </div>

                {/* Características */}
                <ul className="space-y-3 mb-8 text-xs text-slate-300">
                  {(HIGHLIGHTS[p.id] ?? []).map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <span className="text-emerald-500 text-sm select-none">
                        ✔
                      </span>
                      <span className="leading-normal">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <button
                  className={`w-full py-3 rounded-xl font-bold text-xs transition duration-300 ${
                    isRec
                      ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/25"
                      : "bg-white/[0.04] text-white border border-edge hover:bg-white/[0.08]"
                  }`}
                >
                  Contratar {p.name.replace("Agente IA — ", "")}
                </button>
                <p className="text-[10px] text-center text-slate-600 mt-3">
                  Soporte y actualizaciones continuas
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tarifas Oficiales (Catálogo Completo) — base + IVA */}
      <div className="card p-6 mt-12 mb-8 mx-auto w-full lg:max-w-4xl">
        <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-5">
          Tarifas Oficiales 2026 (Catálogo Completo)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-edge text-slate-500 text-xs uppercase tracking-wider">
                <th className="pb-2.5">Servicio</th>
                <th className="pb-2.5 text-right">
                  Puesta en marcha (IVA incl.)
                </th>
                <th className="pb-2.5 text-right">
                  Mantenimiento mensual (IVA incl.)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge text-slate-300">
              {catalogPg.pageItems.map((s) => {
                const isHourly = s.id === "hours";
                return (
                  <tr key={s.id}>
                    <td className="py-2.5">
                      <span className="font-medium text-white">{s.name}</span>
                      <span className="block text-[11px] text-slate-500 font-normal">
                        ({s.description})
                        {s.tokens ? ` · ${fmtTokens(s.tokens)} tokens/mes` : ""}
                      </span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {s.implPrice > 0
                        ? `${fmt(price(s.implPrice))} €${isHourly ? " / h" : ""}`
                        : "—"}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {s.maintPrice > 0
                        ? `${fmt(price(s.maintPrice))} € / mes`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            page={catalogPg.page}
            totalPages={catalogPg.totalPages}
            onChange={catalogPg.setPage}
            total={catalogPg.total}
          />
        </div>
      </div>

      {/* Pie de Página */}
      <div className="text-center mt-8 text-xs text-slate-500">
        <p>
          Precios vigentes para contratos de mantenimiento activo. Todos los
          precios incluyen IVA (21%).
        </p>
      </div>
    </div>
  );
}
