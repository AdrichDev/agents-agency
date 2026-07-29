/**
 * Troceo de la respuesta del agente en varios mensajes de canal.
 *
 * Un muro de texto en WhatsApp se lee como un panfleto. Partirlo en 2-3
 * mensajes es lo que separa un bot de un contacto. El corte es SIEMPRE en
 * frontera de párrafo o de frase (AD4): nunca a mitad de frase, nunca dentro
 * de una URL y nunca partiendo una marca de formato.
 *
 * Función pura: sin I/O, sin estado. El formateador de canal
 * (`toWhatsAppText` / `toTelegramHtml`) se aplica DESPUÉS, a cada trozo ya
 * cortado — cortar sobre texto ya convertido a HTML podría dejar una etiqueta
 * abierta.
 */

/**
 * Tope duro de trozos (AD5). Un agente que suelte 40 mensajes seguidos acaba
 * con el número reportado por spam, configure lo que configure su dueño.
 */
export const REPLY_MAX_MESSAGES_CAP = 5;

/**
 * Techo de la pausa entre trozos (AD5). Con el tope de trozos, la espera total
 * de una respuesta partida queda acotada — importa porque en el camino SIN
 * buffer esa pausa ocurre antes de contestar 200 al webhook, y ni Meta ni
 * Telegram esperan indefinidamente.
 */
export const REPLY_PAUSE_MAX_MS = 3_000;

/** Recorta el máximo configurado a los límites válidos. */
export function clampReplyMaxMessages(max: number | null | undefined): number {
  if (!max || !Number.isFinite(max) || max <= 1) return 1;
  return Math.min(Math.trunc(max), REPLY_MAX_MESSAGES_CAP);
}

/** Recorta la pausa configurada al techo. */
export function clampReplyPauseMs(ms: number | null | undefined): number {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.trunc(ms), REPLY_PAUSE_MAX_MS);
}

/**
 * Frontera de frase: signo de cierre + espacio + inicio de frase nueva.
 *
 * El `\s+` obligatorio es lo que protege las URLs: `ejemplo.com/a.b` no lleva
 * espacio tras el punto, así que nunca casa. Exigir además que lo siguiente
 * abra frase evita cortar en abreviaturas ("Sr. Pérez" no casa porque `Pérez`
 * sí abriría… — por eso se exige mayúscula Y que el trozo previo tenga cuerpo).
 */
const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+(?=[«"'¿¡A-ZÁÉÍÓÚÜÑ0-9])/u;
const PARAGRAPH_BOUNDARY = /\n{2,}/;

/** Parte por un separador y descarta los vacíos. */
function segment(text: string, boundary: RegExp): string[] {
  return text
    .split(boundary)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Trocea `text` en como mucho `maxMessages` mensajes.
 *
 * Si hay más segmentos que huecos, el sobrante se concatena en el ÚLTIMO
 * trozo: se prefiere un último mensaje largo a perder texto (AD4). La
 * concatenación de los trozos devueltos siempre contiene todo el contenido
 * original.
 *
 * Devuelve siempre al menos un elemento (el propio texto) salvo que esté vacío.
 */
export function splitReply(text: string, maxMessages: number): string[] {
  // Sin partir → se devuelve el texto TAL CUAL, sin normalizar siquiera los
  // espacios. Es lo que garantiza que el default sea byte a byte lo que se
  // enviaba antes de este change (AC2).
  const max = clampReplyMaxMessages(maxMessages);
  if (max <= 1) return [text];

  const trimmed = text.trim();
  if (!trimmed) return [];

  // Párrafo primero; si el texto viene de una sola tirada, se prueba por frase.
  let separator = "\n\n";
  let segments = segment(trimmed, PARAGRAPH_BOUNDARY);
  if (segments.length < 2) {
    separator = " ";
    segments = segment(trimmed, SENTENCE_BOUNDARY);
  }
  // Sin fronteras aprovechables: se manda entero antes que cortar a ciegas.
  if (segments.length < 2) return [trimmed];

  const chunks = segments.slice(0, max - 1);
  chunks.push(segments.slice(max - 1).join(separator));
  return chunks;
}
