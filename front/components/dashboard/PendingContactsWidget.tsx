"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

/**
 * Widget de contactos sin gestionar del Dashboard (aa-dashboard-agents-nav-widgets
 * T1.4). Consume GET /api/contacts/pending-count → { count } (contactos con
 * contactado != "si", no borrados) y ofrece un CTA a /contactos.
 */
export function PendingContactsWidget() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    api<{ count: number }>("/api/contacts/pending-count")
      .then((res) => setCount(typeof res?.count === "number" ? res.count : 0))
      .catch(() => setCount(0));
  }, []);

  return (
    <div className="card p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Contactos sin gestionar</h3>
        <Link href="/contactos" className="text-xs text-indigo-400 hover:underline">
          Ver contactos →
        </Link>
      </div>

      {count === null ? (
        <p className="text-sm text-slate-500">Cargando contactos...</p>
      ) : count === 0 ? (
        <div className="flex-1 flex flex-col items-start justify-center gap-3">
          <p className="text-sm text-slate-400">
            No hay contactos pendientes. Todo al día. ✅
          </p>
          <Link href="/contactos" className="btn-ghost">
            Ir a contactos
          </Link>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-start justify-center gap-3">
          <div>
            <p className="text-4xl font-black text-neon-orange tabular-nums leading-none">
              {count}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {count === 1
                ? "contacto pendiente de gestionar"
                : "contactos pendientes de gestionar"}
            </p>
          </div>
          <Link href="/contactos" className="btn-grad">
            Gestionar contactos
          </Link>
        </div>
      )}
    </div>
  );
}
