"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

interface Skill {
  id: string;
  name: string;
  description: string;
  type: string; // SKILL | AGENT | EXTENSION | PLUGIN | MCP
  use: string;  // uso funcional en UPPERCASE
  repoUrl?: string | null;
  stars: number;
  tools: { name: string; description: string }[];
  favorite?: boolean;
}

interface SkillsResponse {
  items: Skill[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

type ViewOption = {
  key: string;
  label: string;
  icon: string;
  type: string; // filtra por la columna TYPE de cada skill
  description: string;
};

const VIEW_OPTIONS: ViewOption[] = [
  { key: "todos",      label: "Todos",       icon: "🌍", type: "",          description: "Todo el catálogo importado de herramientas" },
  { key: "skills",     label: "Skills",      icon: "🛒", type: "SKILL",     description: "Skills funcionales (email, bases de datos, desarrollo...)" },
  { key: "agents",     label: "Agentes",     icon: "🤖", type: "AGENT",     description: "Agentes de IA ya creados y listos para usar" },
  { key: "extensions", label: "Extensiones", icon: "🔌", type: "EXTENSION", description: "Extensiones para ampliar las capacidades del sistema" },
  { key: "plugins",    label: "Plugins",     icon: "📦", type: "PLUGIN",    description: "Plugins integrables en tu flujo de trabajo" },
  { key: "mcp",        label: "MCP",         icon: "🌐", type: "MCP",       description: "Model Context Protocol — servidores MCP compatibles" },
];

function normalizeUseOptions(items: string[]) {
  return Array.from(
    new Set(
      items
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  ).sort();
}

export default function SkillsMarketplace() {
  const searchParams = useSearchParams();

  const [activeView, setActiveView] = useState<ViewOption>(VIEW_OPTIONS[0]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [uses, setUses] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [discovering, setDiscovering] = useState(false);
  const [googleDiscovering, setGoogleDiscovering] = useState(false);
  const [adding, setAdding] = useState(false);
  const [repo, setRepo] = useState("");
  const [selectedUse, setSelectedUse] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [status, setStatus] = useState("");

  // Sincronizar desde parámetros de URL al montar (?type=AGENT, con fallback legado ?category=)
  useEffect(() => {
    const t = (searchParams.get("type") || searchParams.get("category") || "").toUpperCase();
    const matched = VIEW_OPTIONS.find((v) => v.type === t && v.type !== "");
    if (matched) setActiveView(matched);
  }, []);

  function load(nextPage = page) {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    if (q) params.set("q", q);

    // Las secciones filtran por TYPE; el select por USE
    if (activeView.type) params.set("type", activeView.type);
    if (selectedUse) params.set("use", selectedUse);

    if (onlyFavorites) params.set("favorite", "true");

    api<SkillsResponse>(`/api/skills?${params}`).then((res) => {
      setSkills(Array.isArray(res.items) ? res.items : []);
      setTotal(res.total ?? 0);
      setTotalPages(res.totalPages ?? 1);
    });
  }

  async function toggleFavorite(skillId: string) {
    try {
      const updated = await api<any>(`/api/skills/${skillId}/favorite`, { method: "PATCH" });
      setSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, favorite: updated.favorite } : s))
      );
    } catch (e) {
      console.error("Error toggling favorite", e);
    }
  }

  // Select dinámico: valores distintos de la columna USE
  function loadUses() {
    api<string[]>("/api/skills/uses")
      .then((items) => {
        setUses(normalizeUseOptions(Array.isArray(items) ? items : []));
      })
      .catch(() => {});
  }

  useEffect(() => {
    load(1);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activeView, selectedUse, onlyFavorites]);

  useEffect(() => {
    loadUses();
  }, []);

  function handleViewChange(view: ViewOption) {
    setActiveView(view);
    setPage(1);
    setQ("");
  }

  async function discover() {
    setDiscovering(true);
    setStatus("Scrapeando GitHub hasta 1000 repositorios...");
    try {
      const data = await api<any>("/api/skills", {
        method: "POST",
        body: JSON.stringify({ action: "discover", limit: 1000 }),
      });
      setStatus(
        data.discovered != null
          ? `${data.discovered} skills nuevas, ${data.updated} actualizadas, ${data.scanned} revisadas`
          : `Error: ${data.error}`
      );
    } catch {
      setStatus("Error de red");
    }
    setDiscovering(false);
    setPage(1);
    load(1);
    loadUses();
  }

  async function discoverGoogle() {
    setGoogleDiscovering(true);
    setStatus("Scrapeando servidores MCP de Google con Inteligencia Artificial...");
    try {
      const data = await api<any>("/api/skills", {
        method: "POST",
        body: JSON.stringify({ action: "discover-google" }),
      });
      setStatus(
        data.discovered != null
          ? `${data.discovered} skills nuevas de Google, ${data.updated} actualizadas, ${data.scanned} revisadas`
          : `Error: ${data.error}`
      );
    } catch {
      setStatus("Error de red");
    }
    setGoogleDiscovering(false);
    setPage(1);
    load(1);
    loadUses();
  }

  /** Una URL que no es de GitHub se trata como web a scrapear. */
  function isWebsiteUrl(value: string) {
    return /^https?:\/\//i.test(value) && !/github\.com/i.test(value);
  }

  async function addRepo() {
    const value = repo.trim();
    if (!value) return;
    setAdding(true);

    if (isWebsiteUrl(value)) {
      setStatus(`Scrapeando ${value} en busca de skills, agentes y MCPs...`);
      try {
        const data = await api<any>("/api/skills", {
          method: "POST",
          body: JSON.stringify({ action: "addWebsite", url: value }),
        });
        setStatus(
          data.found != null
            ? `${data.pagesScanned} páginas analizadas: ${data.created} componentes nuevos, ${data.updated} actualizados`
            : `Error: ${data.error}`
        );
        if (data.found != null) setRepo("");
      } catch {
        setStatus("Error de red");
      }
    } else {
      setStatus(`Añadiendo ${value}...`);
      try {
        const data = await api<any>("/api/skills", {
          method: "POST",
          body: JSON.stringify({ action: "addRepo", repo: value }),
        });
        setStatus(
          data.name
            ? `${data.name} ${data.created ? "añadido" : "actualizado"} (clasificado con IA)${
                data.components ? ` + ${data.components} componentes extraídos` : ""
              }`
            : `Error: ${data.error}`
        );
        if (data.name) setRepo("");
      } catch {
        setStatus("Error de red");
      }
    }

    setAdding(false);
    setPage(1);
    load(1);
    loadUses();
  }

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
                ? "bg-neon-gradient text-white shadow-[0_0_10px_rgba(157,0,255,0.4)]"
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
          <div key={s.id} className="card p-5 transition hover:bg-white/[0.06] hover:border-indigo-500/40 relative group">
            <button
              onClick={() => toggleFavorite(s.id)}
              className={`absolute top-4 right-4 text-lg transition duration-150 ${
                s.favorite ? "text-amber-400 opacity-100" : "text-slate-600 opacity-30 hover:opacity-100 group-hover:opacity-75"
              }`}
              title={s.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
            >
              ★
            </button>
            <div className="flex items-center justify-between mb-2 pr-6">
              <h3 className="font-semibold text-sm text-white truncate">{s.name}</h3>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <span className="chip">{(s.type || "SKILL").toUpperCase()}</span>
              <span className="chip">{(s.use || "GENERAL").toUpperCase()}</span>
              {s.stars > 0 && <span className="text-[10px] text-slate-400">⭐ {s.stars}</span>}
            </div>
            <p className="text-xs text-slate-500 mt-3 line-clamp-3">{s.description}</p>
            {Array.isArray(s.tools) && s.tools.length > 0 && (
              <p className="text-xs text-slate-600 mt-2">
                {s.tools.length} tools: {s.tools.slice(0, 3).map((t) => t.name).join(", ")}
                {s.tools.length > 3 && "..."}
              </p>
            )}
            {s.repoUrl && (
              <a
                href={s.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-400 mt-3 inline-block hover:underline"
              >
                Ver en GitHub
              </a>
            )}
          </div>
        ))}
      </div>

      {/* ── PAGINACIÓN ── */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-4 mt-8 text-sm text-slate-400">
          <span>Página {page} de {totalPages} - 25 por página</span>
          <div className="flex gap-2">
            <button
              className="btn-dark"
              disabled={page <= 1}
              onClick={() => {
                const next = Math.max(1, page - 1);
                setPage(next);
                load(next);
              }}
            >
              Anterior
            </button>
            <button
              className="btn-dark"
              disabled={page >= totalPages}
              onClick={() => {
                const next = Math.min(totalPages, page + 1);
                setPage(next);
                load(next);
              }}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
