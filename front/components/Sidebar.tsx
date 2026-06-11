"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import SidebarNavItem from "@/components/SidebarNavItem";
import { NAV_ITEMS } from "@/lib/navigation";
import { api } from "@/lib/api";

export default function Sidebar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState("dark");
  const [logo, setLogo] = useState("/3A_Logo.png");

  useEffect(() => {
    const storedTheme = localStorage.getItem("theme") || "dark";
    setTheme(storedTheme);
    document.documentElement.setAttribute("data-theme", storedTheme);

    const updateLogo = () => {
      const stored = localStorage.getItem("sidebar-logo");
      setLogo(stored || "/3A_Logo.png");
    };
    updateLogo();

    window.addEventListener("config-updated", updateLogo);
    return () => {
      window.removeEventListener("config-updated", updateLogo);
    };
  }, []);





  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
  };


  return (
    <aside className="w-60 shrink-0 min-h-screen bg-panel border-r border-edge flex flex-col no-print">
      <div className="px-5 py-6 flex items-center gap-3">
        <div className="h-20 flex items-center justify-center shrink-0">
          {logo && <img src={logo} alt="ADRICH" className="h-full w-auto object-contain" />}
        </div>
        <div className="flex flex-col justify-center">
          <div style={{ fontFamily: "Georgia, serif" }} className="text-2xl font-bold tracking-wide text-white leading-none mb-1">ADRICH</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-neon-cyan font-bold leading-none">
            AGENTS AGENCY
          </div>
        </div>
      </div>

      <div className="px-5 mt-4 mb-2 kicker">Espacio de trabajo</div>
      <nav className="px-3 space-y-1">
        {NAV_ITEMS.map((item) => (
          <SidebarNavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)}
          />
        ))}
      </nav>

      {/* Perfil del usuario y Modo Claro/Oscuro en la parte inferior */}
      <div className="mt-auto px-5 py-5 border-t border-edge flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-neon-gradient grid place-items-center text-white text-sm font-bold shadow-[0_0_10px_rgba(255,153,0,0.5)]">
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
