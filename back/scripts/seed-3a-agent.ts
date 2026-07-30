/**
 * The agency's own agent (`openspec/changes/aa-widget-3a-en-su-propia-web`, T1.2).
 *
 * 3A Estudio sells AI agents and, until this script ran, did not have one answering on its
 * own landing. This creates it as a tenant of its own platform: same tables, same seeding
 * pattern as the sector mocks in `seed-mock-tenants.ts`, so the agency eats what it cooks.
 *
 * Differences from the mocks, all deliberate:
 *
 *  - `status: "published"`. The mocks stay in `draft` because they must not answer the
 *    public widget; this one exists precisely to answer it.
 *  - `capabilities: ["leads"]` and no `reservas`: the agency takes no bookings, so it gets
 *    no resources, no services and no schedule. A booking tool it cannot honour would only
 *    give the visitor a promise nobody is going to keep.
 *  - Knowledge from local fixtures, never from scraping the site: the landing is a
 *    `"use client"` React page, so fetching it returns the shell and not the copy.
 *
 * Billing: no plan and no Stripe ids, with an explicit `tokenBalance` because the metering
 * is fail-closed and an agent whose quota does not resolve is a dead agent.
 *
 * Usage (`-r dotenv/config` is required: `src/lib/db.ts` throws if `DATABASE_URL` is unset):
 *   npx tsx -r dotenv/config scripts/seed-3a-agent.ts               # tenant + agent
 *   npx tsx -r dotenv/config scripts/seed-3a-agent.ts --knowledge   # + ingest ($$)
 *   npx tsx -r dotenv/config scripts/seed-3a-agent.ts --teardown    # remove it
 *
 * `--knowledge` is opt-in for the same reason as in `seed-mock-tenants.ts`: re-seeding the
 * structure is free and idempotent, embedding the fixtures costs tokens.
 */

import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/db";
import { chunkText } from "../src/lib/embeddings";
import { nextClientCode, withCodeRetry } from "../src/lib/codes";
import { saveChunkWithDuplicatePolicy } from "../src/lib/knowledge-duplicates";

const TENANT_NAME = "3A Estudio";
const AGENT_NAME = "3A Estudio";

/**
 * Anclado con `import.meta.url` y no con `__dirname`: el paquete es ESM y bajo `tsx`
 * `__dirname` no apunta a este fichero (mismo motivo que en `seed-mock-tenants.ts`).
 */
const FIXTURES_ROOT = new URL(
  "../../openspec/changes/aa-widget-3a-en-su-propia-web/fixtures/3a-estudio/",
  import.meta.url
);

const FIXTURES = ["servicios.md", "proceso.md", "identidad-y-contacto.md"];

const SYSTEM_PROMPT = [
  "Eres el asistente de 3A Estudio, una agencia que crea agentes de inteligencia artificial",
  "para negocios. Hablas de tú, en español, con frases cortas y sin relleno: el mismo tono",
  "que la web.",
  "",
  "Tu trabajo es doble y en este orden:",
  "1. Explicar qué hace 3A Estudio, cómo trabaja y qué puede resolverle a quien pregunta,",
  "   usando SIEMPRE el conocimiento del negocio.",
  "2. Cuando la persona muestre interés, pedirle nombre y un canal de contacto (email o",
  "   teléfono) y registrarlo como lead. Pídelo una sola vez y sin insistir.",
  "",
  "Límites que no cruzas:",
  "- NUNCA das precios, tarifas ni rangos de precio. No están publicados y dependen del",
  "  alcance. Di que se presupuesta tras el análisis inicial y ofrece dejar el contacto.",
  "- NUNCA prometes plazos concretos ni cierras compromisos. La web dice 'listo en días' y",
  "  eso es todo lo que puedes decir.",
  "- Si algo no está en el conocimiento del negocio, dilo con naturalidad y ofrece el",
  "  correo o el teléfono de contacto. No improvises.",
  "",
  "Eres la demostración del producto que vendes: si respondes mal, la venta se cae. Breve,",
  "concreto y útil desde el primer mensaje.",
].join("\n");

// ── Seed ────────────────────────────────────────────────────────────────────

async function seed(): Promise<string> {
  // Búsqueda por nombre y no por código: el re-seed debe conservar el `cli-NN` ya asignado
  // en vez de mintear uno nuevo en cada pasada.
  const existente = await prisma.tenant.findFirst({
    where: { name: TENANT_NAME },
    select: { id: true, codigo: true },
  });

  const datosCliente = {
    name: TENANT_NAME,
    sector: "tecnologia",
    email: "achozas9@gmail.com",
    phone: "635 984 010",
    website: "https://3aestudio.vercel.app",
    direccion: "Calle Aquiles, 25, 4.º H, Madrid, España",
    contactPerson: "Adrián Chozas Vinuesa",
    tokenBalance: 10_000_000,
    isActive: true,
  };

  const tenant = existente
    ? await withCodeRetry(async () =>
        prisma.tenant.update({
          where: { id: existente.id },
          data: {
            ...datosCliente,
            ...(existente.codigo?.startsWith("cli-") ? {} : { codigo: await nextClientCode() }),
          },
        })
      )
    : await withCodeRetry(async () =>
        prisma.tenant.create({ data: { codigo: await nextClientCode(), ...datosCliente } })
      );

  // `Agent` no tiene clave natural: se busca por (tenantId, nombre) y se crea si falta.
  const existing = await prisma.agent.findFirst({
    where: { tenantId: tenant.id, name: AGENT_NAME },
    select: { id: true, status: true },
  });

  const agentData = {
    name: AGENT_NAME,
    sector: "tecnologia",
    systemPrompt: SYSTEM_PROMPT,
    channel: "widget",
    widgetAvatarEmoji: "✦",
    // Los colores de la landing (`--accent-1` / `--accent-2` en `app/layout.tsx`).
    widgetPrimaryColor: "#6366f1",
    widgetSecondaryColor: "#d946ef",
    tenantId: tenant.id,
    status: "published",
  };

  const agent = existing
    ? await prisma.agent.update({
        where: { id: existing.id },
        data: {
          ...agentData,
          // `publishedAt` solo en la primera publicación: re-sembrar no es volver a publicar.
          ...(existing.status === "published" ? {} : { publishedAt: new Date(), statusChangedAt: new Date() }),
        },
      })
    : await prisma.agent.create({
        data: { ...agentData, publishedAt: new Date(), statusChangedAt: new Date() },
      });

  // `managed_db`: el lead cae en el CRM de la propia agencia. Sin `reservas`.
  await prisma.agentDataBackend.upsert({
    where: { agentId: agent.id },
    update: { mode: "managed_db", capabilities: ["leads"] },
    create: { agentId: agent.id, mode: "managed_db", capabilities: ["leads"] },
  });

  const full = await prisma.agent.findUniqueOrThrow({
    where: { id: agent.id },
    select: { id: true, publicKey: true, status: true },
  });

  console.log(
    `3A Estudio: tenant=${tenant.id} agent=${full.id} status=${full.status}\n` +
      `NEXT_PUBLIC_WIDGET_AGENT_KEY=${full.publicKey}`
  );
  return full.id;
}

// ── Conocimiento ────────────────────────────────────────────────────────────

async function ingestKnowledge(agentId: string): Promise<void> {
  // Purga previa: `duplicatePolicy: "overwrite"` deduplica contenido idéntico, no limpia la
  // fuente. Sin este borrado, editar un fixture deja vivos los chunks viejos al lado de los
  // nuevos y el agente responde con el texto antiguo para siempre.
  const purged = await prisma.knowledgeChunk.deleteMany({ where: { agentId } });
  if (purged.count > 0) console.log(`  purgados ${purged.count} chunks previos`);

  // Misma librería que usa `POST /knowledge/:agentId/files`; se evita el multipart porque
  // exigiría servidor levantado y sesión, y lo único que se salta es la copia del original
  // al bucket.
  for (const file of FIXTURES) {
    const text = await readFile(new URL(file, FIXTURES_ROOT), "utf8");
    let saved = 0;
    let duplicates = 0;
    for (const c of chunkText(text)) {
      const r = await saveChunkWithDuplicatePolicy(agentId, file, c, "overwrite");
      if (r === "duplicate") duplicates++;
      else saved++;
    }
    console.log(`  ${file} → ${saved} chunks (${duplicates} duplicados)`);
  }
}

// ── Teardown ────────────────────────────────────────────────────────────────

/**
 * Los agentes se borran ANTES que el tenant: `Agent.tenantId` es opcional, así que borrar
 * el tenant primero dejaría agentes huérfanos, que es justo lo que el fail-closed de
 * metering deja inservibles pero visibles en el panel.
 */
async function teardown(): Promise<void> {
  const tenant = await prisma.tenant.findFirst({
    where: { name: TENANT_NAME },
    select: { id: true, agents: { select: { id: true } } },
  });
  if (!tenant) {
    console.log("3A Estudio: no existe, nada que borrar");
    return;
  }
  for (const a of tenant.agents) await prisma.agent.delete({ where: { id: a.id } });
  await prisma.tenant.delete({ where: { id: tenant.id } });
  console.log(`3A Estudio: borrado (tenant + ${tenant.agents.length} agentes)`);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--teardown")) {
    await teardown();
    return;
  }
  const agentId = await seed();
  if (args.includes("--knowledge")) await ingestKnowledge(agentId);
  else console.log("\nConocimiento NO ingerido (pasa --knowledge para hacerlo).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
