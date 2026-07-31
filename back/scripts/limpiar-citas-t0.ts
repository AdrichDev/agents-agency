/**
 * Cancela las citas que dejan las corridas de T0 en los tenants mock.
 *
 * Los guiones de medición hablan con el agente de verdad, así que crean citas de verdad. Cuando
 * una corrida se corta a medias —o el bot coloca la cita a una hora distinta de la pedida— esas
 * filas se quedan vivas ocupando recurso y contaminan la medición siguiente.
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/limpiar-citas-t0.ts <fragmento-tenant> <YYYY-MM-DD>
 *
 * ESCRIBE: pasa a `cancelled` las citas del día y devuelve sus franjas a disponible. Sólo actúa
 * sobre el tenant que se le nombre; no hay valor por defecto a propósito.
 */
import "dotenv/config";
import { DateTime } from "luxon";
import { prisma } from "../src/lib/db";
import { cancelAppointment } from "../src/lib/booking/appointments";

const TZ = "Europe/Madrid";

async function main() {
  const [tenant, dia] = process.argv.slice(2);
  if (!tenant || !dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    console.error("uso: limpiar-citas-t0.ts <fragmento-tenant> <YYYY-MM-DD>");
    process.exit(1);
  }

  const agent = await prisma.agent.findFirst({
    where: { tenant: { name: { contains: tenant, mode: "insensitive" } } },
    select: { id: true, name: true, tenant: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!agent) throw new Error(`agente de "${tenant}" no encontrado`);

  const desde = DateTime.fromISO(`${dia}T00:00`, { zone: TZ }).toUTC().toJSDate();
  const hasta = DateTime.fromISO(`${dia}T23:59`, { zone: TZ }).toUTC().toJSDate();

  const citas = await prisma.appointment.findMany({
    where: { service: { agentId: agent.id }, status: "scheduled", startTime: { gte: desde, lte: hasta } },
    select: { id: true, slotId: true, customerName: true, startTime: true },
    orderBy: { startTime: "asc" },
  });

  console.log(`${agent.tenant?.name} · ${dia} — ${citas.length} citas vivas`);

  // Se usa la cancelación del producto: BORRA la franja. Una versión casera que se limitaba a
  // poner `available: true` dejaba la fila viva y quemaba el par (recurso, instante), porque
  // `createAppointment` siempre inserta una franja nueva y el unique es `(recurso, inicio)`.
  for (const c of citas) {
    const hora = DateTime.fromJSDate(c.startTime).setZone(TZ).toFormat("HH:mm");
    console.log(`  cancelando ${hora} · ${c.customerName}`);
    await cancelAppointment(c.id);
  }

  // Barrido de las fantasmas que dejó esa versión casera: franjas cuya cita ya está cancelada.
  // En el producto no existen —cancelar borra la franja—, así que sólo pueden venir de un
  // guion. Mientras estén, el instante se ofrece como libre y la reserva muere en P2002.
  const desdeD = DateTime.fromISO(`${dia}T00:00`, { zone: TZ }).toUTC().toJSDate();
  const hastaD = DateTime.fromISO(`${dia}T23:59`, { zone: TZ }).toUTC().toJSDate();
  const fantasmas = await prisma.timeSlot.findMany({
    where: {
      service: { agentId: agent.id },
      startTime: { gte: desdeD, lte: hastaD },
      appointment: { status: "cancelled" },
    },
    select: { id: true, startTime: true, resource: { select: { name: true } } },
  });
  for (const f of fantasmas) {
    const hora = DateTime.fromJSDate(f.startTime).setZone(TZ).toFormat("HH:mm");
    console.log(`  borrando franja fantasma ${hora} · ${f.resource.name}`);
  }
  if (fantasmas.length) {
    await prisma.timeSlot.deleteMany({ where: { id: { in: fantasmas.map((f) => f.id) } } });
  }

  console.log(`✓ ${citas.length} citas canceladas · ${fantasmas.length} franjas fantasma borradas`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
