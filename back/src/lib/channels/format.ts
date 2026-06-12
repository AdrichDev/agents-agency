/**
 * Conversión del Markdown ligero que emite el modelo (negrita **x**) al formato
 * nativo de cada canal. El widget renderiza la negrita en cliente (widget.js).
 */

/** Escapa entidades HTML para parse_mode HTML de Telegram. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Quita marcadores Markdown que ningún canal de chat renderiza (títulos, separadores). */
function stripHeavyMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "") // títulos ### → texto plano
    .replace(/^[-*]{3,}\s*$/gm, ""); // separadores ---
}

/** Telegram (parse_mode HTML): negrita con dobles asteriscos → <b>, cursiva con asterisco simple → <i>. */
export function toTelegramHtml(text: string): string {
  return stripHeavyMarkdown(escapeHtml(text))
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/__(.+?)__/gs, "<b>$1</b>")
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<i>$2</i>");
}

/** WhatsApp usa formato propio: negrita con un solo asterisco, cursiva con _. */
export function toWhatsAppText(text: string): string {
  return stripHeavyMarkdown(text)
    .replace(/\*\*(.+?)\*\*/gs, "*$1*")
    .replace(/__(.+?)__/gs, "*$1*");
}
