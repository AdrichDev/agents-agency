/**
 * Fills the four sectoral mocks with a believable week of bookings.
 *
 * Why: the mocks had an empty diary. A demo agenda with nothing in it proves neither that the
 * booking path works nor that the resource inventory is being used, and it reads as a broken
 * product to anyone opening the panel.
 *
 * Bookings go through `createAppointment`, the SAME path the agent tool uses, and the slots
 * come from `computeAvailableSlots`. Nothing is inserted by hand: every booking here is one a
 * customer could have made, it occupies a real resource, and it respects capacity, turno and
 * buffer. If a slot is taken between the read and the write, the booking is skipped rather
 * than forced.
 *
 * Marked as demo data by `notes` and by the `@example.com` contact domain, which is what
 * `--teardown` deletes. No notification is dispatched: this calls the booking library, not the
 * agent adapter, so nothing leaves the platform.
 *
 * Run:       npx tsx scripts/seed-mock-bookings.ts
 * Teardown:  npx tsx scripts/seed-mock-bookings.ts --teardown
 */
import "dotenv/config";
import { DateTime } from "luxon";
import { prisma } from "../src/lib/db";
import { computeAvailableSlots, createAppointment } from "../src/lib/booking/appointments";

/** Marca de agua de los datos de demostración: por aquí los encuentra el teardown. */
const MARCA = "Reserva de demostración (mock sectorial)";
const TZ = "Europe/Madrid";

/** Clientes ficticios. Dominio `example.com`, reservado por RFC 2606: no existe ni existirá. */
const CLIENTES = [
  { nombre: "Ana Serrano", email: "ana.serrano@example.com", telefono: "+34 600 100 101" },
  { nombre: "Diego Fuentes", email: "diego.fuentes@example.com", telefono: "+34 600 100 102" },
  { nombre: "Marta Ibáñez", email: "marta.ibanez@example.com", telefono: "+34 600 100 103" },
  { nombre: "Carlos Rey", email: "carlos.rey@example.com", telefono: "+34 600 100 104" },
  { nombre: "Lucía Prat", email: "lucia.prat@example.com", telefono: "+34 600 100 105" },
  { nombre: "Javier Olmo", email: "javier.olmo@example.com", telefono: "+34 600 100 106" },
  { nombre: "Elena Vidal", email: "elena.vidal@example.com", telefono: "+34 600 100 107" },
  { nombre: "Pablo Cid", email: "pablo.cid@example.com", telefono: "+34 600 100 108" },
  { nombre: "Nuria Alonso", email: "nuria.alonso@example.com", telefono: "+34 600 100 109" },
  { nombre: "Iván Bravo", email: "ivan.bravo@example.com", telefono: "+34 600 100 110" },
  { nombre: "Sara Domingo", email: "sara.domingo@example.com", telefono: "+34 600 100 111" },
  { nombre: "Hugo Lasa", email: "hugo.lasa@example.com", telefono: "+34 600 100 112" },
];

/**
 * Cuántas reservas y de qué tamaño por cliente mock. Los grupos son los que de verdad se ven
 * en cada negocio: un restaurante llena de parejas y mesas de cuatro, una barbería reserva de
 * uno en uno.
 */
const PLAN: Record<string, { porServicio: number; grupos: number[] }> = {
  "Brasserie Lafayette": { porServicio: 6, grupos: [2, 2, 4, 2, 6, 4] },
  "Casa Mendieta": { porServicio: 5, grupos: [2, 4, 2, 6, 2] },
  "Barbería Núñez": { porServicio: 4, grupos: [1, 1, 1, 1] },
  "Estética Aurea": { porServicio: 3, grupos: [1, 1, 1] },
};

/** Ventana de siembra: de mañana a diez días vista. Nada en el pasado, nada a un mes. */
function ventana() {
  const desde = DateTime.now().setZone(TZ).plus({ days: 1 }).startOf("day");
  return { desde: desde.toJSDate(), hasta: desde.plus({ days: 10 }).endOf("day").toJSDate() };
}

async function sembrar() {
  let indiceCliente = 0;
  for (const [nombreCliente, plan] of Object.entries(PLAN)) {
    const tenant = await prisma.tenant.findFirst({
      where: { name: nombreCliente },
      select: { codigo: true, agents: { select: { id: true, name: true } } },
    });
    const agent = tenant?.agents[0];
    if (!agent) {
      console.log(`SKIP  ${nombreCliente}: sin agente`);
      continue;
    }
    const servicios = await prisma.service.findMany({
      where: { agentId: agent.id, enabled: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    let creadas = 0;
    let saltadas = 0;
    for (const servicio of servicios) {
      for (let i = 0; i < plan.porServicio; i++) {
        const grupo = plan.grupos[i % plan.grupos.length]!;
        const rango = ventana();
        const libres = await computeAvailableSlots(servicio.id, rango, prisma, grupo);
        if (libres.length === 0) {
          saltadas++;
          continue;
        }
        // Reparto determinista a lo ancho de la ventana: sin `Math.random`, para que dos
        // ejecuciones sobre la misma agenda elijan lo mismo y el resultado sea reproducible.
        const elegido = libres[Math.floor((i * libres.length) / plan.porServicio) % libres.length]!;
        const cliente = CLIENTES[indiceCliente++ % CLIENTES.length]!;
        try {
          await createAppointment({
            serviceId: servicio.id,
            slotStart: new Date(elegido.startTime),
            slotEnd: new Date(elegido.endTime),
            customerName: cliente.nombre,
            email: cliente.email,
            phone: cliente.telefono,
            partySize: grupo,
            notes: MARCA,
          });
          creadas++;
        } catch {
          // Carrera con otra reserva de esta misma pasada: se salta, no se fuerza.
          saltadas++;
        }
      }
    }
    console.log(
      `${(tenant?.codigo ?? "-").padEnd(7)} ${nombreCliente.padEnd(22)} servicios=${servicios.length} ` +
      `reservas=${creadas} saltadas=${saltadas}`
    );
  }
}

/** Borra las reservas de demostración y libera sus franjas. Solo toca las marcadas. */
async function teardown() {
  const citas = await prisma.appointment.findMany({
    where: { notes: MARCA },
    select: { id: true, slotId: true },
  });
  const slotIds = citas.map((c) => c.slotId).filter((s): s is string => Boolean(s));
  await prisma.appointment.deleteMany({ where: { notes: MARCA } });
  if (slotIds.length > 0) await prisma.timeSlot.deleteMany({ where: { id: { in: slotIds } } });
  console.log(`TEARDOWN: ${citas.length} reserva(s) y ${slotIds.length} franja(s) borradas`);
}

if (process.argv.includes("--teardown")) await teardown();
else await sembrar();

await prisma.$disconnect();
