"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

export interface Skill {
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

export type ViewOption = {
  key: string;
  label: string;
  icon: string;
  type: string; // filtra por la columna TYPE de cada skill
  description: string;
};

// Respuestas de las acciones POST /api/skills. Todos los campos son opcionales:
// en caso de error el backend devuelve { error }, si no los contadores propios
// de cada acción.
interface DiscoverResult {
  discovered?: number;
  updated?: number;
  scanned?: number;
  error?: string;
}
interface AddWebsiteResult {
  found?: number;
  pagesScanned?: number;
  created?: number;
  updated?: number;
  error?: string;
}
interface AddRepoResult {
  name?: string;
  created?: boolean;
  components?: number;
  error?: string;
}

export const VIEW_OPTIONS: ViewOption[] = [
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

/** Una URL que no es de GitHub se trata como web a scrapear. */
export function isWebsiteUrl(value: string) {
  return /^https?:\/\//i.test(value) && !/github\.com/i.test(value);
}

/**
 * Estado + fetch del marketplace de skills. Extrae la lógica de datos de la
 * página; el comportamiento (llamadas de red, efectos, mensajes de estado) es
 * idéntico al inline previo.
 */
export function useSkillsMarketplace() {
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
      const updated = await api<{ favorite: boolean }>(`/api/skills/${skillId}/favorite`, { method: "PATCH" });
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
      const data = await api<DiscoverResult>("/api/skills", {
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
      const data = await api<DiscoverResult>("/api/skills", {
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

  async function addRepo() {
    const value = repo.trim();
    if (!value) return;
    setAdding(true);

    if (isWebsiteUrl(value)) {
      setStatus(`Scrapeando ${value} en busca de skills, agentes y MCPs...`);
      try {
        const data = await api<AddWebsiteResult>("/api/skills", {
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
        const data = await api<AddRepoResult>("/api/skills", {
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

  return {
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
  };
}
