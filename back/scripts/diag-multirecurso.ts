/**
 * ¿Sigue ofertándose una hora cuando UNA de las dos cabinas que la sirven ya está ocupada?
 *
 * SEC5 falló 0/3 sobre un escenario limpio, y el bot decía "se ha ocupado ese hueco" con CERO
 * citas en la base. Las franjas de `TimeSlot` no están pregeneradas —se crean al reservar—, así
 * que mirar la tabla no responde nada: hay que preguntárselo a `computeAvailableSlots`, que es
 * quien alimenta la tool del agente.
 *
 * Mide en tres tiempos sobre Manicura (2 cabinas):
 *   1. hueco a las 11:00 con el día vacío,
 *   2. hueco a las 11:00 tras ocupar UNA cabina,
 *   3. hueco a las 11:00 tras ocupar LAS DOS.
 *
 * Si el paso 2 deja de ofrecer las 11:00, la disponibilidad colapsa por instante en vez de por
 * recurso y el agente no puede sentar a dos personas a la misma hora aunque haya sitio.
 *
 * ESCRIBE: crea hasta dos citas de prueba y las cancela al terminar, pase lo que pase.
 */
import "dotenv/config";
import { DateTime } from "luxon";
import { prisma } from "../src/lib/db";
import { cancelAppointment, computeAvailableSlots, createAppointment } from "../src/lib/booking/appointments";

const TZ = "Europe/Madrid";
const DIA = process.argv[2] ?? "2026-09-03";
const HORA = "11:00";

function instante(): Date {
  return DateTime.fromISO(`${DIA}T${HORA}`, { zone: TZ }).toUTC().toJSDate();
}

async function huecoALas11(serviceId: string): Promise<boolean> {
  const desde = DateTime.fromISO(`${DIA}T00:00`, { zone: TZ }).toUTC().toJSDate();
  const hasta = DateTime.fromISO(`${DIA}T23:59`, { zone: TZ }).toUTC().toJSDate();
  const slots = await computeAvailableSlots(serviceId, { desde, hasta });
  const objetivo = instante().getTime();
  const alas11 = slots.filter((s) => new Date(s.startTime).getTime() === objetivo);
  const horas = slots
    .slice(0, 8)
    .map((s) => DateTime.fromJSDate(new Date(s.startTime)).setZone(TZ).toFormat("HH:mm"));
  console.log(`      ofertadas ${slots.length} franjas · primeras: ${horas.join(" ")}`);
  console.log(`      a las ${HORA}: ${alas11.length} franja(s)`);
  return alas11.length > 0;
}

async function main() {
  const agent = await prisma.agent.findFirst({
    where: { tenant: { name: { contains: "Aurea", mode: "insensitive" } } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!agent) throw new Error("agente de Aurea no encontrado");

  const svc = await prisma.service.findFirst({
    where: { agentId: agent.id, name: { contains: "Manicura", mode: "insensitive" } },
    select: { id: true, name: true, duration: true, resources: { select: { resourceId: true } } },
  });
  if (!svc) throw new Error("servicio Manicura no encontrado");
  console.log(`Servicio: ${svc.name} · ${svc.duration} min · ${svc.resources.length} cabinas · ${DIA} ${HORA}\n`);

  const creadas: string[] = [];
  try {
    console.log("[1] día vacío");
    const paso1 = await huecoALas11(svc.id);

    const inicio = instante();
    const fin = DateTime.fromJSDate(inicio).plus({ minutes: svc.duration }).toJSDate();

    console.log("\n[2] tras ocupar UNA cabina");
    const c1 = await createAppointment({
      serviceId: svc.id,
      slotStart: inicio,
      slotEnd: fin,
      partySize: 1,
      phone: "+34 600 00 00 01",
      customerName: "Diagnóstico Uno",
      notes: "Fixture diag-multirecurso. Se cancela al terminar.",
    });
    creadas.push(c1.appointmentId);
    console.log(`      cabina asignada: ${c1.resource.name}`);
    const paso2 = await huecoALas11(svc.id);

    console.log("\n[3] tras ocupar LAS DOS");
    let paso3: boolean | null = null;
    try {
      const c2 = await createAppointment({
        serviceId: svc.id,
        slotStart: inicio,
        slotEnd: fin,
        partySize: 1,
        phone: "+34 600 00 00 02",
        customerName: "Diagnóstico Dos",
        notes: "Fixture diag-multirecurso. Se cancela al terminar.",
      });
      creadas.push(c2.appointmentId);
      console.log(`      cabina asignada: ${c2.resource.name}`);
      paso3 = await huecoALas11(svc.id);
    } catch (e) {
      console.log(`      la segunda reserva FALLÓ: ${(e as Error).message}`);
    }

    console.log("\n══ VEREDICTO ══");
    console.log(`  día vacío ofrece ${HORA}: ${paso1 ? "SÍ" : "NO"}`);
    console.log(`  con 1 de 2 cabinas ocupadas ofrece ${HORA}: ${paso2 ? "SÍ" : "NO"}`);
    console.log(`  se pudo reservar la SEGUNDA a la misma hora: ${creadas.length === 2 ? "SÍ" : "NO"}`);
    if (paso3 !== null) console.log(`  con 2 de 2 ocupadas ofrece ${HORA}: ${paso3 ? "SÍ (mal)" : "NO (bien)"}`);
    if (paso1 && !paso2) {
      console.log("\n  ⇒ La hora desaparece al ocupar UNA sola cabina: la disponibilidad colapsa");
      console.log("    por instante y no por recurso. Dos personas no pueden coincidir.");
    }
  } finally {
    // Cancelación del producto: borra la franja. Marcarla `available: true` a mano dejaría la
    // fila y el par (cabina, instante) quedaría quemado para la siguiente medición.
    for (const id of creadas) await cancelAppointment(id);
    if (creadas.length) {
      console.log(`\n· limpieza: ${creadas.length} citas de diagnóstico canceladas`);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
