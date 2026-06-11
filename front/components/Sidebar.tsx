"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import SidebarNavItem from "@/components/SidebarNavItem";
import { NAV_ITEMS } from "@/lib/navigation";
import { api } from "@/lib/api";

export default function Sidebar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState("dark");
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const storedTheme = localStorage.getItem("theme") || "dark";
    setTheme(storedTheme);
    document.documentElement.setAttribute("data-theme", storedTheme);
  }, []);

  // Cargar lista de agentes creados
  useEffect(() => {
    api("/api/agents")
      .then((data) => {
        if (Array.isArray(data)) {
          setAgents(data.map((a: any) => ({ id: a.id, name: a.name })));
        }
      })
      .catch(() => {});
  }, [pathname]);

  // Sincronizar categoría en navegación
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setActiveCategory(params.get("category") || "");
    }
  }, [pathname]);

  // Cerrar el dropdown al hacer clic fuera del mismo
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsMarketplaceOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const getSelectedLabel = () => {
    if (pathname === "/skills") {
      if (activeCategory === "extensiones") return "🔌 Extensiones";
      if (activeCategory === "plugins") return "📦 Plugins";
      if (activeCategory === "mcp") return "🌐 MCP";
      return "🛒 Todos los Skills";
    }
    if (pathname.startsWith("/agents/") && pathname !== "/agents/new") {
      const currentAgent = agents.find((a) => `/agents/${a.id}` === pathname);
      return currentAgent ? `🤖 ${currentAgent.name}` : "🤖 Agente";
    }
    return "🛒 Marketplace";
  };

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
  };


  return (
    <aside className="w-60 shrink-0 min-h-screen bg-panel border-r border-edge flex flex-col no-print">
      <div className="px-5 py-6 flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-white/5 border border-edge grid place-items-center overflow-hidden">
          <img src="/LogoAC.png" alt="ADRICH" className="h-10 w-10 object-contain" />
        </div>
        <div>
          <div className="font-extrabold tracking-wider text-white leading-tight text-lg">ADRICH</div>
          <div className="text-[9px] uppercase tracking-[0.15em] text-slate-500 font-medium">
            Agencia de agentes de IA
          </div>
        </div>
      </div>

      <div className="px-5 mt-4 mb-2 kicker">Espacio de trabajo</div>
      <nav className="px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          if (item.href === "/skills") {
            return (
              <div key={item.href} ref={dropdownRef} className="space-y-1 relative">
                {/* Cabecera desplegable de Marketplace */}
                <button
                  onClick={() => setIsMarketplaceOpen(!isMarketplaceOpen)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition text-left ${
                    pathname.startsWith("/skills") || (pathname.startsWith("/agents/") && pathname !== "/agents/new")
                      ? "bg-white/5 text-white"
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-indigo-400">{item.icon}</span>
                    <span className="truncate">{getSelectedLabel()}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-bold transition-transform duration-200">
                    {isMarketplaceOpen ? "▼" : "▶"}
                  </span>
                </button>

                {/* Submenú Dropdown Flotante */}
                {isMarketplaceOpen && (
                  <div className="absolute left-0 right-0 mt-1 bg-[#18181b]/95 backdrop-blur-md border border-edge rounded-xl py-1.5 z-50 shadow-2xl max-h-[350px] overflow-y-auto">
                    <Link
                      href="/skills"
                      onClick={() => setIsMarketplaceOpen(false)}
                      className={`flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition ${
                        pathname === "/skills" && !activeCategory
                          ? "text-indigo-400 bg-white/[0.04]"
                          : "text-slate-300 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      <span className="text-sm">🛒</span> Todos los Skills
                    </Link>

                    <Link
                      href="/skills?category=extensiones"
                      onClick={() => setIsMarketplaceOpen(false)}
                      className={`flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition ${
                        activeCategory === "extensiones"
                          ? "text-indigo-400 bg-white/[0.04]"
                          : "text-slate-300 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      <span className="text-sm">🔌</span> Extensiones
                    </Link>

                    <Link
                      href="/skills?category=plugins"
                      onClick={() => setIsMarketplaceOpen(false)}
                      className={`flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition ${
                        activeCategory === "plugins"
                          ? "text-indigo-400 bg-white/[0.04]"
                          : "text-slate-300 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      <span className="text-sm">📦</span> Plugins
                    </Link>

                    <Link
                      href="/skills?category=mcp"
                      onClick={() => setIsMarketplaceOpen(false)}
                      className={`flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition ${
                        activeCategory === "mcp"
                          ? "text-indigo-400 bg-white/[0.04]"
                          : "text-slate-300 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      <span className="text-sm">🌐</span> MCP
                    </Link>

                    <div className="border-t border-edge/60 my-1"></div>

                    <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider font-bold text-slate-500 flex items-center justify-between">
                      <span>🤖 Agentes Creados</span>
                      <span className="bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded text-[8px] font-bold">
                        {agents.length}
                      </span>
                    </div>

                    <div className="max-h-[160px] overflow-y-auto space-y-0.5 px-1">
                      {agents.length > 0 ? (
                        agents.map((agent) => (
                          <Link
                            key={agent.id}
                            href={`/agents/${agent.id}`}
                            onClick={() => setIsMarketplaceOpen(false)}
                            className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-md truncate transition ${
                              pathname === `/agents/${agent.id}`
                                ? "text-indigo-400 bg-white/[0.04] font-semibold"
                                : "text-slate-400 hover:text-white hover:bg-white/5"
                            }`}
                            title={agent.name}
                          >
                            <span className="text-[10px] text-slate-500">•</span>
                            <span className="truncate">{agent.name}</span>
                          </Link>
                        ))
                      ) : (
                        <span className="block px-3 py-2 text-[10px] text-slate-500 italic">
                          Ningún agente creado
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          }

          return (
            <SidebarNavItem
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)}
            />
          );
        })}
      </nav>

      {/* Perfil del usuario y Modo Claro/Oscuro en la parte inferior */}
      <div className="mt-auto px-5 py-5 border-t border-edge flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 grid place-items-center text-white text-sm font-bold">
            A
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Adrián</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Admin</div>
          </div>
        </div>

        <button 
          onClick={toggleTheme}
          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition border border-edge grid place-items-center text-sm"
          title={theme === "dark" ? "Modo Claro" : "Modo Oscuro"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>
    </aside>
  );
}
