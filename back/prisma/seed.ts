/**
 * Seed idempotente: recrea el usuario admin tras cada `prisma migrate reset`.
 *
 * Las credenciales se leen de variables de entorno (.env, gitignored) para no
 * hardcodearlas en el repo. Si no están definidas, usa los valores por defecto
 * del admin del proyecto. La contraseña se guarda cifrada con bcrypt.
 *
 * Variables opcionales en .env:
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_FIRSTNAME, SEED_ADMIN_LASTNAME
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "achozas9@gmail.com").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Adrichozas.89";
  const firstName = process.env.SEED_ADMIN_FIRSTNAME ?? "Adrian";
  const lastName = process.env.SEED_ADMIN_LASTNAME ?? "Chozas";

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: { firstName, lastName, passwordHash, role: "admin" },
    create: { firstName, lastName, email, passwordHash, role: "admin" },
  });

  console.log(`[seed] Usuario admin listo: ${user.email}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[seed] Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
