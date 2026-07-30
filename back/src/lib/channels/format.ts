/**
 * Conversión del Markdown ligero que emite el modelo (negrita **x**, enlaces
 * [texto](url)) al formato nativo de cada canal. El widget renderiza en cliente
 * (widget.js) con la misma gramática de enlaces.
 */

import { parseLinks } from "./links";

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

/** Negrita y cursiva de un fragmento SIN enlaces, ya escapado. */
function telegramInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/__(.+?)__/gs, "<b>$1</b>")
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<i>$2</i>");
}

/**
 * Telegram (parse_mode HTML): negrita, cursiva y enlaces reales.
 *
 * Los enlaces se extraen ANTES de aplicar negrita/cursiva: una URL con guiones bajos
 * (`/a__b__c`) pasaría por el patrón de negrita y saldría rota.
 */
export function toTelegramHtml(text: string): string {
  return parseLinks(stripHeavyMarkdown(text))
    .map((part) =>
      part.kind === "text"
        ? telegramInline(escapeHtml(part.value))
        : `<a href="${escapeHtml(part.url)}">${escapeHtml(part.label)}</a>`,
    )
    .join("");
}

/**
 * WhatsApp usa formato propio: negrita con un solo asterisco, cursiva con _.
 *
 * No tiene sintaxis de ancla: enlaza por su cuenta las URLs que ve en el texto, así que
 * `[texto](url)` se convierte en `texto: url` y la URL suelta se deja intacta. Antes de
 * esto el visitante leía los corchetes.
 */
export function toWhatsAppText(text: string): string {
  return parseLinks(stripHeavyMarkdown(text))
    .map((part) => {
      if (part.kind === "link") {
        return part.label === part.url ? part.url : `${part.label}: ${part.url}`;
      }
      return part.value.replace(/\*\*(.+?)\*\*/gs, "*$1*").replace(/__(.+?)__/gs, "*$1*");
    })
    .join("");
}
