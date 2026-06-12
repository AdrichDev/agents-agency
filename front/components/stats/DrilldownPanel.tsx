"use client";

interface DrilldownBudget {
  id: string;
  quoteNumber: string;
  clientName: string | null;
  totalImpl: number;
  totalMaint: number;
  status: string;
  createdAt: string;
}

interface DrilldownLead {
  id: string;
  customerName: string;
  status: string;
  createdAt: string;
}

export interface DrilldownData {
  period: string;
  budgets: DrilldownBudget[];
  leads: DrilldownLead[];
}

interface Props {
  data: DrilldownData | null;
  loading: boolean;
  onClose: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  accepted: "Aceptado",
  rejected: "Rechazado",
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "Cualificado",
  converted: "Convertido",
  lost: "Perdido",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "text-slate-400",
  sent: "text-blue-400",
  accepted: "text-green-400",
  rejected: "text-red-400",
  new: "text-violet-400",
  contacted: "text-blue-400",
  qualified: "text-cyan-400",
  converted: "text-green-400",
  lost: "text-red-400",
};

function euroFmt(n: number) {
  return n.toLocaleString("es-ES", { maximumFractionDigits: 0 }) + " €";
}

export default function DrilldownPanel({ data, loading, onClose }: Props) {
  if (!loading && !data) return null;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="kicker">Detalle periodo{data ? `: ${data.period}` : ""}</span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white text-lg leading-none"
          aria-label="Cerrar panel"
        >
          ×
        </button>
      </div>

      {loading && (
        <div className="text-slate-500 text-sm animate-pulse text-center py-4">
          Cargando desglose…
        </div>
      )}

      {!loading && data && (
        <>
          {/* Budgets */}
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">
              Presupuestos ({data.budgets.length})
            </h3>
            {data.budgets.length === 0 ? (
              <p className="text-slate-500 text-xs">Sin presupuestos en este periodo</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/5">
                      <th className="text-left py-1.5 pr-3">Nº</th>
                      <th className="text-left py-1.5 pr-3">Cliente</th>
                      <th className="text-right py-1.5 pr-3">Implant.</th>
                      <th className="text-right py-1.5 pr-3">Mant.</th>
                      <th className="text-left py-1.5">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.budgets.map((b) => (
                      <tr key={b.id} className="border-b border-white/5 hover:bg-white/2">
                        <td className="py-1.5 pr-3 text-slate-300 font-mono">{b.quoteNumber}</td>
                        <td className="py-1.5 pr-3 text-slate-400">{b.clientName ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-right text-slate-300">{euroFmt(b.totalImpl)}</td>
                        <td className="py-1.5 pr-3 text-right text-slate-300">{euroFmt(b.totalMaint)}</td>
                        <td className={`py-1.5 font-medium ${STATUS_COLORS[b.status] ?? "text-slate-400"}`}>
                          {STATUS_LABELS[b.status] ?? b.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Leads */}
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">
              Leads ({data.leads.length})
            </h3>
            {data.leads.length === 0 ? (
              <p className="text-slate-500 text-xs">Sin leads en este periodo</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/5">
                      <th className="text-left py-1.5 pr-3">Nombre</th>
                      <th className="text-left py-1.5 pr-3">Estado</th>
                      <th className="text-left py-1.5">Creado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leads.map((l) => (
                      <tr key={l.id} className="border-b border-white/5 hover:bg-white/2">
                        <td className="py-1.5 pr-3 text-slate-300">{l.customerName}</td>
                        <td className={`py-1.5 pr-3 font-medium ${STATUS_COLORS[l.status] ?? "text-slate-400"}`}>
                          {STATUS_LABELS[l.status] ?? l.status}
                        </td>
                        <td className="py-1.5 text-slate-500">
                          {new Date(l.createdAt).toLocaleDateString("es-ES")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
