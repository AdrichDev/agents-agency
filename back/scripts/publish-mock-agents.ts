/**
 * Publishes the four sectoral mock agents so they are servable in production.
 *
 * Why a script and not a click: publication is a state transition with preconditions and an
 * audit event (`AgentStatusEvent`). Flipping `estado` by hand would leave the history empty
 * and skip the checks. This goes through `transitionAgentStatus` and
 * `checkPublishPreconditions`, the same path the panel uses.
 *
 * A `draft` agent is masked by `/api/widget/config` with a 404 on purpose, so until this runs
 * the mocks cannot be tried from the public site.
 *
 * Run:        npx tsx scripts/publish-mock-agents.ts
 * Unpublish:  npx tsx scripts/publish-mock-agents.ts --unpublish
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { checkPublishPreconditions, transitionAgentStatus } from "../src/lib/agent/lifecycle";

const MOCKS = ["Brasserie Lafayette", "Barbería Núñez", "Estética Aurea", "Casa Mendieta"];

const destino = process.argv.includes("--unpublish") ? "draft" : "published";

for (const nombre of MOCKS) {
  const tenant = await prisma.tenant.findFirst({
    where: { name: nombre },
    select: {
      codigo: true,
      agents: {
        select: {
          id: true, name: true, status: true, tenantId: true, systemPrompt: true, channel: true,
          publicKey: true,
          channelConnections: { select: { provider: true } },
        },
      },
    },
  });
  if (!tenant) {
    console.log(`SKIP  ${nombre}: no existe como cliente`);
    continue;
  }
  for (const agent of tenant.agents) {
    if (destino === "published") {
      const { blocking, warnings } = checkPublishPreconditions(agent);
      if (blocking.length > 0) {
        console.log(`BLOQ  ${nombre}: ${blocking.join(" ")}`);
        continue;
      }
      for (const w of warnings) console.log(`AVISO ${nombre}: ${w}`);
    }
    const { changed } = await transitionAgentStatus(agent.id, destino, {
      actor: "system",
      reason: "Mock sectorial: alta de demostración en producción",
    });
    console.log(
      `${changed ? "CAMBIO" : "IGUAL "} ${(tenant.codigo ?? "-").padEnd(7)} ${agent.name.padEnd(20)} ` +
      `${agent.status} → ${destino} | publicKey=${agent.publicKey}`
    );
  }
}

await prisma.$disconnect();
