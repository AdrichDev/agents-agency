/**
 * ¿La ventana deslizante de historial rompe la caché de prefijo del proveedor?
 *
 * `engine.ts:884` coge los ÚLTIMOS `HISTORY_WINDOW_MESSAGES` mensajes. El prompt caching casa
 * por PREFIJO, así que en cuanto la conversación pasa de la ventana, cada turno expulsa el
 * mensaje más viejo y el prefijo cambia. Si eso rompe la caché, los tokens cacheados se
 * estancarían en el system prompt mientras el resto se paga a precio de input completo — y el
 * cupo del cliente se consume más rápido justo en las conversaciones largas.
 *
 * Esto NO se puede razonar desde el código: depende de cómo casa prefijos el proveedor. Se mide.
 *
 * Método: una sola conversación, N turnos encadenados, leyendo de `uso_tokens` (no del retorno
 * del motor: el cupo se descuenta de esa tabla). Se busca el turno en el que la ventana empieza
 * a desbordar y qué le pasa a `cachedTokens` a partir de ahí.
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/measure-history-cache.ts --run <agentId> [--turns 14]
 */
import { prisma } from "@/lib/db";
import { chatWithAgent, HISTORY_WINDOW_MESSAGES } from "@/lib/agent/engine";

const agentId = process.argv[process.argv.indexOf("--run") + 1];
const turnos = Number(
  process.argv.includes("--turns") ? process.argv[process.argv.indexOf("--turns") + 1] : 14,
);
/**
 * Con `--pad`, el system prompt del agente se alarga temporalmente por encima del mínimo
 * cacheable de OpenAI (1024 tokens) y se restaura al terminar. Sirve para comprobar si el
 * prefijo corto es lo que impide los aciertos de caché entre turnos: medido, el prefijo estable
 * son 946 tokens y `cached_tokens` sale 0 salvo entre iteraciones de un mismo turno.
 */
const PAD = process.argv.includes("--pad");

/**
 * Relleno estable. Es texto plausible de instrucciones, no ruido: lo que se prueba es el UMBRAL,
 * y para eso el bloque sólo tiene que ser (a) idéntico en todas las llamadas y (b) estar al
 * principio del prompt. ~350 tokens, suficiente para pasar de 946 a ~1.300.
 */
const RELLENO = `
Directrices operativas de atención al cliente.

Trato: responde siempre en el idioma del visitante. Usa un tono cordial y profesional, sin
tutear si el visitante no ha tuteado antes. No uses emoticonos salvo que el visitante los use.
No inventes nunca datos del negocio: si no consta un horario, un precio o una dirección, dilo
con claridad y ofrece consultarlo. No prometas disponibilidad que no hayas confirmado.

Citas: antes de proponer una hora, confirma el servicio que se necesita. Recoge nombre y
teléfono antes de cerrar la reserva. Repite en voz alta la fecha, la hora y el servicio antes
de darla por confirmada. Si el visitante cambia un dato, vuelve a confirmar el conjunto.

Precios: da siempre rangos si el precio depende del servicio, y aclara si incluye IVA. No
apliques descuentos ni promociones que no consten. Si preguntan por financiación, indica que
lo consultará una persona del equipo.

Límites: no des consejo médico, legal ni financiero. No pidas datos bancarios ni documentos de
identidad por el chat. Si el visitante se queja o está molesto, no discutas: recoge el caso y
ofrece que le llame una persona del equipo. Si piden hablar con una persona, no insistas en
resolverlo tú.

Cierre: termina cada conversación resumiendo lo acordado y lo que pasará después.
`.trim();

/**
 * Turnos de una reserva de cita normal. Cortos a propósito: lo que debe crecer es el HISTORIAL,
 * no el mensaje del usuario. Si los mensajes fueran largos no se sabría cuál de los dos mueve
 * el contador.
 */
const GUION = [
  "Hola, quería pedir cita para la semana que viene.",
  "Me viene mejor por la tarde.",
  "El martes si puede ser.",
  "¿Sobre las cinco?",
  "Vale, me sirve.",
  "Me llamo Adrián.",
  "Mi teléfono es 600123456.",
  "¿Cuánto suele durar?",
  "¿Y el precio?",
  "¿Tenéis parking cerca?",
  "¿Puedo pagar con tarjeta?",
  "¿Hace falta que lleve algo?",
  "¿Puedo cambiarla si me surge algo?",
  "Perfecto, gracias.",
  "Una última cosa: ¿cerráis en agosto?",
  "Entendido.",
  "¿Y los sábados abrís?",
  "Genial.",
  "¿Me confirmáis por WhatsApp?",
  "Gracias, hasta el martes.",
];

/** Prompt original del agente mientras `--pad` está puesto. Se restaura pase lo que pase. */
let promptOriginal: string | null = null;

async function restaurarPrompt() {
  if (promptOriginal === null) return;
  await prisma.agent.update({
    where: { id: agentId },
    data: { systemPrompt: promptOriginal },
  });
  console.log("\nSystem prompt original restaurado.");
  promptOriginal = null;
}

async function main() {
  if (!agentId) {
    console.error("Falta --run <agentId>");
    process.exit(1);
  }
  const agente = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { name: true, model: true, systemPrompt: true, _count: { select: { skills: true } } },
  });
  console.log(
    `Agente: ${agente.name} · modelo ${agente.model} · skills ${agente._count.skills}\n` +
      `Ventana de historial: ${HISTORY_WINDOW_MESSAGES} mensajes ` +
      `(= ${HISTORY_WINDOW_MESSAGES / 2} turnos user+assistant)\n` +
      `Turnos a encadenar: ${turnos}\n` +
      `System prompt: ${agente.systemPrompt.length} caracteres` +
      (PAD ? ` → ${(RELLENO + "\n\n" + agente.systemPrompt).length} con relleno (--pad)` : "") +
      `\n`,
  );

  // El prompt original se restaura SIEMPRE en el `finally` de abajo: esto es un agente real y
  // dejarlo con el relleno puesto cambiaría su comportamiento para cualquiera que le escriba.
  if (PAD) {
    promptOriginal = agente.systemPrompt;
    await prisma.agent.update({
      where: { id: agentId },
      data: { systemPrompt: RELLENO + "\n\n" + agente.systemPrompt },
    });
  }

  let conversationId: string | undefined;
  for (let i = 0; i < Math.min(turnos, GUION.length); i++) {
    const res: any = await chatWithAgent(
      agentId,
      GUION[i],
      conversationId,
      "widget",
      undefined,
      true,
    );
    conversationId = res?.conversationId ?? conversationId;
    if (!conversationId) {
      // El motor no devolvió el id: se recupera la conversación de prueba más reciente.
      const ultima = await prisma.conversation.findFirst({
        where: { agentId, isTest: true },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      conversationId = ultima?.id;
    }
    process.stdout.write(`turno ${String(i + 1).padStart(2)} ✓  `);
  }
  console.log("\n");

  if (!conversationId) {
    console.error("No se pudo determinar la conversación. Nada que medir.");
    return;
  }

  const filas = await prisma.tokenUsage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { tokens: true, contexto: true, model: true },
  });

  console.log(`Conversación ${conversationId} — ${filas.length} filas en uso_tokens\n`);
  // `uso_tokens.tokens` es lo IMPUTADO al cupo desde `aa-cupo-cache-y-prefijo`; el bruto vive en
  // `contexto.tokensBrutos`. Mostrar sólo una de las dos columnas ocultaría justo el efecto que
  // este script existe para medir.
  console.log("turno │  bruto │ imputa │ prompt │ cached │  %cach │ iter │ mensajes en ventana");
  console.log("──────┼────────┼────────┼────────┼────────┼────────┼──────┼────────────────────");

  let sumaBruto = 0;
  let sumaImputado = 0;
  let aciertosUnaIteracion = 0;

  filas.forEach((f, i) => {
    const c = (f.contexto ?? {}) as Record<string, number | null>;
    const prompt = c.promptTokens ?? null;
    const cached = c.cachedTokens ?? null;
    const bruto = c.tokensBrutos ?? f.tokens;
    const pct = prompt && cached !== null ? ((cached / prompt) * 100).toFixed(0) + "%" : "—";
    // Antes del turno i hay 2*i mensajes persistidos; la ventana los corta en HISTORY_WINDOW.
    const enVentana = Math.min(2 * i, HISTORY_WINDOW_MESSAGES);
    const desborda = 2 * i > HISTORY_WINDOW_MESSAGES ? " ← desborda" : "";
    sumaBruto += bruto;
    sumaImputado += f.tokens;
    // El acierto que importa es el de un turno de UNA iteración: entre las dos iteraciones de un
    // mismo turno el prefijo es idéntico y milisegundos aparte, así que ese acierto no prueba que
    // la caché sobreviva de un turno al siguiente.
    if (c.iterations === 1 && (cached ?? 0) > 0) aciertosUnaIteracion += 1;
    console.log(
      `  ${String(i + 1).padStart(3)} │ ${String(bruto).padStart(6)} │ ` +
        `${String(f.tokens).padStart(6)} │ ` +
        `${String(prompt ?? "—").padStart(6)} │ ${String(cached ?? "—").padStart(6)} │ ` +
        `${pct.padStart(6)} │ ${String(c.iterations ?? "—").padStart(4)} │ ${enVentana}${desborda}`,
    );
  });

  const ahorro = sumaBruto > 0 ? (1 - sumaImputado / sumaBruto) * 100 : 0;
  console.log(
    `\nBruto ${sumaBruto} · imputado al cupo ${sumaImputado} (${ahorro.toFixed(0)}% menos)\n` +
      `Aciertos de caché en turnos de UNA iteración: ${aciertosUnaIteracion} de ${filas.length}`,
  );

  const conDato = filas
    .map((f) => (f.contexto ?? {}) as Record<string, number | null>)
    .filter((c) => c.cachedTokens !== null && c.cachedTokens !== undefined);
  if (conDato.length === 0) {
    console.log(
      "\n⚠ El proveedor no informó `cached_tokens` en ninguna fila. Sin ese campo esta medición " +
        "no puede concluir nada: no se sabe si la caché falló o si no se reportó.",
    );
  }
  await restaurarPrompt();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e?.message ?? e);
  await restaurarPrompt().catch((err) =>
    console.error(`⚠ NO se pudo restaurar el system prompt: ${err?.message ?? err}`),
  );
  await prisma.$disconnect();
  process.exit(1);
});
