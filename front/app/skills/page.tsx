"use client";

import { Pagination } from "@/components/ui/Pagination";
import SkillCard from "@/components/skills/SkillCard";
import {
  useSkillsMarketplace,
  isWebsiteUrl,
  VIEW_OPTIONS,
} from "@/hooks/useSkillsMarketplace";

export default function SkillsMarketplace() {
  const {
    activeView,
    skills,
    uses,
    q, setQ,
    page, setPage,
    total,
    totalPages,
    discovering,
    googleDiscovering,
    adding,
    repo, setRepo,
    selectedUse, setSelectedUse,
    onlyFavorites, setOnlyFavorites,
    status,
    load,
    toggleFavorite,
    handleViewChange,
    discover,
    discoverGoogle,
    addRepo,
  } = useSkillsMarketplace();

  return (
    <div>
      {/* ── HEADER ── */}
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="kicker mb-2">Marketplace</div>
          <h1 className="text-3xl font-extrabold text-white flex items-center gap-3">
            <span>{activeView.icon}</span>
            {activeView.label}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {activeView.description} — {total} disponibles
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={discover}
            disabled={discovering || googleDiscovering}
            className="btn-dark flex items-center gap-2 font-bold px-4 py-2.5 text-xs"
          >
            <svg className="w-4 h-4 fill-current text-[#cbd5e1]" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            {discovering ? "Scrapeando..." : "Importar de GitHub"}
          </button>

          <button
            onClick={discoverGoogle}
            disabled={discovering || googleDiscovering}
            className="btn-dark flex items-center gap-2 font-bold px-4 py-2.5 text-xs border border-edge hover:bg-white/5"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            {googleDiscovering ? "Scrapeando..." : "Importar de Google (AI)"}
          </button>
        </div>
      </div>

      {/* ── TABS DE VISTA (en la propia página) ── */}
      <div className="flex gap-1.5 mb-7 flex-wrap p-1 bg-white/[0.03] border border-edge rounded-2xl w-fit">
        {VIEW_OPTIONS.map((view) => (
          <button
            key={view.key}
            onClick={() => handleViewChange(view)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
              activeView.key === view.key
                ? "bg-accent-gradient text-white shadow-[0_0_10px_rgba(99,102,241,0.4)]"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="text-base">{view.icon}</span>
            {view.label}
          </button>
        ))}
      </div>

      {status && <p className="text-xs text-slate-400 mb-5">{status}</p>}

      {/* ── AÑADIR REPO ── */}
      <div className="card p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <input
            className="input-dark"
            placeholder="Repo de GitHub (owner/repo) o URL de una web para scrapear skills, agentes y MCPs"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <button onClick={addRepo} disabled={adding || !repo.trim()} className="btn-dark">
            {adding
              ? isWebsiteUrl(repo.trim())
                ? "Scrapeando..."
                : "Añadiendo..."
              : isWebsiteUrl(repo.trim())
                ? "Scrapear web"
                : "Añadir repo"}
          </button>
        </div>
      </div>

      {/* ── BUSCADOR Y FILTROS ── */}
      <div className="flex gap-4 items-center mb-7 flex-wrap">
        <input
          className="input-dark !w-64"
          placeholder={`Buscar en ${activeView.label}...`}
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />

        <select
          aria-label="Filtrar por usos"
          className="input-dark !w-48 cursor-pointer"
          value={selectedUse}
          onChange={(e) => {
            setSelectedUse(e.target.value.trim().toUpperCase());
            setPage(1);
          }}
        >
          <option value="">Todos los usos</option>
          {uses.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => {
            setOnlyFavorites(!onlyFavorites);
            setPage(1);
          }}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-xs font-bold transition ${
            onlyFavorites
              ? "bg-amber-500/10 border-amber-500 text-amber-400"
              : "border-edge text-slate-400 hover:text-slate-200"
          }`}
        >
          ⭐ Mostrar favoritos
        </button>
      </div>

      {/* ── EMPTY STATE ── */}
      {skills.length === 0 && (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border-2 border-dashed border-slate-700 grid place-items-center text-2xl text-slate-600">
            {activeView.icon}
          </div>
          <p className="text-white font-semibold mb-1">{activeView.label} vacío</p>
          <p className="text-sm text-slate-500">
            Pulsa descubrir o añade un repositorio de GitHub manualmente.
          </p>
        </div>
      )}

      {/* ── GRID ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {skills.map((s) => (
          <SkillCard key={s.id} skill={s} onToggleFavorite={toggleFavorite} />
        ))}
      </div>

      {/* ── PAGINACIÓN ── */}
      <div className="mt-8">
        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={25}
          onChange={(p) => {
            setPage(p);
            load(p);
          }}
        />
      </div>
    </div>
  );
}
