"use client";

/**
 * Pestaña "Skills" del detalle de agente (aa-agent-skills-install-execute, F3):
 * editor del conjunto CURADO de skills del agente. Dos secciones:
 *  1. "Instaladas": las skills elegidas para este agente, con un badge que
 *     comunica el TIPO de ejecución (nunca "inactiva" — el motor de instrucciones
 *     garantiza que toda skill instalada es ejecutable, como mínimo a nivel
 *     instrucción vía `usar_skill`).
 *  2. "Marketplace": buscador paginado para AÑADIR skills al conjunto.
 * "Guardar" hace un reemplazo declarativo vía PUT /api/agents/:id/skills y
 * refresca `skillStatus` con la respuesta del back (única fuente de verdad del
 * estado de ejecución; el front consume, nunca infiere).
 */

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Pagination } from "@/components/ui/Pagination";
import { useSkillsMarketplace, VIEW_OPTIONS } from "@/hooks/useSkillsMarketplace";

const MAX_INSTALLED_SKILLS = 15;

interface SkillStatusItem {
  skillId: string;
  name: string;
  state: "executable" | "requires_connection" | "informational";
  provider?: string;
  /**
   * Estado de la capa MCP externa (F2b), ADITIVO al `state` de instrucción/provider:
   * "enabled" → declara servidor MCP y hay secreto per-agente; "pending" → declara
   * servidor pero falta el secreto. Ausente = la skill no declara MCP.
   */
  mcp?: "enabled" | "pending";
}

interface SelectedSkill {
  skillId: string;
  name: string;
}

/** Badge del TIPO de ejecución de una skill instalada (jamás "inerte"). */
function InstalledBadge({
  item,
  onGoToIntegrations,
}: {
  item: SkillStatusItem;
  onGoToIntegrations: () => void;
}) {
  if (item.state === "executable") {
    return (
      <span className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-2 py-0.5">
        {item.provider ? `instrucción + ${item.provider}` : "instrucción + herramientas"}
      </span>
    );
  }
  if (item.state === "requires_connection") {
    return (
      <button
        type="button"
        onClick={onGoToIntegrations}
        title="Conéctalo en «Canales e integraciones» para darle a esta skill sus tools"
        className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-0.5 hover:bg-amber-400/20 transition"
      >
        requiere conectar {item.provider}
      </button>
    );
  }
  // informational: ejecución a nivel instrucción (usar_skill) — NO inactiva.
  return (
    <span
      className="text-xs text-slate-400 bg-slate-500/10 border border-slate-500/20 rounded px-2 py-0.5"
      title="Se ejecuta a nivel instrucción vía usar_skill"
    >
      instrucción
    </span>
  );
}

/**
 * Badge MCP (F2b): ADITIVO al badge de estado de instrucción/provider — una
 * skill puede ser "instrucción" o "instrucción + provider" Y ADEMÁS exponer
 * un servidor MCP curado. El back ya decide "enabled"/"pending"; el front
 * solo pinta lo que llega, nunca infiere capacidades.
 */
function McpBadge({ mcp }: { mcp: SkillStatusItem["mcp"] }) {
  if (mcp === "enabled") {
    return (
      <span className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-2 py-0.5">
        + MCP
      </span>
    );
  }
  if (mcp === "pending") {
    return (
      <span
        title="Falta secreto MCP para este agente"
        className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-0.5"
      >
        MCP pendiente
      </span>
    );
  }
  return null;
}

export default function SkillsTab({
  agent,
  onChange,
  onGoToIntegrations,
}: {
  agent: any;
  onChange: () => void;
  onGoToIntegrations: () => void;
}) {
  // Estado servido por el back (fuente de verdad del badge). Se refresca tras Guardar.
  const [savedStatus, setSavedStatus] = useState<SkillStatusItem[]>(
    (agent.skillStatus as SkillStatusItem[]) ?? []
  );
  // Conjunto deseado (editable en memoria). Init desde el estado guardado.
  const [selected, setSelected] = useState<SelectedSkill[]>(
    ((agent.skillStatus as SkillStatusItem[]) ?? []).map((s) => ({
      skillId: s.skillId,
      name: s.name,
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const market = useSkillsMarketplace();

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.skillId)), [selected]);
  const statusMap = useMemo(
    () => new Map(savedStatus.map((s) => [s.skillId, s])),
    [savedStatus]
  );

  const savedIds = useMemo(() => new Set(savedStatus.map((s) => s.skillId)), [savedStatus]);
  const dirty =
    selected.length !== savedIds.size || selected.some((s) => !savedIds.has(s.skillId));

  const atCap = selected.length >= MAX_INSTALLED_SKILLS;

  function add(skill: { id: string; name: string }) {
    if (selectedIds.has(skill.id) || atCap) return;
    setSelected((prev) => [...prev, { skillId: skill.id, name: skill.name }]);
  }

  function remove(skillId: string) {
    setSelected((prev) => prev.filter((s) => s.skillId !== skillId));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await api<{ skillStatus: SkillStatusItem[] }>(
        `/api/agents/${agent.id}/skills`,
        {
          method: "PUT",
          body: JSON.stringify({ skillIds: selected.map((s) => s.skillId) }),
        }
      );
      const next = res.skillStatus ?? [];
      setSavedStatus(next);
      setSelected(next.map((s) => ({ skillId: s.skillId, name: s.name })));
      onChange();
    } catch (e: any) {
      setError(e?.body?.error ?? e?.message ?? "No se pudo guardar la selección de skills");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ---------- Instaladas ---------- */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-sm text-white">Skills instaladas</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Toda skill instalada es ejecutable: como mínimo a nivel instrucción, y con
              tools reales cuando el proveedor está conectado. Máx. {MAX_INSTALLED_SKILLS}.
            </p>
          </div>
          <span className="text-xs text-slate-500 whitespace-nowrap">
            {selected.length}/{MAX_INSTALLED_SKILLS}
          </span>
        </div>

        {selected.length === 0 ? (
          <p className="text-xs text-slate-500">
            Este agente no tiene skills elegidas. Añade desde el marketplace las que
            necesite para su función.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {selected.map((s) => {
              const status = statusMap.get(s.skillId);
              return (
                <li
                  key={s.skillId}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span className="text-slate-300">{s.name}</span>
                  <div className="flex items-center gap-2">
                    {status ? (
                      <>
                        <InstalledBadge item={status} onGoToIntegrations={onGoToIntegrations} />
                        <McpBadge mcp={status.mcp} />
                      </>
                    ) : (
                      <span className="text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded px-2 py-0.5">
                        sin guardar
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(s.skillId)}
                      title="Quitar del conjunto"
                      className="text-xs text-slate-500 hover:text-red-400 transition px-1"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="btn-grad disabled:opacity-40"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          {dirty && !saving && (
            <span className="text-xs text-slate-500">Cambios sin guardar</span>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>

      {/* ---------- Marketplace ---------- */}
      <div className="card p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-sm text-white">Marketplace</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Busca y añade skills al conjunto de este agente. La selección es curada:
            elige solo las que necesita para su rol.
          </p>
        </div>

        {/* Vistas por tipo (F1): filtro server-side vía activeView.type en el hook. */}
        <div className="flex gap-2 flex-wrap">
          {VIEW_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.key}
              onClick={() => market.handleViewChange(opt)}
              className={
                market.activeView.key === opt.key ? "chip-accent" : "chip hover:text-slate-300"
              }
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
        {/* Descripción de la vista activa (F2): explica qué es cada tipo (p.ej. MCP). */}
        <p className="text-xs text-slate-500">{market.activeView.description}</p>

        <div className="flex gap-2 flex-wrap">
          <input
            className="input-dark !w-64 !py-2"
            placeholder="Buscar por nombre…"
            value={market.q}
            onChange={(e) => {
              market.setPage(1);
              market.setQ(e.target.value);
            }}
          />
          <button
            type="button"
            onClick={() => {
              market.setPage(1);
              market.setSelectedUse("");
            }}
            className={!market.selectedUse ? "chip-accent" : "chip hover:text-slate-300"}
          >
            Todas
          </button>
          {market.uses.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => {
                market.setPage(1);
                market.setSelectedUse(item === market.selectedUse ? "" : item);
              }}
              className={
                market.selectedUse === item ? "chip-accent" : "chip hover:text-slate-300"
              }
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>

        {atCap && (
          <p className="text-xs text-amber-400">
            Límite de {MAX_INSTALLED_SKILLS} skills alcanzado. Quita alguna para añadir otra.
          </p>
        )}

        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
          {market.skills.length === 0 ? (
            <p className="text-xs text-slate-500">Sin resultados.</p>
          ) : (
            market.skills.map((skill) => {
              const already = selectedIds.has(skill.id);
              return (
                <div
                  key={skill.id}
                  className="flex items-start justify-between gap-3 text-sm card !rounded-xl p-3"
                >
                  <span>
                    <strong className="text-slate-200">{skill.name}</strong>{" "}
                    <span className="text-xs text-slate-600">
                      {/* F3: con las pestañas activas el TYPE ya no hace falta gritarlo,
                          salvo en "Todos" donde sí ayuda a distinguir. */}
                      {market.activeView.type
                        ? `(${(skill.use || "GENERAL").toUpperCase()})`
                        : `(${(skill.type || "SKILL").toUpperCase()} · ${(skill.use || "GENERAL").toUpperCase()})`}
                    </span>
                    <br />
                    <span className="text-slate-500">{skill.description?.slice(0, 100)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => add(skill)}
                    disabled={already || atCap}
                    className="btn-dark text-xs whitespace-nowrap disabled:opacity-40"
                  >
                    {already ? "Añadida" : "Añadir"}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <Pagination page={market.page} totalPages={market.totalPages} onChange={market.setPage} />
      </div>
    </div>
  );
}
