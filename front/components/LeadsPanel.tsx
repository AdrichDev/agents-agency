"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface LeadItem {
  id: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  intent: string | null;
  handoff: boolean;
}

interface Props {
  agentId: string;
}

export default function LeadsPanel({ agentId }: Props) {
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ leads: LeadItem[] }>(`/api/agents/${agentId}/leads`)
      .then((data) => setLeads(data.leads))
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, [agentId]);

  if (loading) return <p className="text-slate-500 text-sm">Cargando leads…</p>;

  if (leads.length === 0) {
    return (
      <div className="card p-6">
        <p className="text-slate-500 text-sm">No hay leads capturados todavía.</p>
      </div>
    );
  }

  const handoffCount = leads.filter((l) => l.handoff).length;

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-white">Leads capturados</h3>
        {handoffCount > 0 && (
          <span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-0.5">
            {handoffCount} en handoff
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-slate-300">
          <thead>
            <tr className="border-b border-edge text-slate-500">
              <th className="text-left py-2 pr-4 font-medium">Nombre</th>
              <th className="text-left py-2 pr-4 font-medium">Email</th>
              <th className="text-left py-2 pr-4 font-medium">Teléfono</th>
              <th className="text-left py-2 pr-4 font-medium">Intención</th>
              <th className="text-left py-2 pr-4 font-medium">Estado</th>
              <th className="text-left py-2 font-medium">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-edge/50 hover:bg-white/5">
                <td className="py-2 pr-4">{lead.customerName}</td>
                <td className="py-2 pr-4">{lead.email ?? "—"}</td>
                <td className="py-2 pr-4">{lead.phone ?? "—"}</td>
                <td className="py-2 pr-4">
                  {lead.intent ? (
                    <span className="text-indigo-300">{lead.intent}</span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {lead.handoff ? (
                    <span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-0.5">
                      Handoff
                    </span>
                  ) : (
                    <span className="text-slate-400 capitalize">{lead.status}</span>
                  )}
                </td>
                <td className="py-2 text-slate-500">
                  {new Date(lead.createdAt).toLocaleDateString("es-ES", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
