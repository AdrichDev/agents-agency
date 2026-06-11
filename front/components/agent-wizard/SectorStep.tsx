import { useState } from "react";
import type { AgentWizardForm } from "@/components/agent-wizard/types";

export default function SectorStep({
  form,
  set,
  sectors,
  sectorPage,
  totalPages,
  onPage,
  onAddSector,
  adding,
  status,
}: {
  form: AgentWizardForm;
  set: <K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) => void;
  sectors: string[];
  sectorPage: number;
  totalPages: number;
  onPage: (page: number) => void;
  onAddSector: (name: string) => Promise<void>;
  adding: boolean;
  status: "idle" | "success" | "error";
}) {
  const [customSector, setCustomSector] = useState("");
  const selectedOther = form.sector === "Otro" || status !== "idle";

  async function add() {
    const value = customSector.trim();
    if (!value) return;
    await onAddSector(value);
    set("sector", value);
    setCustomSector("");
  }

  return (
    <div>
      <h2 className="font-semibold text-white mb-5">Paso 2 - Sector</h2>
      <div className="grid grid-cols-3 gap-2">
        {sectors.map((sector) => (
          <button
            key={sector}
            onClick={() => set("sector", sector)}
            className={`rounded-xl px-3 py-3.5 text-sm border transition ${
              form.sector === sector
                ? "border-[var(--neon-purple)] bg-[var(--neon-purple)]/15 text-[var(--neon-pink)]"
                : "border-edge bg-white/5 text-slate-300 hover:bg-white/10 hover:border-[var(--neon-purple)]/50"
            }`}
          >
            {sector.charAt(0).toLocaleUpperCase("es-ES") + sector.slice(1)}
          </button>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-3 text-xs text-slate-500">
          <span>
            Página {sectorPage} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button className="chip" disabled={sectorPage <= 1} onClick={() => onPage(sectorPage - 1)}>
              Anterior
            </button>
            <button className="chip" disabled={sectorPage >= totalPages} onClick={() => onPage(sectorPage + 1)}>
              Siguiente
            </button>
          </div>
        </div>
      )}

      {selectedOther && (
        <div className="mt-5 card !rounded-xl p-4 bg-white/5">
          <div className="flex gap-2">
            <input
              className="input-dark flex-1"
              placeholder="Introduce el Sector"
              value={customSector}
              onChange={(e) => setCustomSector(e.target.value)}
            />
            <button className="btn-grad" disabled={!customSector.trim() || adding} onClick={add}>
              {adding ? "Añadiendo..." : "Añadir"}
            </button>
          </div>
          {status === "success" && <p className="text-xs text-emerald-400 mt-2">✓ Añadido correctamente</p>}
          {status === "error" && <p className="text-xs text-red-400 mt-2">× Error al ingresar el sector</p>}
        </div>
      )}
    </div>
  );
}
