/**
 * Una cita sólo puede apuntar a un fragmento que se le haya entregado al modelo (AC2, mitad
 * verificable).
 *
 * El prompt ya lo ordena — `engine.ts:333` dice literalmente "NUNCA cites una fuente que no te
 * haya sido entregada" — y `gpt-5.4-mini` lo cumple. `gpt-4.1-nano` no. En el histórico real
 * (36 respuestas citadas, `scripts/diag-citas-respaldadas.ts`) 20 citan algo que la recuperación
 * de ese turno no contenía: prosa inventada (`(fuente: información del negocio)`,
 * `(fuente: carta y alérgenos)`), nombres de fichero interno que el modelo no llega a ver desde
 * que `publicSource` los borra (`(fuente: carta-alergenos.md)`) y URLs que nadie le entregó.
 * El visitante ve un enlace y cree que alguien del negocio lo escribió.
 *
 * Reescribir la regla es el camino caro: ya está escrita. Esto NO le pide nada al modelo — mira
 * el texto ya emitido y le quita la cita que no apunta a ningún fragmento real. La frase se
 * queda: quitar la afirmación sería inventar en la otra dirección, y el modelo no vuelve a
 * hablar. Lo que se retira es la autoridad prestada.
 *
 * ─── LO QUE ESTO **NO** HACE ────────────────────────────────────────────────────────────────
 * No comprueba que el fragmento sostenga la afirmación. Se intentó, con solape léxico entre la
 * frase y el fragmento, y la medición sobre ese mismo histórico lo tumbó: ordena los dos casos
 * de Lafayette AL REVÉS. La invención de la fila H4 ("la cocina cierra a las 15:45", contra un
 * fragmento que sólo da el horario de RESERVAS) puntúa **0,78**, porque repite casi todas las
 * palabras del fragmento y sólo cambia una; la respuesta honesta ("no tengo confirmado a qué
 * hora cierra la cocina") puntúa **0,33** y se habría retirado. Cualquier umbral que mate la
 * invención mata antes media docena de citas ciertas. Detectar eso pide entender la frase, no
 * contar palabras, y eso es otro modelo y otra llamada. Queda fuera y está medido, no supuesto.
 */

export interface FragmentoCitable {
  /** Índice tal y como se le entregó al modelo: `[1]`, `[2]`… */
  indice: number;
  /** URL pública del fragmento, o null si no traía. */
  fuente: string | null;
  contenido: string;
}

/**
 * Una cita del texto, ya localizada.
 *
 * Se admite un nivel de paréntesis anidado porque el modelo escribe la URL como enlace markdown:
 * `(fuente: [web](https://…/))`. Sin el anidado la captura se corta en el primer `)` y una cita
 * legítima acaba pareciendo inventada.
 */
const CITA = /\s*\(\s*fuente\s*:\s*((?:[^()]|\([^()]*\))*)\)/gi;

const URL_EN_REFERENCIA = /https?:\/\/[^\s,;)\]]+/gi;
const INDICE_EN_REFERENCIA = /\[\s*(\d+)\s*\]/g;

interface CitaEncontrada {
  desde: number;
  hasta: number;
  referencia: string;
}

/**
 * Referencias sueltas dentro de una cita. El modelo mete varias en la misma:
 * `(fuente: https://a/ciclismo, https://b/running)`.
 *
 * Se prefieren las URLs a los índices: cuando escribe `[web](https://…)` hay corchetes que no son
 * un índice, y leerlos como tal apuntaría a un fragmento cualquiera.
 */
export function referenciasDeLaCita(referencia: string): string[] {
  const urls = referencia.match(URL_EN_REFERENCIA);
  if (urls?.length) return urls;

  const indices: string[] = [];
  INDICE_EN_REFERENCIA.lastIndex = 0;
  for (let m = INDICE_EN_REFERENCIA.exec(referencia); m; m = INDICE_EN_REFERENCIA.exec(referencia)) {
    indices.push(m[1]);
  }
  if (indices.length) return indices;

  const suelta = referencia.trim();
  // Un número a secas (`(fuente: 2)`) también es un índice; cualquier otra cosa es prosa, y la
  // prosa no resuelve nunca — que es justo lo que se persigue.
  return suelta ? [suelta] : [];
}

const limpiarUrl = (u: string) =>
  u.trim().replace(/[.,;)\]]+$/, "").replace(/\/+$/, "").toLowerCase();

/**
 * Resuelve una referencia suelta contra los fragmentos entregados. El modelo cita de dos maneras:
 * por el índice con el que se le entregó (`(fuente: [2])`, lo que hace en la práctica) o por la
 * URL (que es lo que el prompt le pide). Se admiten las dos, y cualquier otra cosa NO resuelve.
 */
export function resolverFragmento(
  referencia: string,
  fragmentos: FragmentoCitable[]
): FragmentoCitable | null {
  const ref = referencia.trim();
  if (!ref) return null;

  const porIndice = ref.match(/^\[?\s*(\d+)\s*\]?$/);
  if (porIndice) {
    // Sólo índices reales. Los fragmentos que llegan por la tool `search_knowledge` no se le
    // entregan numerados, y se registran con `indice: 0` justamente para que un `(fuente: [0])`
    // inventado no acabe resolviendo contra uno de ellos.
    const n = Number(porIndice[1]);
    return n >= 1 ? (fragmentos.find((f) => f.indice === n) ?? null) : null;
  }

  const objetivo = limpiarUrl(ref);
  return fragmentos.find((f) => f.fuente && limpiarUrl(f.fuente) === objetivo) ?? null;
}

/**
 * Una cita se sostiene si tiene al menos una referencia y TODAS resuelven.
 *
 * Todas, y no alguna: una cita que mezcla una URL entregada con otra que no lo fue presta la
 * credibilidad de la primera a la segunda, y el visitante no distingue cuál avala qué.
 */
export function citaResuelve(referencia: string, fragmentos: FragmentoCitable[]): boolean {
  const refs = referenciasDeLaCita(referencia);
  if (!refs.length) return false;
  return refs.every((r) => resolverFragmento(r, fragmentos) !== null);
}

export interface ResultadoFiltrado {
  texto: string;
  /** Cuántas citas se han retirado. Para poder medirlo sin leer el texto. */
  retiradas: number;
}

/**
 * Quita las citas que no apuntan a ningún fragmento entregado, y deja intacto lo demás.
 *
 * Sin fragmentos entregados, TODA cita se retira: el modelo no puede citar algo que no se le dio,
 * y este es el caso que `engine.ts:333` describe y que nadie estaba comprobando.
 */
export function filtrarCitasSinRespaldo(
  texto: string,
  fragmentos: FragmentoCitable[]
): ResultadoFiltrado {
  if (!texto) return { texto, retiradas: 0 };

  const encontradas: CitaEncontrada[] = [];
  CITA.lastIndex = 0;
  for (let m = CITA.exec(texto); m; m = CITA.exec(texto)) {
    encontradas.push({ desde: m.index, hasta: m.index + m[0].length, referencia: m[1] ?? "" });
  }
  if (!encontradas.length) return { texto, retiradas: 0 };

  // De atrás hacia delante: recortar por el final no mueve los índices de lo que queda por mirar.
  let salida = texto;
  let retiradas = 0;
  for (const cita of [...encontradas].reverse()) {
    if (citaResuelve(cita.referencia, fragmentos)) continue;
    salida = salida.slice(0, cita.desde) + salida.slice(cita.hasta);
    retiradas += 1;
  }

  // Al quitar la cita puede quedar " ." o un espacio doble donde estaba.
  salida = salida.replace(/[ \t]+([.,;!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
  return { texto: salida, retiradas };
}
