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
  // Pool pg dimensionable por entorno: evita agotar conexiones bajo carga y
  // libera las ociosas. Defaults razonables para single-instance.
  //
  // schema = aa: el driver-adapter (@prisma/adapter-pg) NO interpreta el `?schema=aa`
  // del connection string, y el session pooler (Supavisor) ignora la opción libpq
  // `-c search_path`. En Supabase las tablas de AA viven en el schema `aa`, así que
  // usamos la opción `schema` del adapter, que CUALIFICA las queries generadas a
  // `aa.<tabla>`. Sin esto Prisma consulta `public.User` y falla con P2021.
  const adapter = new PrismaPg(
    {
      connectionString,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS ?? 10000),
    },
    { schema: process.env.DB_SCHEMA ?? "aa" },
  );
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
