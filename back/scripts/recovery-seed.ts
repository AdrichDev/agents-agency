/**
 * recovery-seed.ts — Reconstrucción tras el reset:
 *   1. Asigna codCliente secuencial (cli-01..) a los clientes recuperados sin código.
 *   2. Crea 20 contactos de prueba (pc-01..pc-20).
 *   3. Crea 3 LandingProject base (calcetines deportivos, centro estética, bufete).
 *
 * Idempotente en lo posible: no duplica codCliente ni pisa contactos/landings ya existentes
 * por nombre. Ejecutar: npx tsx scripts/recovery-seed.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

async function assignClientCodes() {
  const clients = await prisma.client.findMany({ orderBy: { createdAt: "asc" } });
  // máximo código existente
  let max = 0;
  for (const c of clients) {
    const m = c.codCliente?.match(/^cli-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let assigned = 0;
  for (const c of clients) {
    if (c.codCliente) continue;
    max += 1;
    await prisma.client.update({ where: { id: c.id }, data: { codCliente: `cli-${pad2(max)}` } });
    assigned++;
    console.log(`[recovery] Cliente "${c.name}" → cli-${pad2(max)}`);
  }
  console.log(`[recovery] codCliente asignados: ${assigned}`);
}

async function seedContacts() {
  const sectores = ["E-commerce", "Salud", "Educación", "Deportes", "Legal", "Hostelería", "Inmobiliaria", "Otro"];
  const nombres = [
    "Laura Gómez", "Carlos Ruiz", "Ana Martín", "Javier López", "María Sánchez",
    "Diego Fernández", "Lucía Torres", "Pablo Díaz", "Sara Moreno", "Hugo Jiménez",
    "Elena Navarro", "Marcos Romero", "Paula Alonso", "Sergio Gil", "Cristina Vega",
    "Adrián Castro", "Noelia Ramos", "Iván Ortega", "Marta Flores", "Rubén Cano",
  ];

  // Próximo código pc-NN
  const existing = await prisma.prospectContact.findMany({ select: { codigo: true } });
  let max = 0;
  for (const { codigo } of existing) {
    const m = codigo?.match(/^pc-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }

  let created = 0;
  for (let i = 0; i < nombres.length; i++) {
    const name = nombres[i];
    const dup = await prisma.prospectContact.findFirst({ where: { name, deletedAt: null } });
    if (dup) continue;
    max += 1;
    const slug = name.toLowerCase().replace(/[^a-z]/g, ".");
    await prisma.prospectContact.create({
      data: {
        codigo: `pc-${pad2(max)}`,
        type: i % 3 === 0 ? "lead" : "prospecto",
        name,
        phone: `6${pad2(i)}${pad2(i)}${pad2(i)}${pad2(i)}`.slice(0, 9),
        email: `${slug}@ejemplo.com`,
        sector: sectores[i % sectores.length],
        peticion: "Contacto de prueba generado en reconstrucción.",
      },
    });
    created++;
  }
  console.log(`[recovery] Contactos de prueba creados: ${created}`);
}

async function seedLandings() {
  const landings = [
    {
      name: "Calcetines Deportivos",
      business: "SportSocks",
      sector: "E-commerce",
      desc: "Tienda online de calcetines deportivos técnicos de alto rendimiento.",
    },
    {
      name: "Centro de Estética",
      business: "Belle Estética",
      sector: "Salud y belleza",
      desc: "Centro de estética: tratamientos faciales, corporales y depilación láser.",
    },
    {
      name: "Bufete de Abogados",
      business: "Lex & Asociados",
      sector: "Legal",
      desc: "Bufete de abogados: derecho civil, mercantil, laboral y penal.",
    },
  ];

  let created = 0;
  for (const l of landings) {
    const dup = await prisma.landingProject.findFirst({ where: { name: l.name } });
    if (dup) continue;
    await prisma.landingProject.create({
      data: {
        name: l.name,
        business: l.business,
        status: "draft",
        answers: {
          businessName: { value: l.business },
          sector: { value: l.sector },
          description: { value: l.desc },
        },
      },
    });
    created++;
    console.log(`[recovery] Landing base creada: "${l.name}" (${l.business})`);
  }
  console.log(`[recovery] Landings base creadas: ${created}`);
}

async function main() {
  console.log("── Reconstrucción post-reset ──");
  await assignClientCodes();
  await seedContacts();
  await seedLandings();
  console.log("[recovery] Hecho.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[recovery] ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
