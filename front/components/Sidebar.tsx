"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import SidebarNavItem from "@/components/SidebarNavItem";
import { NAV_ITEMS } from "@/lib/navigation";

export default function Sidebar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const storedTheme = localStorage.getItem("theme") || "dark";
    setTheme(storedTheme);
    document.documentElement.setAttribute("data-theme", storedTheme);
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
