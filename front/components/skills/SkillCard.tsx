"use client";

import type { Skill } from "@/hooks/useSkillsMarketplace";

/**
 * Tarjeta de una skill/agente/MCP del marketplace. Extraída de la página sin
 * cambios de UI.
 */
export default function SkillCard({
  skill,
  onToggleFavorite,
}: {
  skill: Skill;
  onToggleFavorite: (skillId: string) => void;
}) {
  const s = skill;
  return (
    <div className="card p-5 transition hover:bg-white/[0.06] hover:border-indigo-500/40 relative group">
      <button
        onClick={() => onToggleFavorite(s.id)}
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
  );
}
