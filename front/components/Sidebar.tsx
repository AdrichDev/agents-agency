"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SidebarNavItem from "@/components/SidebarNavItem";
import { NAV_GROUPS, NAV_TITLE } from "@/lib/navigation";
import { useAuthUser } from "@/hooks/useAuthUser";
import { api } from "@/lib/api";
import { CONTACTS_UPDATED_EVENT } from "@/components/contactos/contactTypes";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthUser();
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [logoDark, setLogoDark] = useState("/3A_sin_fondo.png");
  const [logoLight, setLogoLight] = useState("/3A_sin_fondo.png");
  const [collapsed, setCollapsed] = useState(false);
  const [pendingContacts, setPendingContacts] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Contador de contactos pendientes (contactado != "si"); se refresca al
  // navegar Y cuando la página de contactos avisa de un cambio (marcar como
  // contactado, alta, baja) sin salir de /contactos — antes solo refetch en
  // pathname, así que el badge quedaba con el conteo viejo (parecía mostrar
  // el total) mientras el usuario seguía marcando contactos en la misma
  // página (aa-badge-contactos-pendientes-stale).
  useEffect(() => {
    let cancelled = false;
    const fetchPendingCount = () => {
      api<{ count?: number }>("/api/contacts/pending-count")
        .then((data) => {
          if (!cancelled) {
            setPendingContacts(typeof data?.count === "number" ? data.count : 0);
          }
        })
        .catch(() => {});
    };
    fetchPendingCount();
    window.addEventListener(CONTACTS_UPDATED_EVENT, fetchPendingCount);
    return () => {
      cancelled = true;
      window.removeEventListener(CONTACTS_UPDATED_EVENT, fetchPendingCount);
    };
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    setMounted(true);
    const storedTheme = localStorage.getItem("theme") || "dark";
    setTheme(storedTheme);
    document.documentElement.setAttribute("data-theme", storedTheme);
    setCollapsed(localStorage.getItem("sidebar-collapsed") === "true");

    const DEFAULT_LOGO = "/3A_sin_fondo.png";
    const updateLogos = () => {
      // Logo oscuro: el guardado en localStorage o el default
      const stored = localStorage.getItem("sidebar-logo");
      setLogoDark(stored || DEFAULT_LOGO);
      // Logo claro: versión alternativa si existe, o el mismo
      const storedLight = localStorage.getItem("sidebar-logo-light");
      setLogoLight(storedLight || stored || DEFAULT_LOGO);
      // Tema
      const t = localStorage.getItem("theme") || "dark";
      setTheme(t);
    };
    updateLogos();

    // DB es la fuente autoritativa: el logo guardado sobrevive a limpiar el
    // localStorage (p.ej. tras cerrar sesión / cambiar de equipo). Si la config
    // trae un sidebarLogo, lo cacheamos en localStorage y lo aplicamos.
    api<{ sidebarLogo?: string }>("/api/config")
      .then((cfg) => {
        if (cfg?.sidebarLogo) {
          localStorage.setItem("sidebar-logo", cfg.sidebarLogo);
          setLogoDark(cfg.sidebarLogo);
          setLogoLight(localStorage.getItem("sidebar-logo-light") || cfg.sidebarLogo);
        }
      })
      .catch(() => {});

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

  const SettingsIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
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
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );

  return (
    <aside
      className={`${w} shrink-0 h-screen border-r border-edge flex flex-col no-print transition-[width] duration-200 overflow-hidden relative`}
      style={{
        background:
          theme === "dark"
            ? "linear-gradient(180deg, #0c0c14 0%, var(--sidebar) 40%, #07070f 100%)"
            : "linear-gradient(180deg, #f0f4ff 0%, var(--sidebar) 40%, #e8eef8 100%)",
      }}
    >
      {/* Header: logo + nombre (proporciones alineadas con creador_CRM) */}
      <div
        className={`shrink-0 px-3 flex items-center gap-3 ${
          collapsed ? "justify-center pt-16 pb-3" : "pt-4 pb-2 px-5"
        }`}
      >
        <div
          className={`flex items-center justify-center shrink-0 transition-all duration-200 h-10 w-10 ${mounted ? "opacity-100" : "opacity-0"}`}
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
              style={{ fontFamily: "Georgia, serif", fontVariantNumeric: "lining-nums" }}
              className="text-sm font-semibold tracking-wide text-white leading-tight truncate"
            >
              {/* Marca fija; el título de navegación (NAV_TITLE) se renderiza debajo */}
              3A Estudio
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-neon-cyan font-bold leading-tight whitespace-nowrap">
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

      {!collapsed && (
        <div
          style={{ fontFamily: "Georgia, serif" }}
          className="shrink-0 px-5 pt-3 pb-2 text-sm font-bold text-neon-cyan tracking-wide leading-tight"
        >
          {NAV_TITLE}
        </div>
      )}

      {/* Nav agrupada por dominio funcional (aa-navegacion-lateral-agrupada); sin scroll, encaja siempre en viewport */}
      <nav
        className={`flex-1 min-h-0 ${collapsed ? "px-2 mt-2" : "px-3 mt-2"} space-y-3`}
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.id}>
            {!collapsed && (
              <div
                data-testid="sidebar-section-title"
                className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 leading-tight"
              >
                {group.label}
              </div>
            )}
            <div>
              {group.items.map((item) => (
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
                  badge={item.href === "/contactos" ? pendingContacts : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div
        className={`shrink-0 py-2 border-t border-edge flex items-center ${
          collapsed ? "justify-center px-0" : "justify-between gap-3 px-5"
        }`}
      >
        <div
          className={`flex items-center ${
            collapsed ? "flex-col justify-center gap-2" : "gap-3 min-w-0"
          }`}
        >
          {!collapsed && (
            <div className="w-9 h-9 rounded-full bg-accent-gradient grid place-items-center text-white text-sm font-bold shadow-[0_0_10px_rgba(99,102,241,0.5)] shrink-0">
              {initials}
            </div>
          )}
          {!collapsed && (
            <div className="leading-tight min-w-0">
              <div className="text-sm font-semibold text-white truncate">
                {user ? firstName : "Invitado"}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-blue-400 truncate">
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
          <div ref={menuRef} className="relative flex items-center gap-2 shrink-0">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 transition border border-edge text-slate-400 hover:text-white grid place-items-center"
              title="Cuenta"
              aria-label="Cuenta"
              aria-expanded={menuOpen}
            >
              <SettingsIcon />
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

            {menuOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-56 rounded-xl border border-edge bg-ink shadow-xl z-20 overflow-hidden">
                <div className="px-3 py-2 border-b border-edge">
                  <p className="text-[11px] text-slate-500 truncate">
                    {user?.email ?? "sin sesi\u00F3n"}
                  </p>
                </div>
                <div className="py-1 px-1">
                  <Link
                    href="/configuracion"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-white/5 hover:text-white transition"
                  >
                    <span className="text-base">⚙️</span> Configuración
                  </Link>
                  <Link
                    href="/cuenta"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-white/5 hover:text-white transition"
                  >
                    <span className="text-base">👤</span> Mi Cuenta
                  </Link>
                </div>
                <div className="border-t border-edge py-1 px-1">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition w-full text-left"
                  >
                    <LogoutIcon className="w-4 h-4" /> Cerrar sesión
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
