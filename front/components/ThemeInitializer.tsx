"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { useAuthUser } from "@/hooks/useAuthUser";

export default function ThemeInitializer() {
  const { user, loading: authLoading } = useAuthUser();
  const applyStyles = (
    theme: string,
    primary: string,
    secondary: string,
    font: string,
    favicon?: string | null,
    sidebarBg?: string | null,
    pageBg?: string | null
  ) => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.setProperty("--accent-1", primary);
    document.documentElement.style.setProperty("--accent-2", secondary);
    document.documentElement.style.setProperty("--font-app", font);

    // Colores por defecto del sistema (Estilo Windows)
    const defaultSidebar = theme === "light" ? "#ffffff" : "#05050A";
    const defaultBg = theme === "light" ? "#f8fafc" : "#030308";

    // Si hay color personalizado guardado, se usa. De lo contrario, se usa el de Windows.
    const activeSidebarBg = sidebarBg && sidebarBg !== "" ? sidebarBg : defaultSidebar;
    const activePageBg = pageBg && pageBg !== "" ? pageBg : defaultBg;

    document.documentElement.style.setProperty("--sidebar", activeSidebarBg);
    document.documentElement.style.setProperty("--bg", activePageBg);

    // Cargar Google Fonts si no son del sistema
    if (font.includes("Outfit") && !document.getElementById("font-outfit")) {
      const link = document.createElement("link");
      link.id = "font-outfit";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap";
      document.head.appendChild(link);
    } else if (font.includes("Space Grotesk") && !document.getElementById("font-space")) {
      const link = document.createElement("link");
      link.id = "font-space";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap";
      document.head.appendChild(link);
    } else if (font.includes("Playfair Display") && !document.getElementById("font-playfair")) {
      const link = document.createElement("link");
      link.id = "font-playfair";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap";
      document.head.appendChild(link);
    } else if (font.includes("Inter") && !document.getElementById("font-inter")) {
      const link = document.createElement("link");
      link.id = "font-inter";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap";
      document.head.appendChild(link);
    }

    // Actualizar Favicon (modificar los existentes sin eliminarlos para evitar romper el VDOM de React)
    const activeFavicon = favicon || "/3A_sin_fondo.png";
    const existingIcons = document.querySelectorAll("link[rel*='icon']");
    if (existingIcons.length > 0) {
      existingIcons.forEach((el) => {
        (el as HTMLLinkElement).href = activeFavicon;
      });
    } else {
      const linkIcon = document.createElement("link");
      linkIcon.rel = "icon";
      linkIcon.href = activeFavicon;
      document.head.appendChild(linkIcon);
    }
  };

  useEffect(() => {
    // Limpiar localStorage si tiene los colores eléctricos para forzar el reseteo
    if (localStorage.getItem("color-primary") === "#0066ff") {
      localStorage.removeItem("color-primary");
      localStorage.removeItem("color-secondary");
    }

    // 1. Carga inicial rápida de LocalStorage
    const storedTheme = localStorage.getItem("theme") || "dark";
    const storedPrimary = localStorage.getItem("color-primary") || "#6366f1";
    const storedSecondary = localStorage.getItem("color-secondary") || "#d946ef";
    const storedFont = localStorage.getItem("font-family") || "ui-sans-serif, system-ui, -apple-system, sans-serif";
    const storedFavicon = localStorage.getItem("favicon");
    const storedSidebarBg = localStorage.getItem("color-sidebar-bg");
    const storedPageBg = localStorage.getItem("color-page-bg");

    applyStyles(
      storedTheme,
      storedPrimary,
      storedSecondary,
      storedFont,
      storedFavicon,
      storedSidebarBg,
      storedPageBg
    );

    // 2. Sincronizar cambios en tiempo real (solo localStorage, sin red — el
    // fetch al backend vive en su propio efecto más abajo, gateado a sesión lista).
    const handleConfigUpdate = () => {
      const theme = localStorage.getItem("theme") || "dark";
      const primary = localStorage.getItem("color-primary") || "#6366f1";
      const secondary = localStorage.getItem("color-secondary") || "#d946ef";
      const font = localStorage.getItem("font-family") || "ui-sans-serif, system-ui, -apple-system, sans-serif";
      const favicon = localStorage.getItem("favicon");
      const sidebarBg = localStorage.getItem("color-sidebar-bg");
      const pageBg = localStorage.getItem("color-page-bg");

      applyStyles(theme, primary, secondary, font, favicon, sidebarBg, pageBg);
    };

    window.addEventListener("config-updated", handleConfigUpdate);
    return () => {
      window.removeEventListener("config-updated", handleConfigUpdate);
    };
  }, []);

  useEffect(() => {
    // Gate en sesión lista (aa-dashboard-agents-nav-widgets T2.1): este fetch
    // de montaje corría antes de que la sesión de Supabase hidratase → 401 sin
    // token → el interceptor global desloguea a un usuario recién logueado.
    // Esperar a que useAuthUser resuelva (loading=false) y haya user.
    if (authLoading || !user) return;

    // Sincronizar con el backend (DB es la fuente autoritativa).
    api("/api/config")
      .then((config) => {
        if (config) {
          const { theme, primaryColor, secondaryColor, fontFamily, favicon, sidebarLogo, sidebarBg, pageBg } = config;

          localStorage.setItem("theme", theme);
          localStorage.setItem("color-primary", primaryColor);
          localStorage.setItem("color-secondary", secondaryColor);
          localStorage.setItem("font-family", fontFamily);
          // Precedencia favicon: localStorage (instantáneo) > DB (autoritativo) > default.
          // Si la DB trae favicon, actualiza localStorage; si NO trae, se conserva el
          // valor local previo (antes se hacía removeItem y el favicon configurado se
          // perdía en cada nueva sesión/pestaña).
          if (favicon) localStorage.setItem("favicon", favicon);
          const effectiveFavicon = favicon || localStorage.getItem("favicon");
          if (sidebarLogo) localStorage.setItem("sidebar-logo", sidebarLogo);
          else localStorage.removeItem("sidebar-logo");
          if (sidebarBg) localStorage.setItem("color-sidebar-bg", sidebarBg);
          else localStorage.removeItem("color-sidebar-bg");
          if (pageBg) localStorage.setItem("color-page-bg", pageBg);
          else localStorage.removeItem("color-page-bg");

          applyStyles(theme, primaryColor, secondaryColor, fontFamily, effectiveFavicon, sidebarBg, pageBg);

          // Notificar que se ha actualizado la configuración
          window.dispatchEvent(new Event("config-updated"));
        }
      })
      .catch(() => {});
  }, [authLoading, user]);

  return null;
}
