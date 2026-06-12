/**
 * Banco de pruebas del estilo conversacional.
 * Simula conversaciones reales contra un agente y audita cada respuesta:
 * longitud, nº de preguntas, emojis, muletillas robóticas, re-saludos...
 *
 * Uso:  npx tsx scripts/test-conversations.ts [agentId]
 * (sin agentId usa el primer agente de la BD)
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { chatWithAgent } from "../src/lib/agent/engine";

const SCENARIOS: { name: string; channel: string; messages: string[] }[] = [
  {
    name: "Visita web curiosa (flujo de lead completo)",
    channel: "widget",
    messages: [
      "hola",
      "Marta",
      "¿qué servicios ofrecéis exactamente?",
      "vale y ¿cuánto cuesta más o menos?",
      "sí, me interesa que me llaméis",
      "marta@gmail.com y el 611223344",
    ],
  },
  {
    name: "Cliente informal por Telegram",
    channel: "telegram",
    messages: [
      "buenas!! oye teneis cita para mañana??",
      "soy Dani",
      "por la tarde mejor, sobre las 6",
      "perfecto crack, gracias!",
    ],
  },
  {
    name: "Queja (NO debe llevar emojis)",
    channel: "widget",
    messages: [
      "Hola, soy Luis Pérez",
      "Estoy muy descontento, llevo dos semanas esperando una respuesta y nadie me llama. Quiero una solución ya.",
    ],
  },
  {
    name: "Usuario formal",
    channel: "widget",
    messages: [
      "Buenos días, mi nombre es Carmen Ruiz",
      "Quisiera información sobre sus servicios para una empresa de 40 empleados.",
    ],
  },
];

const FORBIDDEN_PHRASES = [
  /absolutamente/i,
  /no dudes en/i,
  /no dude en/i,
  /encantado de asistir/i,
  /estaré encantado de ayudar/i,
  /como asistente virtual/i,
  /excelente pregunta/i,
  /ha sido programada exitosamente/i,
];

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

interface Issue {
  scenario: string;
  turn: number;
  reply: string;
  problem: string;
}

function auditReply(reply: string, turn: number, scenario: string, isComplaint: boolean, issues: Issue[]) {
  const push = (problem: string) => issues.push({ scenario, turn, reply, problem });

  const sentences = reply.split(/[.!?…]+\s/).filter((s) => s.trim().length > 0);
  if (reply.length > 450 || sentences.length > 4) {
    push(`Demasiado largo (${reply.length} chars, ~${sentences.length} frases). Máximo 1-3 frases.`);
  }

  const questions = (reply.match(/¿|\?/g) ?? []).filter((c) => c === "?").length;
  if (questions >= 2) push(`Hace ${questions} preguntas en un solo mensaje. Máximo una.`);

  const emojis = reply.match(EMOJI_RE) ?? [];
  if (emojis.length > 1) push(`Lleva ${emojis.length} emojis (máximo 1 por mensaje).`);
  if (isComplaint && emojis.length > 0) push(`Emoji en una queja/incidencia: ${emojis.join(" ")}. Prohibido.`);

  for (const re of FORBIDDEN_PHRASES) {
    if (re.test(reply)) push(`Muletilla robótica detectada: ${re}`);
  }

  if (turn > 1 && /^(¡?hola|buenas|buenos días)/i.test(reply.trim())) {
    push("Re-saluda a mitad de conversación.");
  }

  if (/listas?:|^\s*[-*•]\s/m.test(reply)) push("Usa listas con viñetas sin que se las pidan.");
  if (/^#{1,6}\s/m.test(reply)) push("Usa títulos Markdown en un chat.");
}

async function main() {
  const agentId =
    process.argv[2] ??
    (await prisma.agent.findFirst({ orderBy: { createdAt: "asc" } }))?.id;
  if (!agentId) {
    console.error("✖ No hay agentes en la BD. Crea uno primero.");
    process.exit(1);
  }
  const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
  console.log(`\n══ Probando estilo conversacional de "${agent.name}" (${agent.model}) ══\n`);

  const issues: Issue[] = [];
  let totalReplies = 0;
  let repliesWithEmoji = 0;

  for (const scenario of SCENARIOS) {
    console.log(`\n── Escenario: ${scenario.name} ──`);
    let conversationId: string | undefined;
    const isComplaint = /queja/i.test(scenario.name);

    for (let i = 0; i < scenario.messages.length; i++) {
      const userMsg = scenario.messages[i];
      console.log(`\n  👤 ${userMsg}`);
      try {
        const res = await chatWithAgent(agentId, userMsg, conversationId, scenario.channel);
        conversationId = res.conversationId;
        console.log(`  🤖 ${res.text.replace(/\n/g, "\n     ")}`);
        totalReplies++;
        if ((res.text.match(EMOJI_RE) ?? []).length > 0) repliesWithEmoji++;
        auditReply(res.text, i + 1, scenario.name, isComplaint, issues);
      } catch (e) {
        console.error(`  ✖ Error: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // Ratio global de emojis: debe haber ALGUNO pero no en todos los mensajes
  const ratio = totalReplies ? repliesWithEmoji / totalReplies : 0;
  console.log(`\n\n══ RESULTADO ══`);
  console.log(`Respuestas analizadas: ${totalReplies} · con emoji: ${repliesWithEmoji} (${Math.round(ratio * 100)}%)`);
  if (repliesWithEmoji === 0) {
    issues.push({ scenario: "global", turn: 0, reply: "", problem: "Ningún mensaje lleva emoji: la conversación queda fría. Debería haber alguno." });
  }
  if (ratio > 0.6) {
    issues.push({ scenario: "global", turn: 0, reply: "", problem: `Demasiados mensajes con emoji (${Math.round(ratio * 100)}%). Lo natural es uno de cada 2-3.` });
  }

  if (issues.length === 0) {
    console.log("✔ PASA: el estilo es natural según todos los criterios.\n");
  } else {
    console.log(`✖ ${issues.length} puntos a corregir:\n`);
    for (const it of issues) {
      console.log(`  • [${it.scenario}${it.turn ? ` · turno ${it.turn}` : ""}] ${it.problem}`);
      if (it.reply) console.log(`    → "${it.reply.slice(0, 140)}${it.reply.length > 140 ? "..." : ""}"`);
    }
    console.log("\nAjusta la guía en src/lib/agent/style.ts o el systemPrompt del agente y vuelve a ejecutar.\n");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("✖ Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
