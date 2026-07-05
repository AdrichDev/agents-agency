"use client";

import StudiesPanel from "@/components/stats/StudiesPanel";

export default function EstudiosMercadoPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <span className="kicker">Panel de estadísticas</span>
        <h1 className="text-2xl font-bold text-white mt-1">Estudios de Mercado</h1>
      </div>

      <StudiesPanel />
    </div>
  );
}
