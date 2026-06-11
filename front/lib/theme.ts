/** Tema visual de la app: colores de marca, tipografía y modo claro/oscuro. */

export interface ThemeSettings {
  mode: "dark" | "light";
  accent1: string;
  accent2: string;
  font: string;
}

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "Sistema (por defecto)", value: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: "Inter / Segoe", value: '"Inter", "Segoe UI", system-ui, sans-serif' },
  { label: "Georgia (serif)", value: 'Georgia, "Times New Roman", serif' },
  { label: "Mono", value: 'ui-monospace, "Cascadia Code", Consolas, monospace' },
  { label: "Redondeada", value: '"Comic Sans MS", "Segoe UI", system-ui, sans-serif' },
];

export const DEFAULT_THEME: ThemeSettings = {
  mode: "dark",
  accent1: "#6366f1",
  accent2: "#d946ef",
  font: FONT_OPTIONS[0].value,
};

const KEY = "aa-theme";

export function loadTheme(): ThemeSettings {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return { ...DEFAULT_THEME, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: ThemeSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme.mode;
  root.style.setProperty("--accent-1", theme.accent1);
  root.style.setProperty("--accent-2", theme.accent2);
  root.style.setProperty("--font-app", theme.font);
}

export function saveTheme(theme: ThemeSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(theme));
  applyTheme(theme);
}
