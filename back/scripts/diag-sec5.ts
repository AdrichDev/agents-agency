/**
 * Diagnóstico de SEC5 (`aa-agente-no-inventa-datos-ni-politicas`, T0).
 *
 * SEC5 dio 0/3 en la corrida de T0, pero los tres fallos apuntan a sitios distintos: "no queda
 * hueco" justo después de limpiar la hora, una cita que aterriza a las 11:30 en vez de a las
 * 11:00, y un aviso de cierre por vacaciones. Ninguno de esos tres es "el modelo inventa".
 *
 * Antes de escribir un veredicto hay que saber qué hay REALMENTE en la base: cuántas cabinas
 * sirven Manicura, qué franjas existen ese día, cuáles están ocupadas y por qué cita. Este guion
 * sólo LEE.
 */
import "dotenv/config";
import { DateTime } from "luxon";
import { prisma } from "../src/lib/db";

const TZ = "Europe/Madrid";
const DIA = process.argv[2] ?? "2026-09-03";

async function main() {
  const agent = await prisma.agent.findFirst({
    where: { tenant: { name: { contains: "Aurea", mode: "insensitive" } } },
    select: { id: true, name: true, tenant: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!agent) throw new Error("agente de Aurea no encontrado");
  console.log(`Agente: ${agent.name} (${agent.id}) · tenant ${agent.tenant?.name}\n`);

  const servicios = await prisma.service.findMany({
    where: { agentId: agent.id },
    select: {
      id: true,
      name: true,
      duration: true,
      enabled: true,
      maxPartySize: true,
      schedule: true,
      resources: { select: { resource: { select: { name: true, enabled: true, capacityMin: true, capacityMax: true } } } },
    },
  });
  console.log("SERVICIOS:");
  for (const s of servicios) {
    const cabinas = s.resources.map((r) => `${r.resource.name}${r.resource.enabled ? "" : " (APAGADO)"}`);
    console.log(
      `  · ${s.name} — ${s.duration} min · activo=${s.enabled} · maxPartySize=${s.maxPartySize}` +
        ` · recursos: ${cabinas.join(", ") || "NINGUNO"}`
    );
    if (/manicura/i.test(s.name)) console.log(`    horario: ${JSON.stringify(s.schedule)}`);
  }

  const manicura = servicios.find((s) => /manicura/i.test(s.name));
  if (!manicura) {
    console.log("\n✖ no hay servicio 'Manicura': SEC5 no se puede plantear sobre este agente.");
    return;
  }

  const desde = DateTime.fromISO(`${DIA}T00:00`, { zone: TZ }).toUTC().toJSDate();
  const hasta = DateTime.fromISO(`${DIA}T23:59`, { zone: TZ }).toUTC().toJSDate();

  const slots = await prisma.timeSlot.findMany({
    where: { serviceId: manicura.id, startTime: { gte: desde, lte: hasta } },
    select: {
      id: true,
      startTime: true,
      available: true,
      resource: { select: { name: true } },
      appointment: { select: { id: true, status: true, customerName: true, startTime: true } },
    },
    orderBy: [{ startTime: "asc" }],
  });

  console.log(`\nFRANJAS DE MANICURA EL ${DIA} (${slots.length}):`);
  for (const s of slots) {
    const hora = DateTime.fromJSDate(s.startTime).setZone(TZ).toFormat("HH:mm");
    const cita = s.appointment
      ? ` ← cita ${s.appointment.status} de ${s.appointment.customerName}`
      : "";
    console.log(`  ${hora}  ${s.resource.name.padEnd(14)} disponible=${s.available}${cita}`);
  }

  const citas = await prisma.appointment.findMany({
    where: { service: { agentId: agent.id }, startTime: { gte: desde, lte: hasta } },
    select: { id: true, status: true, customerName: true, startTime: true, service: { select: { name: true } } },
    orderBy: { startTime: "asc" },
  });
  console.log(`\nCITAS DEL AGENTE EL ${DIA} (${citas.length}):`);
  for (const c of citas) {
    const hora = DateTime.fromJSDate(c.startTime).setZone(TZ).toFormat("HH:mm");
    console.log(`  ${hora}  ${c.status.padEnd(10)} ${c.service.name.padEnd(12)} ${c.customerName}`);
  }

  // El "cerrado del 10 al 24 de agosto" de la repetición 3 sale de algún sitio: o del horario
  // del agente, o de un chunk indexado. Si es un dato real, el escenario está plantado encima
  // de unas vacaciones y SEC5 no mide lo que cree medir.
  const conocimiento = await prisma.knowledgeChunk.findMany({
    where: { agentId: agent.id, content: { contains: "agosto", mode: "insensitive" } },
    select: { content: true, source: true },
    take: 5,
  });
  console.log(`\nCHUNKS QUE MENCIONAN "agosto" (${conocimiento.length}):`);
  for (const k of conocimiento) {
    console.log(`  · [${k.source}] ${k.content.slice(0, 260).replace(/\s+/g, " ")}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
