"use client";

import { useEffect, useState } from "react";

const PRIMARY_PRESETS = [
  { name: "Índigo (Por defecto)", value: "#6366f1" },
  { name: "Fucsia", value: "#d946ef" },
  { name: "Esmeralda", value: "#10b981" },
  { name: "Violeta", value: "#8b5cf6" },
  { name: "Carmesí", value: "#f43f5e" },
];

const SECONDARY_PRESETS = [
  { name: "Fucsia (Por defecto)", value: "#d946ef" },
  { name: "Cian", value: "#06b6d4" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Ámbar", value: "#f59e0b" },
  { name: "Rosa", value: "#f43f5e" },
];

const FONTS_PRESETS = [
  { name: "System (Por defecto)", value: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  { name: "Inter (Limpia)", value: '"Inter", sans-serif' },
  { name: "Outfit (Moderna)", value: '"Outfit", sans-serif' },
  { name: "Space Grotesk (Tech)", value: '"Space Grotesk", sans-serif' },
  { name: "Playfair Display (Serif/Elegante)", value: '"Playfair Display", serif' },
];

export default function Configuration() {
  const [theme, setTheme] = useState("dark");
  const [primary, setPrimary] = useState("#6366f1");
  const [secondary, setSecondary] = useState("#d946ef");
  const [font, setFont] = useState("ui-sans-serif, system-ui, -apple-system, sans-serif");
  const [status, setStatus] = useState("");

  // Cargar configuraciones iniciales
  useEffect(() => {
    const t = localStorage.getItem("theme") || "dark";
    const p = localStorage.getItem("color-primary") || "#6366f1";
    const s = localStorage.getItem("color-secondary") || "#d946ef";
    const f = localStorage.getItem("font-family") || "ui-sans-serif, system-ui, -apple-system, sans-serif";

    setTheme(t);
    setPrimary(p);
    setSecondary(s);
    setFont(f);
  }, []);

  const saveSettings = () => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("color-primary", primary);
    localStorage.setItem("color-secondary", secondary);
    localStorage.setItem("font-family", font);

    // Aplicar al DOM
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.setProperty("--accent-1", primary);
    document.documentElement.style.setProperty("--accent-2", secondary);
    document.documentElement.style.setProperty("--font-app", font);

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

    setStatus("Configuración guardada y aplicada correctamente.");
    setTimeout(() => setStatus(""), 3000);
  };

  return (
    <div className="max-w-3xl">
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
          {/* Selector de Tema */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">Tema de la Interfaz</h3>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={`flex-1 py-3 px-4 rounded-xl border text-sm font-bold transition flex items-center justify-center gap-2 ${
                  theme === "dark"
                    ? "bg-indigo-500/10 border-indigo-500 text-indigo-300"
                    : "border-edge bg-white/[0.02] text-slate-400 hover:text-white"
                }`}
              >
                🌙 Tema Oscuro
              </button>
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={`flex-1 py-3 px-4 rounded-xl border text-sm font-bold transition flex items-center justify-center gap-2 ${
                  theme === "light"
                    ? "bg-indigo-500/10 border-indigo-500 text-indigo-500"
                    : "border-edge bg-white/[0.02] text-slate-400 hover:text-white"
                }`}
              >
                ☀️ Tema Claro
              </button>
            </div>
          </div>

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

          {/* Estado y Guardar */}
          <div className="pt-4 border-t border-edge flex items-center justify-between flex-wrap gap-4">
            {status ? (
              <p className="text-sm text-emerald-400 font-semibold">{status}</p>
            ) : (
              <p className="text-xs text-slate-500">Los cambios se aplican y guardan en el navegador.</p>
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
