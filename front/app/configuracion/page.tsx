"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const PRIMARY_PRESETS = [
  { name: "Índigo", value: "#6366f1" },
  { name: "Fucsia", value: "#d946ef" },
  { name: "Esmeralda", value: "#10b981" },
  { name: "Carmesí", value: "#f43f5e" },
];

const SECONDARY_PRESETS = [
  { name: "Fucsia", value: "#d946ef" },
  { name: "Cian", value: "#06b6d4" },
  { name: "Ámbar", value: "#f59e0b" },
  { name: "Rosa", value: "#f43f5e" },
];

const FONTS_PRESETS = [
  { name: "System (Por defecto)", value: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  { name: "Inter (Limpia)", value: '"Inter", sans-serif' },
  { name: "Outfit (Moderna)", value: '"Outfit", sans-serif' },
  { name: "Space Grotesk (Tech)", value: '"Space Grotesk", sans-serif' },
  { name: "Playfair Display (Serif/Elegante)", value: '"Playfair Display", serif' },
  { name: "Calibri (Word)", value: 'Calibri, Candara, Segoe, "Segoe UI", Optima, Arial, sans-serif' },
  { name: "Arial (Word)", value: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  { name: "Times New Roman (Word)", value: '"Times New Roman", Times, Baskerville, Georgia, serif' },
  { name: "Georgia (Word)", value: 'Georgia, yuton, "Times New Roman", Times, serif' },
  { name: "Garamond (Word)", value: 'Garamond, "Baskerville Old Face", "Hoefler Text", "Times New Roman", serif' },
];

export default function Configuration() {
  const [theme, setTheme] = useState("dark");
  const [primary, setPrimary] = useState("#6366f1");
  const [secondary, setSecondary] = useState("#d946ef");
  const [font, setFont] = useState("ui-sans-serif, system-ui, -apple-system, sans-serif");
  const [favicon, setFavicon] = useState("");
  const [sidebarLogo, setSidebarLogo] = useState("");
  const [sidebarBg, setSidebarBg] = useState("");
  const [pageBg, setPageBg] = useState("");
  const [status, setStatus] = useState("");

  // Cargar configuraciones iniciales
  useEffect(() => {
    api("/api/config")
      .then((config) => {
        if (config) {
          setTheme(config.theme);
          setPrimary(config.primaryColor);
          setSecondary(config.secondaryColor);
          setFont(config.fontFamily);
          setFavicon(config.favicon || "");
          setSidebarLogo(config.sidebarLogo || "");
          setSidebarBg(config.sidebarBg || "");
          setPageBg(config.pageBg || "");
        }
      })
      .catch(() => {
        // Fallback local en caso de error
        setTheme(localStorage.getItem("theme") || "dark");
        setPrimary(localStorage.getItem("color-primary") || "#6366f1");
        setSecondary(localStorage.getItem("color-secondary") || "#d946ef");
        setFont(localStorage.getItem("font-family") || "ui-sans-serif, system-ui, -apple-system, sans-serif");
        setFavicon(localStorage.getItem("favicon") || "");
        setSidebarLogo(localStorage.getItem("sidebar-logo") || "");
        setSidebarBg(localStorage.getItem("color-sidebar-bg") || "");
        setPageBg(localStorage.getItem("color-page-bg") || "");
      });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setter(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const resetBackgrounds = () => {
    setSidebarBg("");
    setPageBg("");
  };

  const saveSettings = async () => {
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
        }),
      });

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
      const existingIcons = document.querySelectorAll("link[rel*='icon']");
      if (existingIcons.length > 0) {
        existingIcons.forEach((el) => {
          (el as HTMLLinkElement).href = favicon || "/3A_Logo.png";
        });
      } else {
        const linkIcon = document.createElement("link");
        linkIcon.rel = "icon";
        linkIcon.href = favicon || "/3A_Logo.png";
        document.head.appendChild(linkIcon);
      }

      // Disparar evento para componentes en tiempo real
      window.dispatchEvent(new Event("config-updated"));

      setStatus("Configuración guardada correctamente.");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setStatus("Error de red al guardar la configuración.");
      setTimeout(() => setStatus(""), 3000);
    }
  };

  return (
    <div className="max-w-5xl w-full">
      <div className="mb-8">
        <div className="kicker mb-2">Panel</div>
        <h1 className="text-3xl font-extrabold text-white">Configuración del Entorno</h1>
        <p className="text-sm text-slate-500 mt-1">
          Ajusta los colores de marca, tipografías globales y el tema de ADRICH.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-6 items-start">
        {/* Formulario de Configuración */}
        <div className="card p-6 space-y-6">
          {/* Color Primario */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">Color Primario</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <select
                className="input-dark cursor-pointer"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
              >
                {PRIMARY_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.name}</option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="w-10 h-10 border border-edge rounded-lg cursor-pointer bg-transparent"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                />
                <span className="text-xs font-mono text-slate-400 uppercase">{primary}</span>
              </div>
            </div>
          </div>

          {/* Color Secundario */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">Color Secundario</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <select
                className="input-dark cursor-pointer"
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
              >
                {SECONDARY_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.name}</option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="w-10 h-10 border border-edge rounded-lg cursor-pointer bg-transparent"
                  value={secondary}
                  onChange={(e) => setSecondary(e.target.value)}
                />
                <span className="text-xs font-mono text-slate-400 uppercase">{secondary}</span>
              </div>
            </div>
          </div>

          {/* Tipo de Letra / Fuentes */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">Tipografía Global</h3>
            <select
              className="input-dark cursor-pointer"
              value={font}
              onChange={(e) => setFont(e.target.value)}
            >
              {FONTS_PRESETS.map((f) => (
                <option key={f.value} value={f.value}>{f.name}</option>
              ))}
            </select>
          </div>

          {/* Identidad de Marca: Favicon y Sidebar Logo */}
          <div className="border-t border-edge pt-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Identidad de Marca</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Selector de Favicon */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400">Favicon de la Web</label>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 flex items-center justify-center shrink-0">
                    {favicon && <img src={favicon} alt="Favicon" className="w-6 h-6 object-contain" />}
                  </div>
                  <div className="flex-1 space-y-1">
                    <input
                      type="file"
                      accept=".ico,.png,.jpg,.jpeg,.svg"
                      onChange={(e) => handleFileChange(e, setFavicon)}
                      className="hidden"
                      id="favicon-upload"
                    />
                    <label htmlFor="favicon-upload" className="btn-dark cursor-pointer text-center block py-1.5 px-3 text-[11px] font-bold">
                      Subir archivo
                    </label>
                    {favicon && (
                      <button
                        type="button"
                        onClick={() => setFavicon("")}
                        className="text-[10px] text-rose-400 hover:underline block"
                      >
                        Restablecer
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Selector de Logotipo Sidebar */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400">Logotipo del Sidebar</label>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 flex items-center justify-center shrink-0">
                    {sidebarLogo && <img src={sidebarLogo} alt="Sidebar Logo" className="w-8 h-8 object-contain" />}
                  </div>
                  <div className="flex-1 space-y-1">
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.svg"
                      onChange={(e) => handleFileChange(e, setSidebarLogo)}
                      className="hidden"
                      id="sidebar-logo-upload"
                    />
                    <label htmlFor="sidebar-logo-upload" className="btn-dark cursor-pointer text-center block py-1.5 px-3 text-[11px] font-bold">
                      Subir archivo
                    </label>
                    {sidebarLogo && (
                      <button
                        type="button"
                        onClick={() => setSidebarLogo("")}
                        className="text-[10px] text-rose-400 hover:underline block"
                      >
                        Restablecer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>



          {/* Estado y Guardar */}
          <div className="pt-4 border-t border-edge flex items-center justify-between flex-wrap gap-4">
            {status ? (
              <p className="text-sm text-emerald-400 font-semibold">{status}</p>
            ) : (
              <p className="text-xs text-slate-500">Los cambios se guardan centralizados en la Base de Datos.</p>
            )}
            <button onClick={saveSettings} className="btn-grad">
              💾 Guardar Cambios
            </button>
          </div>
        </div>

        {/* Live Preview Panel */}
        <div className="card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-2">Vista Previa</h3>
          
          <div className="space-y-4 p-4 rounded-xl bg-ink/40 border border-edge">
            <div>
              <p className="text-xs text-slate-500 font-semibold mb-1">Gradiente Botón</p>
              <button
                type="button"
                className="w-full font-semibold rounded-lg px-4 py-2 text-xs text-white transition"
                style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}
              >
                Botón de ejemplo
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-500 font-semibold mb-1">Color de Selección</p>
              <div className="flex gap-2">
                <span className="w-5 h-5 rounded-full" style={{ backgroundColor: primary }} title="Primario" />
                <span className="w-5 h-5 rounded-full" style={{ backgroundColor: secondary }} title="Secundario" />
              </div>
            </div>

            <div>
              <p className="text-xs text-slate-500 font-semibold mb-1">Muestra de Letra</p>
              <p className="text-sm font-medium text-white truncate" style={{ fontFamily: font }}>
                La rapidez de ADRICH
              </p>
              <p className="text-xs text-slate-400 leading-tight mt-0.5" style={{ fontFamily: font }}>
                Agentes autónomos de IA y webs automáticas.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
