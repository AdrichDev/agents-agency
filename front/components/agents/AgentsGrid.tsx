"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/ConfirmProvider";
import { api } from "@/lib/api";
import { AgentStatusChip } from "@/components/agents/AgentStatusChip";

/**
 * Grid reutilizable de agentes (extraída de dashboard/page.tsx,
 * aa-dashboard-agents-nav-widgets T1.1). Consume GET /api/agents e incluye
 * buscador, filtro de sector y tarjetas.
 *
 * Modo resumen: al pasar `limit`, oculta los controles de filtro y recorta las
 * tarjetas a las primeras N (uso desde el widget del Dashboard). Sin `limit`
 * renderiza la grid completa con controles (uso desde la página /agents).
 *
 * H3 (aa-agente-ciclo-vida-publicacion, T5.2) — Dos correcciones:
 *
 * 1. El campo que devuelve `GET /api/agents` es `tenant` (`service.ts:53`), no `client`. El
 *    tipo declaraba `client`, así que era SIEMPRE `undefined`: ni el nombre del cliente ni el
 *    switch se pintaron nunca, y la búsqueda por nombre de cliente nunca casó. Un bug que no
 *    se veía porque su síntoma era ausencia.
 *
 * 2. Fuera el `TokenSwitch` de la tarjeta de agente: apagaba el TENANT (con todos sus
 *    agentes), no el agente que se estaba mirando. Ahora el agente tiene apagado propio
 *    —despublicar— que es lo que corresponde aquí. El kill switch de tenant se queda en
 *    `/clients`, donde el objeto de la pantalla sí es el tenant.
 */

/**
 * aa-puesta-en-marcha-agente (T4.1) — Escalón de puesta en marcha.
 *
 * Lo calcula el backend (`lib/agent/onboarding.ts`) y sale por `GET /api/agents` y
 * `GET /api/agents/:id` con el mismo criterio. Aquí NO se recalcula: el front cuenta y
 * pinta lo que llega. Dos copias de la regla acaban discrepando y entonces la lista dice
 * una cosa y la ficha otra.
 */
export interface AgentOnboarding {
  step: "configurado" | "publicado" | "alcanzable" | "probado" | null;
  configurado: boolean;
  publicado: boolean;
  alcanzable: boolean;
  probado: boolean;
  nextLabel: string | null;
  nextTab: "ajustes" | "canales" | "implementacion" | null;
}

const STEP_LABEL: Record<NonNullable<AgentOnboarding["step"]>, string> = {
  configurado: "1/4 Configurado",
  publicado: "2/4 Publicado",
  alcanzable: "3/4 Alcanzable",
  probado: "4/4 En marcha",
};

export interface AgentRow {
  id: string;
  name: string;
  sector: string;
  /** Estado del ciclo de vida (H3). Opcional: agentes cacheados de antes de la migración. */
  status?: string | null;
  /** Opcional por la misma razón que `status`: respuestas cacheadas de antes de T2. */
  onboarding?: AgentOnboarding | null;
  tenant?: {
    id: string;
    name: string;
    isActive: boolean;
    tokenBalance: number;
    tokensUsed: number;
  } | null;
  integrations: { provider: string }[];
  _count: { conversations: number; automations: number; knowledge: number; leads: number };
}

const ICONS: Record<string, string> = {
  gmail: "✉️",
  slack: "💬",
  jira: "📋",
  calendar: "📅",
};

interface AgentsGridProps {
  /** Modo resumen: limita el nº de tarjetas y oculta los controles de filtro. */
  limit?: number;
}

export function AgentsGrid({ limit }: AgentsGridProps) {
  const summary = limit != null;
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [selectedSector, setSelectedSector] = useState("Todos");

  const [deleting, setDeleting] = useState<string | null>(null);
  const { confirm, notify } = useDialogs();

  useEffect(() => {
    api<AgentRow[]>("/api/agents")
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  async function handleDelete(a: AgentRow, e: MouseEvent) {
    // La tarjeta es un <Link>: evitar que el clic en la papelera navegue.
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: "Eliminar agente",
      message: `¿Eliminar el agente "${a.name}"? Esta acción es PERMANENTE (hard delete) y no se puede deshacer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setDeleting(a.id);
    try {
      await api(`/api/agents/${a.id}`, { method: "DELETE" });
      setAgents((prev) => (prev ? prev.filter((x) => x.id !== a.id) : prev));
    } catch (e) {
      // H3/T3.6: un agente que estuvo publicado devuelve 409 con la razón y la alternativa
      // (archivar). Tragarse ese mensaje dejaría al operador ante un "no se pudo" sin salida.
      const msg = e instanceof Error && e.message ? e.message : "No se pudo eliminar el agente.";
      await notify(msg, { tone: "error" });
    } finally {
      setDeleting(null);
    }
  }

  // Sectores únicos para el desplegable (solo relevante en modo completo).
  const sectors = [
    "Todos",
    ...Array.from(new Set(agents?.map((a) => a.sector).filter(Boolean) || [])),
  ];

  const filteredAgents = (agents ?? []).filter((a) => {
    const matchesSearch =
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.tenant?.name || "").toLowerCase().includes(search.toLowerCase());
    const matchesSector =
      selectedSector === "Todos" || a.sector === selectedSector;
    return matchesSearch && matchesSector;
  });

  // En modo resumen se recorta a las primeras N (los controles quedan ocultos).
  const visibleAgents = summary ? filteredAgents.slice(0, limit) : filteredAgents;

  // aa-puesta-en-marcha-agente (T4.1) — Los que no atienden a nadie.
  // Se cuentan sobre TODOS los agentes, no sobre los filtrados: es un problema de la
  // cuenta entera y esconderlo detrás del buscador sería justo el fallo que este change
  // corrige. Los que llegan sin `onboarding` (respuesta cacheada) no se cuentan: mejor no
  // decir nada que inventarse un número.
  const sinAtender = (agents ?? []).filter((a) => a.onboarding && !a.onboarding.alcanzable);

  return (
    <div>
      {!summary && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="kicker !text-slate-300 !text-sm">Tus agentes</h2>
            <p className="text-sm text-slate-500 mt-1">
              Gestiona, prueba y despliega tus asistentes de Inteligencia
              Artificial.
            </p>
          </div>

          {/* Controles de Filtros */}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              placeholder="Buscar agente..."
              className="input-dark !w-48 !py-1.5"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input-dark !w-40 !py-1.5 cursor-pointer"
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
            >
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* aa-puesta-en-marcha-agente (T4.1) — La cifra que faltaba.
          En producción había 10 agentes en borrador y nadie lo veía: el panel enseñaba
          "10 agentes" y todos parecían iguales. Un agente que no es alcanzable no atiende
          a nadie y no gana nada, y eso tiene que verse sin abrir ninguna ficha. */}
      {sinAtender.length > 0 && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 mb-5 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-amber-300">
            <strong>
              {sinAtender.length === 1
                ? "1 agente no atiende a nadie."
                : `${sinAtender.length} agentes no atienden a nadie.`}
            </strong>{" "}
            Están creados, pero sin publicar o sin el widget instalado: nadie puede
            escribirles todavía.
          </p>
          <Link
            href={`/agents/${sinAtender[0].id}`}
            className="text-xs text-amber-200 hover:underline shrink-0"
          >
            Empezar por {sinAtender[0].name} →
          </Link>
        </div>
      )}

      {!agents ? (
        <p className="text-slate-500">Cargando agentes...</p>
      ) : filteredAgents.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border-2 border-dashed border-slate-700 grid place-items-center text-2xl text-slate-600">
            ✦
          </div>
          <p className="text-white font-semibold mb-1">
            Sin agentes coincidentes
          </p>
          <p className="text-sm text-slate-500 mb-5">
            Prueba a cambiar los filtros o crea un nuevo agente.
          </p>
          <Link
            href="/agents/new"
            className="text-indigo-400 text-sm hover:underline"
          >
            Ir al wizard de creación →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleAgents.map((a) => (
            <Link
              key={a.id}
              href={`/agents/${a.id}`}
              className="card p-5 transition hover:bg-white/[0.04] hover:border-indigo-500/50 group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-white group-hover:text-indigo-300 transition">
                    {a.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <AgentStatusChip status={a.status} />
                    <span className="chip-accent">{a.sector}</span>
                  </div>
                </div>
                {a.tenant && (
                  <p className="text-sm text-slate-400 mb-2">
                    Cliente: {a.tenant.name}
                  </p>
                )}
                {/* T4.2 — Escalón. `status` dice si factura; esto dice si funciona.
                    No es lo mismo y confundirlos es el origen del problema. */}
                {a.onboarding && (
                  <p
                    className={`text-xs mb-2 ${
                      a.onboarding.probado ? "text-emerald-400/80" : "text-amber-400/80"
                    }`}
                    title={a.onboarding.nextLabel ?? "En marcha y con tráfico real."}
                  >
                    {a.onboarding.step ? STEP_LABEL[a.onboarding.step] : "0/4 Sin configurar"}
                    {a.onboarding.nextLabel && (
                      <span className="text-slate-500"> · {a.onboarding.nextLabel}</span>
                    )}
                  </p>
                )}
                <div className="text-lg mb-6">
                  {a.integrations.map((i) => (
                    <span
                      key={i.provider}
                      className="mr-1.5"
                      title={i.provider}
                    >
                      {ICONS[i.provider] ?? "🔌"}
                    </span>
                  ))}
                  {a.integrations.length === 0 && (
                    <span className="text-xs text-slate-600">
                      Sin integraciones
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-slate-500 border-t border-edge pt-3 mt-auto">
                <span>💬 {a._count.conversations} chats</span>
                <span>⚙️ {a._count.automations} autom.</span>
                <span>📚 {a._count.knowledge} chunks</span>
                <button
                  type="button"
                  title="Eliminar agente (permanente)"
                  aria-label="Eliminar agente"
                  disabled={deleting === a.id}
                  onClick={(e) => handleDelete(a, e)}
                  className="icon-btn icon-btn-delete ml-auto shrink-0 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
