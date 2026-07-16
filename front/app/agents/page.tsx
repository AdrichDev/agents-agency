"use client";

import Link from "next/link";
import { AgentsGrid } from "@/components/agents/AgentsGrid";

/**
 * Índice de Agentes (aa-dashboard-agents-nav-widgets T1.2). Antes esta ruta
 * daba 404 (solo existían /agents/new y /agents/[id]). Monta AgentsGrid a
 * pantalla completa, reutilizando la grid que vivía en dashboard/page.tsx.
 */
export default function AgentsPage() {
  return (
    <div>
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <div className="kicker mb-2 text-neon-cyan">Área de Trabajo</div>
          <h1 className="text-3xl font-extrabold text-neon-gradient">Agentes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Gestiona, prueba y despliega tus asistentes de Inteligencia
            Artificial.
          </p>
        </div>
        <Link href="/agents/new" className="btn-grad self-start">
          ✦ Nuevo Agente
        </Link>
      </section>

      <AgentsGrid />
    </div>
  );
}
