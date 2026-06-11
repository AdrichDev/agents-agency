import { prisma } from "@/lib/db";
import { saveChunk } from "@/lib/embeddings";

export type DuplicatePolicy = "ask" | "overwrite" | "suffix";

export function nextDuplicateSource(source: string, existingSources: string[]): string {
  let index = 1;
  let candidate = `${source}_${index}`;
  while (existingSources.includes(candidate)) {
    index++;
    candidate = `${source}_${index}`;
  }
  return candidate;
}

export async function findDuplicateChunk(agentId: string, source: string, content: string) {
  return prisma.knowledgeChunk.findFirst({
    where: {
      agentId,
      source,
      content,
    },
  });
}

export async function saveChunkWithDuplicatePolicy(
  agentId: string,
  source: string,
  content: string,
  policy: DuplicatePolicy
): Promise<"saved" | "duplicate"> {
  const duplicate = await findDuplicateChunk(agentId, source, content);
  if (!duplicate) {
    await saveChunk(agentId, source, content);
    return "saved";
  }

  if (policy === "ask") return "duplicate";

  if (policy === "overwrite") {
    await prisma.knowledgeChunk.deleteMany({ where: { agentId, source, content } });
    await saveChunk(agentId, source, content);
    return "saved";
  }

  const existing = await prisma.knowledgeChunk.findMany({
    where: { agentId, source: { startsWith: `${source}_` } },
    select: { source: true },
  });
  await saveChunk(agentId, nextDuplicateSource(source, existing.map((item) => item.source)), content);
  return "saved";
}
