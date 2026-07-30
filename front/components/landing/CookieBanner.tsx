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

  // La burbuja del chat vive en la esquina inferior derecha (`bottom:24px; right:24px`, 56px
  // de lado). Este banner ocupaba exactamente ese rincón: en móvil lo cruzaba de lado a lado
  // y en escritorio moría justo encima de la burbuja, así que el chatbot de una agencia de
  // chatbots quedaba escondido detrás del aviso de cookies hasta que el visitante lo
  // despachaba. Se aparta: por encima de la burbuja en móvil, al lado contrario en escritorio.
  return (
    <div className="fixed bottom-24 left-4 right-4 md:bottom-6 md:left-6 md:right-auto md:max-w-md z-[80] animate-fade-up">
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
