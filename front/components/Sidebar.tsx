"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SidebarNavItem from "@/components/SidebarNavItem";
import { NAV_ITEMS } from "@/lib/navigation";
import { useAuthUser } from "@/hooks/useAuthUser";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthUser();
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [logoDark, setLogoDark] = useState("/3A_Logo.png");
  const [logoLight, setLogoLight] = useState("/3A_Logo.png");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setMounted(true);
    const storedTheme = localStorage.getItem("theme") || "dark";
    setTheme(storedTheme);
    document.documentElement.setAttribute("data-theme", storedTheme);
    setCollapsed(localStorage.getItem("sidebar-collapsed") === "true");

    const updateLogos = () => {
      // Logo oscuro: el guardado por defecto
      const stored = localStorage.getItem("sidebar-logo");
      setLogoDark(stored || "/3A_Logo.png");
      // Logo claro: versiÃ³n alternativa si existe, o el mismo
      const storedLight = localStorage.getItem("sidebar-logo-light");
      setLogoLight(storedLight || stored || "/3A_Logo.png");
      // Tema
      const t = localStorage.getItem("theme") || "dark";
      setTheme(t);
    };
    updateLogos();

    window.addEventListener("config-updated", updateLogos);
    return () => {
      window.removeEventListener("config-updated", updateLogos);
    };
  }, []);

  const toggleTheme = () => {
    const existingOverlays = document.querySelectorAll(".theme-overlay");
    existingOverlays.forEach((el) => el.remove());

    const nextTheme = theme === "dark" ? "light" : "dark";

    const storedBg = localStorage.getItem("color-page-bg");
    const defaultBg = theme === "dark" ? "#030308" : "#f8fafc";
    const currentBg = storedBg && storedBg !== "" ? storedBg : defaultBg;

    const overlay = document.createElement("div");
    overlay.className = "theme-overlay";
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:99999;pointer-events:none;
      background:${currentBg};clip-path:circle(150% at 0% 100%);
      transition:clip-path 0.2s cubic-bezier(0.4,0,0.2,1);
    `;
    document.body.appendChild(overlay);
    overlay.offsetHeight;

    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    window.dispatchEvent(new Event("config-updated"));

    overlay.style.clipPath = "circle(0% at 0% 100%)";
    setTimeout(() => overlay.remove(), 200);
  };

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
  };

  const activeLogo = theme === "light" ? logoLight : logoDark;
  const w = collapsed ? "w-[68px]" : "w-60";
  const firstName = user?.firstName?.trim().split(/\s+/)[0] ?? "";
  const firstLastName = user?.lastName?.trim().split(/\s+/)[0] ?? "";
  const initials =
    `${firstName[0] ?? ""}${firstLastName[0] ?? ""}`.toUpperCase() || "?";

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  const LogoutIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M14 3h5v18h-5" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  );

  return (
    <aside
      className={`${w} shrink-0 min-h-screen border-r border-edge flex flex-col no-print transition-[width] duration-200 overflow-hidden relative`}
      style={{
        background:
          theme === "dark"
            ? "linear-gradient(180deg, #0c0c14 0%, var(--sidebar) 40%, #07070f 100%)"
            : "linear-gradient(180deg, #f0f4ff 0%, var(--sidebar) 40%, #e8eef8 100%)",
      }}
    >
      {/* Header: logo + nombre */}
      <div
        className={`px-3 flex items-center gap-3 ${
          collapsed ? "justify-center pt-16 pb-3" : "py-5"
        }`}
      >
        <div
          className={`flex items-center justify-center shrink-0 overflow-hidden transition-all duration-200 ${mounted ? "opacity-100" : "opacity-0"} ${collapsed ? "h-10 w-10" : "h-14"}`}
        >
          {activeLogo && (
            <img
              src={activeLogo}
              alt="ADRICH"
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>
        {!collapsed && (
          <div className="flex flex-col justify-center min-w-0">
            <div
              style={{ fontFamily: "Georgia, serif" }}
              className="text-lg font-bold tracking-wide text-white leading-none mb-1 truncate"
            >
              ADRICH
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-neon-cyan font-bold leading-none whitespace-nowrap">
              AGENTS AGENCY
            </div>
          </div>
        )}
      </div>

      {/* BotÃ³n de colapso */}
      <button
        onClick={toggleCollapse}
        title={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
        className="absolute top-4 right-0 w-8 h-8 rounded-l-lg bg-white/5 hover:bg-white/10 border border-edge text-neon-cyan transition flex items-center justify-center text-base font-bold z-10"
      >
        {collapsed ? ">" : "<"}
      </button>

      {/* Nav */}
      {!collapsed && (
        <div className="px-5 mt-3 mb-2 kicker">Espacio de trabajo</div>
      )}
      <nav className={`${collapsed ? "px-2 mt-4" : "px-3 mt-0"} space-y-1`}>
        {NAV_ITEMS.map((item) => (
          <SidebarNavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={
              (item.href as string) === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href)
            }
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Footer */}
      <div
        className={`mt-auto py-4 border-t border-edge flex items-center ${
          collapsed ? "justify-center px-0" : "justify-between gap-3 px-5"
        }`}
      >
        <div
          className={`flex items-center ${
            collapsed ? "flex-col justify-center gap-2" : "gap-3 min-w-0"
          }`}
        >
          {!collapsed && (
            <div className="w-9 h-9 rounded-full bg-neon-gradient grid place-items-center text-white text-sm font-bold shadow-[0_0_10px_rgba(255,153,0,0.5)] shrink-0">
              {initials}
            </div>
          )}
          {!collapsed && (
            <div className="leading-tight text-center min-w-0">
              <div className="text-sm font-semibold text-white truncate">
                {user ? firstName : "Invitado"}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 truncate">
                {user ? user.role : "sin sesión"}
              </div>
            </div>
          )}

          {collapsed && (
            <>
              <button
                onClick={handleLogout}
                className="w-9 h-9 rounded-xl bg-transparent border border-red-500/70 text-red-400 hover:bg-red-500/15 hover:text-red-300 transition grid place-items-center shrink-0"
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
              >
                <LogoutIcon />
              </button>
              <button
                onClick={toggleTheme}
                className={`w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 transition border border-edge grid place-items-center text-sm shrink-0 ${
                  theme === "dark"
                    ? "text-yellow-400"
                    : "text-blue-400 hover:text-blue-300 hover:bg-blue-500/15"
                }`}
                title={theme === "dark" ? "Modo Claro" : "Modo Oscuro"}
              >
                {theme === "dark" ? "\u2600" : "\u263E"}
              </button>
            </>
          )}
        </div>

        {!collapsed && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleLogout}
              className="w-9 h-9 rounded-xl bg-transparent border border-red-500/70 text-red-400 hover:bg-red-500/15 hover:text-red-300 transition grid place-items-center"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <LogoutIcon />
            </button>
            <button
              onClick={toggleTheme}
              className={`w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 transition border border-edge grid place-items-center text-sm shrink-0 ${
                theme === "dark"
                  ? "text-yellow-400"
                  : "text-blue-400 hover:text-blue-300 hover:bg-blue-500/15"
              }`}
              title={theme === "dark" ? "Modo Claro" : "Modo Oscuro"}
            >
              {theme === "dark" ? "\u2600" : "\u263E"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
