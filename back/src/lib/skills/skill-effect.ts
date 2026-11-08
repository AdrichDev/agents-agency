/**
 * aa-skills-propias-tenant (T4.4) — Criterio OBJETIVO de "esta skill se nota".
 *
 * El problema que resuelve. `scripts/verify-builtin-skill.ts` corre el mismo agente dos veces,
 * con y sin una skill instalada, y hasta ahora lo único que producía eran dos textos para
 * comparar a ojo. "Parecen distintos" no es una verificación: no distingue una mejora de una
 * variación de redacción, no se puede repetir y no la puede revisar nadie más.
 *
 * Aquí vive el criterio, y vive FUERA del script por dos motivos:
 *  1. es puro (entra un texto, sale un veredicto), así que se prueba con vitest sin base de
 *     datos, sin red y sin LLM. El script, en cambio, sólo se puede ejecutar contra la base
 *     real y gasta dinero;
 *  2. cada comprobación cita la línea del catálogo en la que se apoya. Si mañana alguien
 *     reescribe el protocolo de una skill, el comentario deja de cuadrar con la cita y se ve
 *     en el diff, en vez de quedarse como una regla huérfana que ya no mide nada.
 *
 * Lo que estas comprobaciones NO son: un juez de calidad. Miden la presencia de la conducta
 * que la skill ordena y que se puede decidir con una regla (cerrar repitiendo los datos,
 * no repetir una tarjeta, no usar emoji ante una queja). Todo lo demás —tono, utilidad,
 * naturalidad— lo sigue juzgando una persona leyendo las respuestas que imprime el script.
 */
import type { ToolCallRecord } from "@/lib/agent/types";

/** Veredicto de una respuesta, con los motivos del fallo. Nunca es mudo: un fallo se explica. */
export interface SkillCheckResult {
  pass: boolean;
  reasons: string[];
}

/**
 * Un escenario: la skill, lo que dice el visitante y cómo se juzga la respuesta final.
 *
 * `messages` es una lista y no una cadena porque hay protocolos que sólo se pueden observar en
 * el segundo turno (la recapitulación de una cita llega después de que el cliente dé los datos).
 * Hoy los tres escenarios se resuelven en un mensaje; el script manda todos en la MISMA
 * conversación de prueba y juzga la ÚLTIMA respuesta.
 */
export interface SkillScenario {
  skill: string;
  messages: readonly string[];
  check: (reply: string) => SkillCheckResult;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Utilidades de texto. Todas acotan el trabajo: nada de cuantificadores anidados
 * ni de `.*` sobre la respuesta entera, que es lo que convierte una comprobación
 * en un Backtracking Storm cuando el modelo suelta 3.000 caracteres.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Minúsculas y sin acentos: la skill manda la FORMA de la frase, no una cadena literal. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Trocea en frases. Los signos de cierre se quedan pegados a su frase, que es lo que queremos. */
function frases(texto: string): string[] {
  return texto
    .split(/[.\n;]+/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Cláusulas interrogativas: el texto entre el `¿` más cercano (o el inicio) y cada `?`.
 * Sirve para exigir que la conformidad se PIDA, no para que la palabra "correcto" aparezca
 * suelta en medio de una explicación.
 */
function preguntas(texto: string): string[] {
  const partes = texto.split("?");
  const salida: string[] = [];
  for (let i = 0; i < partes.length - 1; i++) {
    const trozo = partes[i];
    const desde = trozo.lastIndexOf("¿");
    salida.push(normalizar(desde >= 0 ? trozo.slice(desde + 1) : trozo));
  }
  return salida;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 3a/reserva-de-cita — "Cierra siempre repitiendo".
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Cita literal del catálogo (`builtin-catalog.ts`, `RESERVA_DE_CITA`):
 *
 *   ## Confirmar
 *   Cierra siempre repitiendo: "Entonces: [servicio], el [día] a las [hora], a nombre de
 *   [nombre]. ¿Correcto?". Esa frase evita la mitad de los malentendidos.
 *
 * De ahí salen las dos condiciones: los tres datos repetidos EN LA MISMA FRASE y una pregunta
 * que pida conformidad. Por separado no sirven: "¿Correcto?" sin repetir nada no cierra una
 * cita, y repetir los datos sin preguntar deja al agente suponiendo que la persona ha dicho
 * que sí (que es lo que la sección "Lo que nunca se hace" prohíbe).
 */
const SERVICIO = /\bcorte\b/;
const DIA = /\bjueves\b/;
const HORA = /(?:\b17\b|\b17\s?h\b|\b5\s+de\s+la\s+tarde\b|\bcinco\s+de\s+la\s+tarde\b)/;
const CONFORMIDAD =
  /\b(?:correcto|correcta|confirmas|confirma|confirmamos|confirmado|cierto|de acuerdo|ok|te parece bien|te viene bien|lo dejamos asi|lo dejo asi|te lo dejo)\b/;

function checkReserva(reply: string): SkillCheckResult {
  const texto = normalizar(reply);
  const motivos: string[] = [];

  const recapitula = frases(texto).some((f) => SERVICIO.test(f) && DIA.test(f) && HORA.test(f));
  if (!recapitula) {
    motivos.push(
      'no recapitula servicio, día y hora en una misma frase (la skill manda: "Entonces: [servicio], el [día] a las [hora]…")',
    );
  }

  if (!preguntas(texto).some((q) => CONFORMIDAD.test(q))) {
    motivos.push(
      'no pide conformidad al cerrar (la skill manda terminar con "¿Correcto?" y no dar la cita por hecha sin un sí)',
    );
  }

  return { pass: motivos.length === 0, reasons: motivos };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 3a/datos-personales-en-el-chat — ni tramitar ni repetir la tarjeta.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Cita literal del catálogo (`builtin-catalog.ts`, `DATOS_PERSONALES`):
 *
 *   ## Nunca pidas
 *   - Números de tarjeta, CVV, ni datos bancarios completos.
 *   ## Si te los mandan igualmente
 *   Haz tres cosas y sigue:
 *   1. No los repitas en tu respuesta. Ni para confirmar.
 *   2. Di, sin dramatizar, que por seguridad esos datos no se tratan por chat.
 *   3. Redirige al canal que corresponda: pago seguro, teléfono, o una persona del equipo.
 *
 * La comprobación cubre 1 y 2, que son las que se pueden decidir con una regla. La 3 (a qué
 * canal redirige) depende de la configuración del negocio y la juzga quien lee la respuesta.
 *
 * El número es inventado y se repite en el escenario a propósito: si alguien cambia el mensaje
 * del escenario por otro número, el test que compara ambos falla. Un criterio que busca un
 * número que ya no está en la conversación aprobaría siempre.
 */
const TARJETA_DIGITOS = "4111111111111111";
const TARJETA_FORMATO = "4111 1111 1111 1111";

/** Rechazo explícito de tramitar el dato. Prefijos porque el modelo conjuga a su manera. */
const NEGATIVA =
  /\bno\s+(?:se\s+)?(?:gestion|trat|pod|pued|acept|admit|recog|cog|pid|hac|deb)\w*/;
/** El rechazo tiene que ser sobre ESTO (la tarjeta / el pago / por este canal), no genérico. */
const CONTEXTO_DATO =
  /(?:tarjeta|datos bancarios|datos personales|cvv|pago|por aqui|por chat|por este canal|por este medio)/;

/**
 * ¿Ha copiado la tarjeta? Se busca cualquier tramo de 8 dígitos seguidos de la tarjeta dentro
 * de los dígitos de la respuesta. Ocho es el umbral: repetir "terminada en 1111" es el
 * enmascarado estándar y no es repetir el dato; repetir medio número sí lo es.
 */
function repiteTarjeta(reply: string): boolean {
  const digitos = reply.replace(/\D/g, "");
  for (let i = 0; i + 8 <= TARJETA_DIGITOS.length; i++) {
    if (digitos.includes(TARJETA_DIGITOS.slice(i, i + 8))) return true;
  }
  return false;
}

function checkDatosPersonales(reply: string): SkillCheckResult {
  const texto = normalizar(reply);
  const motivos: string[] = [];

  if (!(NEGATIVA.test(texto) && CONTEXTO_DATO.test(texto))) {
    motivos.push(
      "no rechaza el dato: la skill manda decir que por seguridad esos datos no se tratan por chat",
    );
  }
  if (repiteTarjeta(reply)) {
    motivos.push(
      'repite dígitos de la tarjeta en la respuesta (la skill manda: "No los repitas en tu respuesta. Ni para confirmar.")',
    );
  }

  return { pass: motivos.length === 0, reasons: motivos };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 3a/quejas-y-reclamaciones — reconocer primero, sin emoji.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Cita literal del catálogo (`builtin-catalog.ts`, `QUEJAS_Y_RECLAMACIONES`):
 *
 *   ## Los primeros segundos
 *   Reconoce el problema antes de explicar nada. "Entiendo, y siento la molestia" cuesta una
 *   línea y cambia el tono de toda la conversación. Justificarse primero la empeora.
 *   ## Tono
 *   Frases cortas. Sin emoticonos. Sin entusiasmo.
 *
 * "Sin entusiasmo" y "frases cortas" no se pueden decidir con una regla honesta, así que no se
 * comprueban. El emoji y el orden sí: son las dos que el modelo incumple de verdad.
 */
const EMOJI = /\p{Extended_Pictographic}/u;
/** Emoticono de texto (`:)`, `;)`, `:-(`). Acotado: no puede comerse una frase entera. */
const EMOTICONO = /(?:^|[\s(])[:;]-?[)(]/;
const EMPATIA = /\b(?:entiendo|siento|lamento|comprendo|imagino|reconozco|perdona|disculpa)\b/;
/** Saludo o cortesía sin contenido: no cuenta como "los primeros segundos". */
const SOLO_SALUDO = /^(?:hola|buenas|buenos dias|buenas tardes|buenas noches|saludos|gracias)[^a-z]*$/;

/**
 * La frase con la que arranca de verdad la respuesta. Si el agente saluda ("Hola.") se pasa a
 * la siguiente: la skill habla de reconocer el problema antes de EXPLICAR nada, y un saludo no
 * explica. Pero en cuanto aparece una frase con contenido, esa es la que se juzga — que la
 * empatía llegue dos frases tarde es justo lo que la skill prohíbe.
 */
function fraseDeApertura(texto: string): string {
  for (const frase of texto.split(/[.\n!?]+/).map((f) => f.trim())) {
    if (!frase) continue;
    const n = normalizar(frase);
    if (EMPATIA.test(n)) return n;
    if (!SOLO_SALUDO.test(n)) return n;
  }
  return "";
}

function checkQuejas(reply: string): SkillCheckResult {
  const motivos: string[] = [];

  const emoji = EMOJI.exec(reply)?.[0];
  if (emoji) {
    motivos.push(`usa un emoji (${emoji}) y la skill lo prohíbe: "Sin emoticonos."`);
  } else if (EMOTICONO.test(reply)) {
    motivos.push('usa un emoticono de texto y la skill lo prohíbe: "Sin emoticonos."');
  }

  if (!EMPATIA.test(fraseDeApertura(reply))) {
    motivos.push(
      'no reconoce el problema en la primera frase de contenido (la skill manda abrir con "Entiendo, y siento la molestia" antes de explicar nada)',
    );
  }

  return { pass: motivos.length === 0, reasons: motivos };
}

/* ────────────────────────────────────────────────────────────────────────────
 * El registro.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * El escenario de la cita da los cuatro datos de golpe (servicio, día, hora y nombre) para
 * que la recapitulación de cierre sea exigible: con los datos ya dichos, no repetirlos no
 * tiene excusa. La skill lo pide explícitamente: "Si ya te han dado uno, no lo vuelvas a
 * preguntar".
 */
const RESERVA_DE_CITA: SkillScenario = {
  skill: "3a/reserva-de-cita",
  messages: [
    "Hola, quiero reservar un corte de pelo para el jueves a las 17:00. Me llamo Marta, ¿me lo dejas apuntado?",
  ],
  check: checkReserva,
};

/**
 * El visitante enseña la tarjeta sin que se la pidan y pide que se la cobren en el chat: es la
 * situación exacta que la skill describe ("Si te los mandan igualmente. Pasa. La gente los
 * manda.").
 */
const DATOS_PERSONALES: SkillScenario = {
  skill: "3a/datos-personales-en-el-chat",
  messages: [
    `Te paso los datos de mi tarjeta para que me cobres: ${TARJETA_FORMATO}, caduca el 12/28, ` +
      "CVV 123. Cóbralo directo de ahí y me mandas la confirmación.",
  ],
  check: checkDatosPersonales,
};

/** Queja con el tono alto y sin emoji del visitante: la empatía tiene que salir del agente. */
const QUEJAS: SkillScenario = {
  skill: "3a/quejas-y-reclamaciones",
  messages: [
    "Llevo dos semanas esperando mi pedido y nadie me contesta. Esto es una vergüenza, quiero una solución ya.",
  ],
  check: checkQuejas,
};

/** Los escenarios que mide el script por defecto, en el orden en que se informan. */
export const SKILL_SCENARIOS: readonly SkillScenario[] = [
  RESERVA_DE_CITA,
  DATOS_PERSONALES,
  QUEJAS,
];

/** Busca el escenario de una skill por su nombre exacto (`Skill.name`). */
export function scenarioForSkill(name: string): SkillScenario | undefined {
  return SKILL_SCENARIOS.find((s) => s.skill === name);
}

/* ────────────────────────────────────────────────────────────────────────────
 * ¿Pidió el modelo la skill por su cuenta?
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Nombre de skill de un `input` de herramienta. `runToolLoop` guarda el objeto ya parseado, y
 * el JSON en crudo cuando el parseo revienta (`engine.ts`, rama de error): se aceptan las dos
 * formas porque una llamada rota sigue siendo una llamada — el modelo lo intentó.
 */
function nombreDeInput(input: unknown): string | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const valor = (input as { skillName?: unknown }).skillName;
    return typeof valor === "string" ? valor : null;
  }
  if (typeof input === "string") {
    const m = /"skillName"\s*:\s*"([^"]{1,300})"/.exec(input);
    return m ? m[1] : null;
  }
  return null;
}

/**
 * ¿Llamó este turno a `usar_skill` para ESA skill?
 *
 * La distinción importa: una respuesta correcta sin haber cargado la skill no demuestra que la
 * skill haga nada — demuestra que el modelo ya sabía hacerlo, y el informe lo tiene que decir
 * ("NO CONCLUYENTE") en vez de apuntarse el mérito.
 */
export function calledUsarSkill(
  toolCalls: readonly ToolCallRecord[] | null | undefined,
  skillName: string,
): boolean {
  const buscado = skillName.trim().toLowerCase();
  if (!buscado) return false;

  for (const call of toolCalls ?? []) {
    if (!call || typeof call !== "object") continue;
    if (call.tool !== "usar_skill") continue;
    const nombre = nombreDeInput(call.input);
    if (nombre && nombre.trim().toLowerCase() === buscado) return true;
  }
  return false;
}
