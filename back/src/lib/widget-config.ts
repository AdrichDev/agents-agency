export const DEFAULT_WIDGET_PRIMARY = "#4f46e5";
export const DEFAULT_WIDGET_SECONDARY = "#9333ea";
export const DEFAULT_WIDGET_AVATAR = "🤖";

const HEX_RE = /^#?([0-9a-f]{6})$/i;
const RGB_RE = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

function toHexPart(value: number): string {
  return value.toString(16).padStart(2, "0");
}

export function normalizeColorValue(value: string, fallback = DEFAULT_WIDGET_PRIMARY): string {
  const trimmed = value.trim();
  const hex = trimmed.match(HEX_RE);
  if (hex) return `#${hex[1].toLowerCase()}`;

  const rgb = trimmed.match(RGB_RE);
  if (rgb) {
    const values = rgb.slice(1).map(Number);
    if (values.every((item) => item >= 0 && item <= 255)) {
      return `#${values.map(toHexPart).join("")}`;
    }
  }

  return fallback;
}

export function normalizeWidgetTemplateConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
