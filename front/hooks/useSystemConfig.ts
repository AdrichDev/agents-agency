"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Respuesta de GET /api/config (SystemConfig sin el secreto + flags derivados). */
export interface SystemConfigResponse {
  theme?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  fontFamily?: string | null;
  favicon?: string | null;
  sidebarLogo?: string | null;
  sidebarBg?: string | null;
  pageBg?: string | null;
  defaultAgentModel?: string | null;
  reasoningEffort?: string | null;
  googleClientId?: string | null;
  googleConfigured?: boolean;
  googleRedirectUri?: string | null;
}

/** Campos editables del formulario de configuración. */
interface ConfigSnapshotInput {
  theme: string;
  primary: string;
  secondary: string;
  font: string;
  favicon: string;
  sidebarLogo: string;
  sidebarBg: string;
  pageBg: string;
  defaultAgentModel: string;
  reasoningEffort: string;
  googleClientId: string;
  googleClientSecret: string;
}

/**
 * Snapshot estable de los campos editables. Array (orden fijo) → la igualdad de
 * strings detecta "dirty" sin depender del orden de claves de un objeto.
 */
function configSnapshot(v: ConfigSnapshotInput): string {
  return JSON.stringify([
    v.theme, v.primary, v.secondary, v.font, v.favicon, v.sidebarLogo,
    v.sidebarBg, v.pageBg, v.defaultAgentModel, v.reasoningEffort,
    v.googleClientId, v.googleClientSecret,
  ]);
}

/**
 * Carga, estado, "dirty" y guardado de la configuración del entorno. Replica el
 * comportamiento previo de la página: carga remota con fallback a localStorage,
 * persistencia en DB + localStorage, aplicación en caliente al DOM (CSS vars,
 * Google Fonts, favicon) y evento `config-updated`.
 */
export function useSystemConfig() {
  const [theme, setTheme] = useState("dark");
  const [primary, setPrimary] = useState("#6366f1");
  const [secondary, setSecondary] = useState("#d946ef");
  const [font, setFont] = useState("ui-sans-serif, system-ui, -apple-system, sans-serif");
  const [favicon, setFavicon] = useState("");
  const [sidebarLogo, setSidebarLogo] = useState("");
  const [sidebarBg, setSidebarBg] = useState("");
  const [pageBg, setPageBg] = useState("");
  const [defaultAgentModel, setDefaultAgentModel] = useState("gpt-5.4-mini");
  const [reasoningEffort, setReasoningEffort] = useState("low");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [googleRedirectUri, setGoogleRedirectUri] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  // Baseline de lo último cargado/guardado. dirty = hay cambios sin guardar.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  // Cargar configuraciones iniciales
  useEffect(() => {
    api<SystemConfigResponse>("/api/config")
      .then((config) => {
        if (config) {
          const loaded = {
            theme: config.theme ?? "dark",
            primary: config.primaryColor ?? "#6366f1",
            secondary: config.secondaryColor ?? "#d946ef",
            font: config.fontFamily ?? "ui-sans-serif, system-ui, -apple-system, sans-serif",
            favicon: config.favicon || "",
            sidebarLogo: config.sidebarLogo || "",
            sidebarBg: config.sidebarBg || "",
            pageBg: config.pageBg || "",
            defaultAgentModel: config.defaultAgentModel || "gpt-5.4-mini",
            reasoningEffort: config.reasoningEffort || "low",
            googleClientId: config.googleClientId || "",
          };
          setTheme(loaded.theme);
          setPrimary(loaded.primary);
          setSecondary(loaded.secondary);
          setFont(loaded.font);
          setFavicon(loaded.favicon);
          setSidebarLogo(loaded.sidebarLogo);
          setSidebarBg(loaded.sidebarBg);
          setPageBg(loaded.pageBg);
          setDefaultAgentModel(loaded.defaultAgentModel);
          setReasoningEffort(loaded.reasoningEffort);
          setGoogleClientId(loaded.googleClientId);
          setGoogleConfigured(!!config.googleConfigured);
          if (config.googleRedirectUri) setGoogleRedirectUri(config.googleRedirectUri);
          setSavedSnapshot(configSnapshot({ ...loaded, googleClientSecret: "" }));
        }
      })
      .catch(() => {
        // Fallback local en caso de error
        const loaded = {
          theme: localStorage.getItem("theme") || "dark",
          primary: localStorage.getItem("color-primary") || "#6366f1",
          secondary: localStorage.getItem("color-secondary") || "#d946ef",
          font: localStorage.getItem("font-family") || "ui-sans-serif, system-ui, -apple-system, sans-serif",
          favicon: localStorage.getItem("favicon") || "",
          sidebarLogo: localStorage.getItem("sidebar-logo") || "",
          sidebarBg: localStorage.getItem("color-sidebar-bg") || "",
          pageBg: localStorage.getItem("color-page-bg") || "",
          defaultAgentModel: "gpt-5.4-mini",
          reasoningEffort: "low",
          googleClientId: "",
        };
        setTheme(loaded.theme);
        setPrimary(loaded.primary);
        setSecondary(loaded.secondary);
        setFont(loaded.font);
        setFavicon(loaded.favicon);
        setSidebarLogo(loaded.sidebarLogo);
        setSidebarBg(loaded.sidebarBg);
        setPageBg(loaded.pageBg);
        setSavedSnapshot(configSnapshot({ ...loaded, googleClientSecret: "" }));
      });
  }, []);

  // Estado "dirty": el snapshot actual difiere del último guardado/cargado.
  const currentSnapshot = configSnapshot({
    theme, primary, secondary, font, favicon, sidebarLogo, sidebarBg, pageBg,
    defaultAgentModel, reasoningEffort, googleClientId, googleClientSecret,
  });
  const dirty = savedSnapshot !== null && currentSnapshot !== savedSnapshot;

  const resetBackgrounds = () => {
    setSidebarBg("");
    setPageBg("");
  };

  const saveSettings = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      await api("/api/config", {
        method: "POST",
        body: JSON.stringify({
          theme,
          primaryColor: primary,
          secondaryColor: secondary,
          fontFamily: font,
          favicon,
          sidebarLogo,
          sidebarBg,
          pageBg,
          defaultAgentModel,
          reasoningEffort,
          googleClientId,
          ...(googleClientSecret ? { googleClientSecret } : {}),
        }),
      });
      if (googleClientSecret) { setGoogleClientSecret(""); setGoogleConfigured(true); }

      // Guardar en localStorage
      localStorage.setItem("theme", theme);
      localStorage.setItem("color-primary", primary);
      localStorage.setItem("color-secondary", secondary);
      localStorage.setItem("font-family", font);
      if (favicon) localStorage.setItem("favicon", favicon);
      else localStorage.removeItem("favicon");
      if (sidebarLogo) localStorage.setItem("sidebar-logo", sidebarLogo);
      else localStorage.removeItem("sidebar-logo");

      if (sidebarBg) localStorage.setItem("color-sidebar-bg", sidebarBg);
      else localStorage.removeItem("color-sidebar-bg");
      if (pageBg) localStorage.setItem("color-page-bg", pageBg);
      else localStorage.removeItem("color-page-bg");

      // Limpiar claves obsoletas
      localStorage.removeItem("color-sidebar-bg-light");
      localStorage.removeItem("color-page-bg-light");

      // Aplicar al DOM
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.setProperty("--accent-1", primary);
      document.documentElement.style.setProperty("--accent-2", secondary);
      document.documentElement.style.setProperty("--font-app", font);

      const defaultSidebar = theme === "light" ? "#ffffff" : "#05050A";
      const defaultBg = theme === "light" ? "#f8fafc" : "#030308";

      const activeSidebarBg = sidebarBg && sidebarBg !== "" ? sidebarBg : defaultSidebar;
      const activePageBg = pageBg && pageBg !== "" ? pageBg : defaultBg;

      document.documentElement.style.setProperty("--sidebar", activeSidebarBg);
      document.documentElement.style.setProperty("--bg", activePageBg);

      // Cargar dinámicamente las Google Fonts en tiempo real
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

      // Actualizar favicon en la pestaña
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

      // Disparar evento para componentes en tiempo real
      window.dispatchEvent(new Event("config-updated"));

      // Nuevo baseline → el botón vuelve a "desactivado" (sin cambios pendientes).
      setSavedSnapshot(configSnapshot({
        theme, primary, secondary, font, favicon, sidebarLogo, sidebarBg, pageBg,
        defaultAgentModel, reasoningEffort, googleClientId, googleClientSecret: "",
      }));

      setStatus("Configuración guardada correctamente.");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setStatus("Error de red al guardar la configuración.");
      setTimeout(() => setStatus(""), 3000);
    } finally {
      setSaving(false);
    }
  };

  return {
    theme, setTheme,
    primary, setPrimary,
    secondary, setSecondary,
    font, setFont,
    favicon, setFavicon,
    sidebarLogo, setSidebarLogo,
    sidebarBg, setSidebarBg,
    pageBg, setPageBg,
    defaultAgentModel, setDefaultAgentModel,
    reasoningEffort, setReasoningEffort,
    googleClientId, setGoogleClientId,
    googleClientSecret, setGoogleClientSecret,
    googleConfigured,
    googleRedirectUri,
    status,
    saving,
    dirty,
    resetBackgrounds,
    saveSettings,
  };
}
