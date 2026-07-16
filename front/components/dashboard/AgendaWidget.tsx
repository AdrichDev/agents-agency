"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

/**
 * Widget de Agenda del Dashboard (aa-dashboard-agents-nav-widgets T1.4).
 * Consume GET /api/agenda/appointments (ordenadas asc por el back) y muestra
 * las próximas N citas (corte client-side: fecha/hora >= ahora).
 */

interface Appt {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  client?: string | null;
  service?: string;
  status?: string;
}

function apptStart(a: Appt): number {
  const t = new Date(`${a.date}T${a.time || "00:00"}`).getTime();
  return Number.isFinite(t) ? t : Infinity;
}

export function AgendaWidget({ limit = 5 }: { limit?: number }) {
  const [appts, setAppts] = useState<Appt[] | null>(null);

  useEffect(() => {
    api<Appt[]>("/api/agenda/appointments")
      .then((rows) => setAppts(Array.isArray(rows) ? rows : []))
      .catch(() => setAppts([]));
  }, []);

  const now = Date.now();
  const upcoming = (appts ?? [])
    .filter((a) => apptStart(a) >= now)
    .sort((a, b) => apptStart(a) - apptStart(b))
    .slice(0, limit);

  return (
    <div className="card p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Próximas citas</h3>
        <Link href="/agenda" className="text-xs text-indigo-400 hover:underline">
          Ver agenda →
        </Link>
      </div>

      {!appts ? (
        <p className="text-sm text-slate-500">Cargando agenda...</p>
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-slate-500">Sin próximas citas.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge">
          {upcoming.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5">
              <div className="text-center min-w-[54px]">
                <div className="text-[11px] uppercase text-slate-500">
                  {new Date(`${a.date}T00:00`).toLocaleDateString("es-ES", {
                    day: "2-digit",
                    month: "short",
                  })}
                </div>
                <div className="text-sm font-bold text-neon-cyan tabular-nums">
                  {a.time}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">
                  {a.client || "Personal"}
                </p>
                {a.service && (
                  <p className="text-xs text-slate-500 truncate">{a.service}</p>
                )}
              </div>
              {a.status && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {a.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
