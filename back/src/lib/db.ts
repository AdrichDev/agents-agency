import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not defined. Make sure the .env file is loaded before Prisma is initialized."
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// Getter lazy: el cliente se crea la primera vez que se accede, cuando dotenv ya cargó.
let _prisma: PrismaClient | undefined = globalForPrisma.prisma;

export const getPrisma = (): PrismaClient => {
  if (!_prisma) {
    _prisma = createClient();
    if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = _prisma;
  }
  return _prisma;
};

// Re-exportamos `prisma` como alias para no romper imports existentes.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return (getPrisma() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
