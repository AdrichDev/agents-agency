"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "3a-cookies-consent";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
  }, []);

  function decide(value: "accepted" | "rejected") {
    localStorage.setItem(STORAGE_KEY, value);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-md z-[80] animate-fade-up">
      <div className="rounded-2xl border border-white/10 bg-[#0b0b12]/95 backdrop-blur-xl p-5 shadow-[0_0_40px_rgba(0,102,255,0.2)]">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🍪</span>
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-white mb-1">Usamos cookies</h4>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Utilizamos cookies propias y de terceros para mejorar tu experiencia y analizar el
              tráfico. Puedes aceptarlas o rechazarlas.
            </p>
            <div className="flex gap-2">
              <button onClick={() => decide("accepted")} className="btn-grad !py-2 !px-4 text-xs">
                Aceptar
              </button>
              <button onClick={() => decide("rejected")} className="btn-dark !py-2 !px-4 text-xs">
                Rechazar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
