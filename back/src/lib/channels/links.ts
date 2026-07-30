/**
 * Gramática de enlaces compartida por los tres canales.
 *
 * El modelo escribe `[texto](url)` y URLs sueltas. Cada canal las pinta a su manera
 * (ancla en el widget y en Telegram, `texto: url` en WhatsApp), pero reconocerlas es
 * el mismo problema en los tres, y escrito tres veces es como se desincroniza.
 */

export type LinkPart =
  | { kind: "text"; value: string }
  | { kind: "link"; label: string; url: string };

/**
 * Solo http y https llegan a ser enlace. El texto que se parsea aquí viene del modelo,
 * y el modelo repite lo que hay en la base de conocimiento del inquilino: un
 * `javascript:` que entrara por ahí no puede terminar en un `href`.
 */
export function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// Una sola pasada: enlace markdown o URL suelta. Los paréntesis y comillas quedan fuera
// de la URL suelta para que "(mira https://x.com)" no se lleve el cierre.
const LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()[\]"']+)/gi;

// Puntuación final que casi siempre es de la frase, no de la URL.
const TRAILING = /[.,;:!?]+$/;

/** Trocea el texto en fragmentos planos y enlaces. Lo que no es enlace seguro, es texto. */
export function parseLinks(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let last = 0;

  const push = (value: string) => {
    if (!value) return;
    const prev = parts[parts.length - 1];
    if (prev?.kind === "text") prev.value += value;
    else parts.push({ kind: "text", value });
  };

  for (const m of String(text).matchAll(LINK_PATTERN)) {
    const at = m.index ?? 0;
    push(text.slice(last, at));
    last = at + m[0].length;

    if (m[3]) {
      // URL suelta: la puntuación final vuelve al texto.
      const trimmed = m[3].replace(TRAILING, "");
      parts.push({ kind: "link", label: trimmed, url: trimmed });
      push(m[3].slice(trimmed.length));
      continue;
    }

    const label = m[1] ?? "";
    const url = m[2] ?? "";
    // Esquema no permitido: se queda tal cual lo escribió el modelo. Sin enlace y sin
    // borrar nada — el visitante ve el texto literal, que es lo peor que puede pasar.
    if (!isSafeUrl(url)) push(m[0]);
    else parts.push({ kind: "link", label, url });
  }

  push(text.slice(last));
  return parts;
}
