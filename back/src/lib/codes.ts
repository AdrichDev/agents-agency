import { prisma } from "@/lib/db";

/**
 * Códigos de negocio secuenciales: cli-01, cli-02... / pc-01, pc-02...
 * Padding a 2 dígitos; a partir de 100 el número crece sin truncar (cli-100).
 */

export type CodePrefix = "cli" | "pc";

/** Extrae el número de un código "cli-07" → 7. Devuelve null si no encaja con el prefijo. */
export function parseCodeNumber(code: string, prefix: CodePrefix): number | null {
  const match = code.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** Calcula el siguiente código a partir de los existentes (función pura, testeable). */
export function computeNextCode(existingCodes: Array<string | null>, prefix: CodePrefix): string {
  let max = 0;
  for (const code of existingCodes) {
    if (!code) continue;
    const n = parseCodeNumber(code, prefix);
    if (n !== null && n > max) max = n;
  }
  const next = max + 1;
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

/** Lookup del máximo actual en BD y siguiente código para clientes. */
export async function nextClientCode(): Promise<string> {
  const rows = await prisma.client.findMany({
    where: { codCliente: { not: null } },
    select: { codCliente: true },
  });
  return computeNextCode(rows.map((r) => r.codCliente), "cli");
}

/** Lookup del máximo actual en BD y siguiente código para contactos. */
export async function nextContactCode(): Promise<string> {
  const rows = await prisma.prospectContact.findMany({ select: { codigo: true } });
  return computeNextCode(rows.map((r) => r.codigo), "pc");
}

/**
 * Ejecuta una creación que depende de un código secuencial, reintentando si otro
 * proceso ganó la carrera (violación de unique P2002). Suficiente para el volumen
 * de esta app: el índice unique garantiza que nunca se duplica un código.
 */
export async function withCodeRetry<T>(
  create: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await create();
    } catch (e: any) {
      lastError = e;
      if (e?.code !== "P2002") throw e;
      // Código duplicado por carrera → recalcular y reintentar
    }
  }
  throw lastError;
}
