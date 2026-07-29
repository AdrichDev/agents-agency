/**
 * aa-agentes-economia-tokens (T5.3) — ¿La guía de estilo comprimida degrada la conversación?
 *
 * T5.3 quedó BLOQUEADA por `429 quota exceeded` de la cuenta OpenAI. La cuota ya responde
 * (verificado el 28-29/07/2026), así que la comparación se puede hacer. Esto la hace.
 *
 * MÉTODO — lo que se controla y lo que no, dicho antes de enseñar ningún número:
 *
 *   - Variable ÚNICA: `CONVERSATION_STYLE_GUIDE`. La versión larga se lee de git
 *     (`2304bf6~1`), la corta del módulo actual. Todo lo demás es idéntico byte a byte:
 *     mismo agente, mismo modelo, mismo `systemPrompt`, mismo guion, mismo orden.
 *   - Se llama al cliente LLM directamente, NO a `chatWithAgent`. A propósito: el engine
 *     mete RAG, herramientas y bloques opcionales que cambian entre llamadas y meterían
 *     ruido justo en lo que se quiere medir. La contrapartida es que esto NO prueba nada
 *     sobre el uso de herramientas — sólo sobre cómo suena la conversación, que es lo que
 *     T5.3 pregunta.
 *   - `temperature` no se fija: el modelo de producción (`gpt-5.4-mini`) la rechaza. Así que
 *     dos respuestas distintas NO demuestran por sí solas que la guía sea la causa. Por eso
 *     se corren N repeticiones por rama y se juzga por las reglas violadas, no por el texto.
 *   - El veredicto NO lo da este script: da las respuestas y un recuento de infracciones
 *     mecánicas (fórmulas prohibidas, nº de preguntas, emojis, Markdown). Leerlas es parte
 *     del trabajo.
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/compare-style-compression.ts               # lista agentes
 *   npx tsx -r dotenv/config scripts/compare-style-compression.ts --run <id>    # compara
 *   ... --run <id> --repeats 3                                                  # N por rama
 *
 * No escribe NADA: ni conversaciones, ni mensajes, ni consumo de cupo. Sólo lee el agente.
 */
import { execFileSync } from "node:child_process";
import { prisma } from "@/lib/db";
import { getClientForAgent } from "@/lib/openai";
import { CONVERSATION_STYLE_GUIDE } from "@/lib/agent/style";

const RUN = process.argv.includes("--run");
const agentId = process.argv[process.argv.indexOf("--run") + 1];
const repeats = Number(
  process.argv.includes("--repeats") ? process.argv[process.argv.indexOf("--repeats") + 1] : 2,
);

/** Commit que comprimió la guía. Su padre tiene la versión larga. */
const COMMIT_COMPRESION = "2304bf6";

/**
 * El guion de T5.3, literal: saludo → catálogo → cita → escalado. Cuatro turnos, porque las
 * reglas que más se pierden al comprimir son las de RITMO ("no vuelvas a saludar", "no
 * repitas el nombre"), y esas sólo se ven a partir del segundo mensaje.
 */
const GUION = [
  "Hola, buenas!",
  "Qué tratamientos hacéis?",
  "Vale, pues quiero pedir cita para la semana que viene",
  "Oye pues la verdad es que no me habéis atendido bien la última vez, quiero hablar con alguien",
];

/** Fórmulas que la guía prohíbe por su nombre, en las dos versiones. */
const PROHIBIDAS = [
  "¡Absolutamente!",
  "No dudes en contactarnos",
  "Estaré encantado de asistirle",
  "Como asistente virtual",
  "¡Excelente pregunta!",
  "¿Hay algo más en lo que pueda ayudarte?",
];

const EMOJI = /\p{Extended_Pictographic}/gu;

/** Recupera la guía larga del commit anterior a la compresión. */
function guiaLarga(): string {
  const fuente = execFileSync(
    "git",
    ["show", `${COMMIT_COMPRESION}~1:back/src/lib/agent/style.ts`],
    { encoding: "utf8", cwd: process.cwd().replace(/[\\/]back$/, "") },
  );
  // La guía es el único template literal del fichero. Se extrae por sus delimitadores en vez
  // de por `eval`: el fichero viene de git y no se ejecuta nunca.
  const m = fuente.match(/CONVERSATION_STYLE_GUIDE = `([\s\S]*?)`;/);
  if (!m) throw new Error("No se pudo extraer la guía larga de " + COMMIT_COMPRESION + "~1");
  return m[1];
}

/** Infracciones mecánicas de una respuesta. Mecánicas: no juzgan el tono, sólo lo contable. */
function infracciones(texto: string, esPrimerTurno: boolean) {
  const frases = texto.split(/(?<=[.!?])\s+/).filter((f) => f.trim().length > 0);
  return {
    formulasProhibidas: PROHIBIDAS.filter((f) =>
      texto.toLowerCase().includes(f.toLowerCase().replace(/[¡!¿?]/g, "")),
    ),
    preguntas: (texto.match(/\?/g) ?? []).length,
    frases: frases.length,
    emojis: (texto.match(EMOJI) ?? []).length,
    markdownPesado: /^\s*[-*#|]/m.test(texto),
    // "No vuelvas a saludar a mitad de conversación": sólo es infracción si NO es el primero.
    saludoTardio: !esPrimerTurno && /\b(hola|buenas|buenos días|buenas tardes)\b/i.test(texto),
  };
}

async function inspeccionar() {
  const agents = await prisma.agent.findMany({
    where: { systemPrompt: { not: "" } },
    select: { id: true, name: true, status: true, model: true, tenantId: true },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  console.log("Agentes (15 más recientes):");
  for (const a of agents) {
    console.log(
      `  ${a.id}  ${String(a.name).slice(0, 26).padEnd(26)} ${String(a.status).padEnd(10)} ${String(a.model ?? "-")}`,
    );
  }
  console.log(`\nPara comparar:  --run <agentId> [--repeats N]`);
}

/** Corre el guion entero con una guía concreta. Devuelve las respuestas y los tokens. */
async function correrGuion(params: {
  client: Awaited<ReturnType<typeof getClientForAgent>>["client"];
  model: string;
  systemPrompt: string;
  guia: string;
}) {
  const { client, model, systemPrompt, guia } = params;
  const system = [systemPrompt, "Responde siempre en el idioma del usuario.", guia].join("\n\n");

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
  ];
  const respuestas: string[] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  for (const turno of GUION) {
    messages.push({ role: "user", content: turno });
    const res = await client.chat.completions.create({ model, messages });
    const texto = res.choices[0]?.message?.content ?? "";
    messages.push({ role: "assistant", content: texto });
    respuestas.push(texto);
    promptTokens += res.usage?.prompt_tokens ?? 0;
    completionTokens += res.usage?.completion_tokens ?? 0;
  }

  return { respuestas, promptTokens, completionTokens, caracteresGuia: guia.length };
}

async function main() {
  if (!RUN || !agentId) return inspeccionar();

  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      status: true,
      model: true,
      runtime: true,
      tenantId: true,
      systemPrompt: true,
      tenant: { select: { credentialMode: true } },
    },
  });

  const { client, model: overrideModel } = await getClientForAgent({
    runtime: agent.runtime,
    agentId: agent.id,
    tenantId: agent.tenantId,
    credentialMode: agent.tenant?.credentialMode ?? null,
    model: agent.model,
  });
  const model = overrideModel ?? agent.model ?? "gpt-5.4-mini";

  const larga = guiaLarga();
  console.log(`Agente: ${agent.name} (${agent.status}, modelo ${model})`);
  console.log(`Guía LARGA: ${larga.length} caracteres · Guía CORTA: ${CONVERSATION_STYLE_GUIDE.length}`);
  console.log(`Guion: ${GUION.length} turnos · ${repeats} repeticiones por rama\n`);

  const ramas = [
    { nombre: "ANTES (guía larga)", guia: larga },
    { nombre: "DESPUÉS (guía comprimida)", guia: CONVERSATION_STYLE_GUIDE },
  ];

  for (const rama of ramas) {
    console.log(`\n${"=".repeat(70)}\n${rama.nombre}\n${"=".repeat(70)}`);
    let totalPrompt = 0;
    let totalInfracciones = 0;
    /** Recuento por tipo: leer 40 respuestas a ojo es justo como se cuelan los sesgos. */
    const porTipo: Record<string, number> = {};

    for (let i = 0; i < repeats; i++) {
      const r = await correrGuion({
        client,
        model,
        systemPrompt: agent.systemPrompt ?? "",
        guia: rama.guia,
      });
      totalPrompt += r.promptTokens;

      console.log(`\n--- repetición ${i + 1} · prompt=${r.promptTokens} completion=${r.completionTokens} ---`);
      r.respuestas.forEach((texto, idx) => {
        const inf = infracciones(texto, idx === 0);
        const fallos: string[] = [];
        if (inf.formulasProhibidas.length) fallos.push(`prohibidas: ${inf.formulasProhibidas.join(", ")}`);
        if (inf.preguntas > 1) fallos.push(`${inf.preguntas} preguntas`);
        if (inf.frases > 3) fallos.push(`${inf.frases} frases`);
        if (inf.emojis > 1) fallos.push(`${inf.emojis} emojis`);
        if (inf.markdownPesado) fallos.push("markdown");
        if (inf.saludoTardio) fallos.push("resaluda");
        totalInfracciones += fallos.length;
        if (inf.formulasProhibidas.length) porTipo["formula prohibida"] = (porTipo["formula prohibida"] ?? 0) + 1;
        if (inf.preguntas > 1) porTipo["2+ preguntas"] = (porTipo["2+ preguntas"] ?? 0) + 1;
        if (inf.frases > 3) porTipo["4+ frases"] = (porTipo["4+ frases"] ?? 0) + 1;
        if (inf.emojis > 1) porTipo["2+ emojis"] = (porTipo["2+ emojis"] ?? 0) + 1;
        if (inf.markdownPesado) porTipo["markdown"] = (porTipo["markdown"] ?? 0) + 1;
        if (inf.saludoTardio) porTipo["resaluda"] = (porTipo["resaluda"] ?? 0) + 1;

        console.log(`\n  [${idx + 1}] «${GUION[idx]}»`);
        console.log(`  → ${texto.replace(/\n/g, "\n    ")}`);
        console.log(`  ${fallos.length ? "⚠ " + fallos.join(" · ") : "· sin infracciones mecánicas"}`);
      });
    }

    const desglose = Object.entries(porTipo)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(" · ");
    console.log(
      `\n>>> ${rama.nombre}: ${totalInfracciones} infracciones en ${repeats * GUION.length} respuestas · ` +
        `${Math.round(totalPrompt / repeats)} tokens de prompt por pasada` +
        (desglose ? `\n>>> desglose: ${desglose}` : "\n>>> desglose: ninguna"),
    );
  }

  console.log(
    `\nLas infracciones son mecánicas. Que salgan cero NO significa que la conversación sea buena:\n` +
      `hay que leer las respuestas. Ese es el trabajo que este script no puede hacer.`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
