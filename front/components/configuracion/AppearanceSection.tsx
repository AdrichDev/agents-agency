"use client";

const PRIMARY_PRESETS = [
  { name: "Índigo", value: "#6366f1" },
  { name: "Fucsia", value: "#d946ef" },
  { name: "Neon Purple", value: "#9d00ff" },
  { name: "Neon Blue", value: "#0066ff" },
  { name: "Neon Cyan", value: "#00f0ff" },
  { name: "Esmeralda", value: "#10b981" },
  { name: "Carmesí", value: "#f43f5e" },
  { name: "Neon Orange", value: "#ff9900" },
];

const SECONDARY_PRESETS = [
  { name: "Fucsia", value: "#d946ef" },
  { name: "Neon Pink", value: "#d946ef" },
  { name: "Neon Purple", value: "#9d00ff" },
  { name: "Neon Cyan", value: "#00f0ff" },
  { name: "Cian", value: "#06b6d4" },
  { name: "Ámbar", value: "#f59e0b" },
  { name: "Neon Orange", value: "#ff9900" },
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

interface AppearanceSectionProps {
  primary: string;
  secondary: string;
  font: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
  onFontChange: (value: string) => void;
}

/** Selectores de color primario/secundario y tipografía global. */
export function AppearanceSection({
  primary,
  secondary,
  font,
  onPrimaryChange,
  onSecondaryChange,
  onFontChange,
}: AppearanceSectionProps) {
  return (
    <>
      {/* Color Primario */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">Color Primario</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <select
            className="input-dark cursor-pointer"
            value={primary}
            onChange={(e) => onPrimaryChange(e.target.value)}
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
              onChange={(e) => onPrimaryChange(e.target.value)}
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
            onChange={(e) => onSecondaryChange(e.target.value)}
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
              onChange={(e) => onSecondaryChange(e.target.value)}
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
          onChange={(e) => onFontChange(e.target.value)}
        >
          {FONTS_PRESETS.map((f) => (
            <option key={f.value} value={f.value}>{f.name}</option>
          ))}
        </select>
      </div>
    </>
  );
}
