/**
 * Crea (o actualiza) un usuario del SaaS con contraseña cifrada.
 * Uso: npm run create-user
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function main() {
  console.log("── Crear usuario de 3A Estudio ──");
  const firstName = (await rl.question("Nombre: ")).trim();
  const lastName = (await rl.question("Apellido: ")).trim();
  const email = (await rl.question("Email: ")).trim().toLowerCase();
  const password = (await rl.question("Contraseña: ")).trim();
  const roleInput = (await rl.question("Rol [admin]: ")).trim().toLowerCase();
  const role = roleInput || "admin";
  rl.close();

  if (!firstName || !email || password.length < 6) {
    console.error("✖ Nombre y email son obligatorios; la contraseña debe tener al menos 6 caracteres.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { firstName, lastName, passwordHash, role },
    create: { firstName, lastName, email, passwordHash, role },
  });

  console.log(`✔ Usuario ${user.email} (${user.role}) listo. Ya puedes entrar desde la landing.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("✖ Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
