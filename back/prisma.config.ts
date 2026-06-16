import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts", // se ejecuta tras `prisma migrate reset`
  },
  datasource: { url: env("DATABASE_URL") },
});
