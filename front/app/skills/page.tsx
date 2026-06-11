"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { capitalize } from "@/lib/text";

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  repoUrl?: string | null;
  stars: number;
  tools: { name: string; description: string }[];
}

interface SkillsResponse {
  items: Skill[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_CATEGORIES = [
  "general",
  "desarrollo",
  "email",
  "mensajería",
  "gestión de proyectos",
  "calendario",
  "bases de datos",
  "web scraping",
  "archivos",
  "búsqueda",
  "negocio",
];

export default function SkillsMarketplace() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [discovering, setDiscovering] = useState(false);
  const [adding, setAdding] = useState(false);
  const [repo, setRepo] = useState("");
  const [manualCategory, setManualCategory] = useState("general");
  const [status, setStatus] = useState("");

  function load(nextPage = page) {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    api<SkillsResponse>(`/api/skills?${params}`).then((res) => {
      setSkills(Array.isArray(res.items) ? res.items : []);
      setTotal(res.total ?? 0);
      setTotalPages(res.totalPages ?? 1);
    });
  }

  function loadCategories() {
    api<string[]>("/api/skills/categories")
      .then((items) => {
        const merged = new Set([...DEFAULT_CATEGORIES, ...(Array.isArray(items) ? items : [])]);
        setCategories([...merged].filter(Boolean).sort());
      })
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, [q, category, page]);

  useEffect(() => {
    loadCategories();
  }, []);

  function resetFilter(nextCategory: string) {
    setPage(1);
    setCategory(nextCategory);
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
    loadCategories();
  }

  async function addRepo() {
    const value = repo.trim();
    if (!value) return;

    setAdding(true);
    setStatus(`Añadiendo ${value}...`);
    try {
      const data = await api<any>("/api/skills", {
        method: "POST",
        body: JSON.stringify({
          action: "addRepo",
          repo: value,
          category: manualCategory,
        }),
      });
      setStatus(
        data.name
          ? `${data.name} ${data.created ? "añadido" : "actualizado"} en ${manualCategory}`
          : `Error: ${data.error}`
      );
      if (data.name) setRepo("");
    } catch {
      setStatus("Error de red");
    }
    setAdding(false);
    setPage(1);
    load(1);
    loadCategories();
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="kicker mb-2">Marketplace</div>
          <h1 className="text-3xl font-extrabold text-white">Skills</h1>
          <p className="text-sm text-slate-500 mt-1">
            MCPs auto-descubiertos de GitHub - {total} disponibles
          </p>
        </div>
        <button onClick={discover} disabled={discovering} className="btn-grad">
          {discovering ? "Descubriendo..." : "Importar de GitHub"}
        </button>
      </div>
      {status && <p className="text-xs text-slate-400 mb-5">{status}</p>}

      <div className="card p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3">
          <input
            className="input-dark"
            placeholder="https://github.com/owner/repo o owner/repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <select
            className="input-dark"
            value={manualCategory}
            onChange={(e) => setManualCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {capitalize(c)}
              </option>
            ))}
          </select>
          <button onClick={addRepo} disabled={adding || !repo.trim()} className="btn-dark">
            {adding ? "Añadiendo..." : "Añadir repo"}
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-7 flex-wrap">
        <input
          className="input-dark !w-64"
          placeholder="Buscar..."
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        <button
          onClick={() => resetFilter("")}
          className={!category ? "chip-accent" : "chip hover:text-slate-300"}
        >
          Todas
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => resetFilter(c === category ? "" : c)}
            className={category === c ? "chip-accent" : "chip hover:text-slate-300"}
          >
            {capitalize(c)}
          </button>
        ))}
      </div>

      {skills.length === 0 && (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border-2 border-dashed border-slate-700 grid place-items-center text-2xl text-slate-600">
            +
          </div>
          <p className="text-white font-semibold mb-1">Marketplace vacío</p>
          <p className="text-sm text-slate-500">
            Pulsa descubrir o añade un repositorio de GitHub manualmente.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {skills.map((s) => (
          <div key={s.id} className="card p-5 transition hover:bg-white/[0.06] hover:border-indigo-500/40">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm text-white truncate">{s.name}</h3>
              {s.stars > 0 && <span className="text-xs text-amber-400">★ {s.stars}</span>}
            </div>
            <span className="chip">{capitalize(s.category)}</span>
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

      {total > 0 && (
        <div className="flex items-center justify-between gap-4 mt-8 text-sm text-slate-400">
          <span>
            Página {page} de {totalPages} - 25 por página
          </span>
          <div className="flex gap-2">
            <button
              className="btn-dark"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              className="btn-dark"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
