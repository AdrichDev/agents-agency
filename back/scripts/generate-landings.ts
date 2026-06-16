/**
 * generate-landings.ts — Genera automáticamente las 3 landings recuperadas
 * siguiendo el proceso real (answers → prompts → generateFiles) y crea sus clientes.
 *
 * Ejecutar: npx tsx scripts/generate-landings.ts
 * Nota: llama a OpenAI (DEFAULT_MODEL + STRONG_MODEL) una vez por landing.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { refreshModelConfig } from "@/lib/openai";
import { buildGenerationPrompts } from "@/lib/landing/prompt-master";
import { generateFiles } from "@/lib/landing/generator";
import type { AnswerEntry } from "@/lib/landing/interview";

type Decalogue = Record<string, string>;

interface LandingSpec {
  projectName: string;   // nombre del LandingProject ya existente
  business: string;
  sector: string;
  decalogue: Decalogue;
}

const SPECS: LandingSpec[] = [
  {
    projectName: "Calcetines Deportivos",
    business: "Wabiks",
    sector: "E-commerce",
    decalogue: {
      purpose: "Tienda online de calcetines deportivos técnicos de alto rendimiento para running, ciclismo y fitness",
      businessName: "Wabiks",
      palette: "Energético y deportivo: negro, azul eléctrico y blanco",
      style: "Moderno, dinámico, mobile-first con mucho impacto visual",
      images: "Placeholders de deporte y producto (picsum.photos)",
      sections: "Hero con CTA, catálogo destacado, beneficios técnicos (transpirable, sin costuras, compresión), opiniones de clientes, newsletter, footer con contacto",
      cta: "Comprar ahora y Ver catálogo",
      contact: "Formulario de contacto, email hola@wabiks.com y enlaces a redes sociales",
      database: "none",
      language: "Español",
    },
  },
  {
    projectName: "Centro de Estética",
    business: "Caress Centro Estético",
    sector: "Salud y belleza",
    decalogue: {
      purpose: "Centro de estética que ofrece tratamientos faciales, corporales y depilación láser",
      businessName: "Caress Centro Estético",
      palette: "Elegante y suave: rosa empolvado, dorado y blanco",
      style: "Elegante, limpio y premium con sensación de bienestar",
      images: "Placeholders de spa y estética (picsum.photos)",
      sections: "Hero, servicios y tratamientos, sobre nosotros, galería de resultados, opiniones, reserva de cita, contacto con mapa",
      cta: "Reserva tu cita",
      contact: "Formulario de reserva, teléfono, dirección y mapa",
      database: "none",
      language: "Español",
    },
  },
  {
    projectName: "Bufete de Abogados",
    business: "Fernandez Casas Abogados",
    sector: "Legal",
    decalogue: {
      purpose: "Bufete de abogados especializado en derecho civil, mercantil, laboral y penal",
      businessName: "Fernandez Casas Abogados",
      palette: "Sobrio y profesional: azul marino, gris y blanco",
      style: "Profesional, serio y confiable, transmitiendo experiencia",
      images: "Placeholders corporativos y de oficina (picsum.photos)",
      sections: "Hero, áreas de práctica, equipo de abogados, por qué elegirnos, testimonios de clientes, contacto",
      cta: "Solicita una consulta gratuita",
      contact: "Formulario de contacto, teléfono y dirección del despacho",
      database: "none",
      language: "Español",
    },
  },
];

function toAnswers(d: Decalogue): Record<string, AnswerEntry> {
  const out: Record<string, AnswerEntry> = {};
  for (const [k, v] of Object.entries(d)) out[k] = { value: v, assumedByAI: false };
  return out;
}

const DEFAULT_TOKEN_BALANCE = 10_000_000;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

async function nextClientCode(): Promise<string> {
  const clients = await prisma.client.findMany({ select: { codCliente: true } });
  let max = 0;
  for (const c of clients) {
    const m = c.codCliente?.match(/^cli-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `cli-${pad2(max + 1)}`;
}

async function ensureClient(spec: LandingSpec) {
  const existing = await prisma.client.findFirst({ where: { name: spec.business } });
  if (existing) {
    console.log(`[landing] Cliente ya existe: ${spec.business} (${existing.codCliente ?? "sin código"})`);
    return;
  }
  const codCliente = await nextClientCode();
  await prisma.client.create({
    data: {
      name: spec.business,
      sector: spec.sector,
      codCliente,
      tokenBalance: DEFAULT_TOKEN_BALANCE,
      isActive: true,
    },
  });
  console.log(`[landing] Cliente creado: ${spec.business} → ${codCliente}`);
}

async function generateOne(spec: LandingSpec) {
  const project = await prisma.landingProject.findFirst({ where: { name: spec.projectName } });
  if (!project) {
    console.warn(`[landing] No existe LandingProject "${spec.projectName}" — saltando.`);
    return;
  }

  const answers = toAnswers(spec.decalogue);

  console.log(`[landing] (${spec.business}) construyendo prompt...`);
  const { generationPrompt } = await buildGenerationPrompts(answers);

  console.log(`[landing] (${spec.business}) generando archivos (STRONG_MODEL)...`);
  const result = await generateFiles(generationPrompt, "none");

  await prisma.landingProject.update({
    where: { id: project.id },
    data: {
      answers,
      business: spec.business,
      generationPrompt,
      dbProvider: "none",
      files: result.files,
      status: "generated",
    },
  });

  const fileNames = Object.keys(result.files);
  console.log(`[landing] (${spec.business}) OK → ${fileNames.length} archivos: ${fileNames.join(", ")}${result.truncated ? " [TRUNCADO]" : ""}`);
}

async function main() {
  await refreshModelConfig().catch(() => {});
  const only = process.env.ONLY; // filtra por projectName si se define
  const specs = only ? SPECS.filter((s) => s.projectName === only) : SPECS;
  for (const spec of specs) {
    await ensureClient(spec);
    await generateOne(spec);
  }
  console.log("[landing] Proceso completo.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[landing] ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
