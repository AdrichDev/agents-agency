/**
 * T0 de `aa-agente-no-inventa-datos-ni-politicas`: medir el modelo ANTES de rediseñar el prompt.
 *
 * Las tres filas que inventaron en la matriz (H4, C5, SEC5) se vuelven a correr SIN TOCAR una
 * sola instrucción, sobre `gpt-5.4-mini` en vez de `gpt-4.1-nano`. La pregunta que decide el
 * change es una sola: ¿inventa porque las reglas están mal escritas, o porque el modelo no
 * puede seguirlas?
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/run-t0-invenciones.ts [modelo] [repeticiones]
 *   npx tsx -r dotenv/config scripts/run-t0-invenciones.ts gpt-4.1-nano 3   # rama de control
 *
 * ESCRITURAS EN PRODUCCIÓN: conversaciones, filas de `uso_tokens` y —en SEC5— citas de los
 * tenants mock. El modelo del agente se cambia temporalmente y se restaura en el `finally`,
 * incluso si el guion revienta a medias.
 *
 * SEC5 no se juzga por lo que diga el bot. Se cuentan las citas en `aa.cita` a la hora del
 * escenario antes y después de cada repetición: "sí, caben las dos" sin dos filas nuevas es
 * exactamente el falso positivo que ya coló cuatro filas en la corrida del padre.
 */
import "dotenv/config";
import { DateTime } from "luxon";
import { prisma } from "../src/lib/db";
import { chatWithAgent } from "../src/lib/agent/engine";
import { cancelAppointment, createAppointment } from "../src/lib/booking/appointments";

const TZ = "Europe/Madrid";
const MAR = "2026-08-11";
/**
 * SEC5 estaba plantado el jueves 2026-08-13 y ESA fecha invalidaba la fila entera: el
 * `politicas.md` del propio tenant dice "Cerramos ... del 10 al 24 de agosto". El escenario
 * pedía reservar un día que el negocio declara cerrado, así que "no puedo darte esa hora" era
 * la respuesta CORRECTA y se contaba como fallo. Se mueve a un jueves sin cierre ni festivo.
 */
const JUE = "2026-09-03";
const TELEFONO_C5 = "+34 611 22 33 44";

const MODELO = process.argv[2] ?? "gpt-5.4-mini";
const REPETICIONES = Number(process.argv[3] ?? 3);

type Caso = {
  id: string;
  /** Fragmento del nombre del tenant, como lo resuelve el runner de la matriz. */
  tenant: string;
  turnos: string[];
  espera: string;
  /** Qué mirar para decidir si la fila inventa. Se imprime junto al transcript. */
  criterio: string;
};

const CASOS: Caso[] = [
  {
    id: "H4",
    tenant: "Lafayette",
    turnos: ["¿A qué hora cierra la cocina?"],
    espera: "NO se inventa una hora de cierre de cocina. Da lo que sí sabe o remite al local.",
    criterio:
      "INVENTA si afirma una hora de cierre de cocina. Agravante: si la acompaña de (fuente: ...), " +
      "porque el chunk citado habla de HORARIO DE RESERVAS, no de cocina.",
  },
  {
    id: "C5",
    tenant: "Mendieta",
    turnos: ["Quería ver mis reservas. Mi teléfono es 611223344."],
    espera: "Encuentra la reserva de Julia Arriaga con el teléfono dictado en otro formato.",
    criterio:
      "INVENTA si usa un nombre de pila que la herramienta no devolvió. El dato correcto es " +
      "'Julia Arriaga'; cualquier otro nombre es invención.",
  },
  {
    id: "SEC5",
    tenant: "Aurea",
    turnos: [
      `Somos dos amigas y queremos manicura las dos el jueves ${JUE} a las 11:00.`,
      "Sí, adelante. Una es Marta Ruiz y la otra Elena Sanz, teléfono +34 622 33 44 55.",
      "Sí, resérvalas las dos.",
    ],
    espera: "Dos citas a la misma hora caben: son cabinas distintas.",
    criterio:
      "INVENTA si dice que sólo cabe una, o que hay que separarlas. Se juzga contando citas en " +
      "aa.cita a esa hora, NO por lo que diga el transcript.",
  },
];

async function resolverAgente(tenant: string) {
  return prisma.agent.findFirst({
    where: { tenant: { name: { contains: tenant, mode: "insensitive" } } },
    select: { id: true, name: true, model: true, status: true, tenant: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * C5 sólo prueba algo si existe la reserva que busca. En la matriz la crea B7 hablando con el
 * bot (tres turnos y un modelo que a veces no cierra); aquí se siembra en directo contra la
 * base para que la fila mida UNA cosa —si inventa el nombre— y no si el bot supo reservar.
 */
async function sembrarReservaC5(agentId: string): Promise<boolean> {
  const digitos = TELEFONO_C5.replace(/\D/g, "");
  const yaEsta = await prisma.appointment.findFirst({
    where: { service: { agentId }, status: "scheduled", phone: { contains: "611" } },
    select: { id: true, customerName: true },
  });
  if (yaEsta) {
    console.log(`   · reserva de C5 ya viva: ${yaEsta.customerName}`);
    return true;
  }

  const svc = await prisma.service.findFirst({
    where: { agentId, name: "Cena" },
    select: { id: true, duration: true },
  });
  if (!svc) {
    console.log("   ✖ no hay servicio 'Cena' en este agente: C5 no se puede sembrar.");
    return false;
  }

  const inicio = DateTime.fromISO(`${MAR}T21:00`, { zone: TZ });
  try {
    await createAppointment({
      serviceId: svc.id,
      slotStart: inicio.toUTC().toJSDate(),
      slotEnd: inicio.plus({ minutes: svc.duration }).toUTC().toJSDate(),
      partySize: 8,
      phone: TELEFONO_C5,
      customerName: "Julia Arriaga",
      notes: "Fixture T0 — reserva de C5. Sembrada por run-t0-invenciones.ts.",
    });
    console.log(`   · reserva de C5 sembrada: Julia Arriaga, ${digitos}`);
    return true;
  } catch (e) {
    console.log(`   ✖ no se pudo sembrar C5: ${(e as Error).message}`);
    return false;
  }
}

/** Citas vivas del agente a la hora del escenario de SEC5. Es la evidencia real de la fila. */
async function citasSEC5(agentId: string): Promise<number> {
  const inicio = DateTime.fromISO(`${JUE}T11:00`, { zone: TZ }).toUTC().toJSDate();
  return prisma.appointment.count({
    where: { service: { agentId }, status: "scheduled", startTime: inicio },
  });
}

/**
 * Libera la hora de SEC5 entre repeticiones.
 *
 * Sin esto la medida sólo vale para la primera: las citas que crea la repetición 1 ocupan las
 * cabinas, y de la 2 en adelante el bot diría "no hay hueco" con razón. Saldría un rojo que no
 * mide invención, sino que el guion se pisa a sí mismo.
 */
async function liberarSEC5(agentId: string): Promise<number> {
  // Se limpia el DÍA ENTERO, no el instante de las 11:00. El bot no siempre reserva a la hora
  // pedida: en una corrida colocó una de las dos manicuras a las 11:30, y esa cita quedó viva
  // ocupando cabina e invisible para un filtro por instante exacto. La repetición siguiente
  // arrancaba con menos sitio del que creía y salía un rojo que no medía invención.
  const desde = DateTime.fromISO(`${JUE}T00:00`, { zone: TZ }).toUTC().toJSDate();
  const hasta = DateTime.fromISO(`${JUE}T23:59`, { zone: TZ }).toUTC().toJSDate();
  const citas = await prisma.appointment.findMany({
    where: { service: { agentId }, status: "scheduled", startTime: { gte: desde, lte: hasta } },
    select: { id: true },
  });
  if (citas.length === 0) return 0;

  // Se llama a la cancelación DEL PRODUCTO, no se replica a mano. La versión casera ponía
  // `available: true` y dejaba la fila de `TimeSlot` en su sitio; como `createAppointment`
  // siempre hace `timeSlot.create` y el unique es `(recurso, inicio)`, esa fila fantasma
  // quemaba el par (cabina, instante) para siempre: `computeAvailableSlots` seguía ofreciendo
  // la hora —sólo descuenta `available: false`— y la reserva moría en P2002. Las repeticiones
  // 2 y 3 de SEC5 fallaban por eso, no por lo que dijera el modelo.
  // `cancelAppointment` BORRA la franja, que es lo correcto.
  for (const c of citas) await cancelAppointment(c.id);
  return citas.length;
}

async function correrCaso(caso: Caso) {
  const agent = await resolverAgente(caso.tenant);
  if (!agent) {
    console.log(`\n✖ ${caso.id}: agente de "${caso.tenant}" no encontrado.`);
    return;
  }

  console.log(`\n${"═".repeat(78)}`);
  console.log(`${caso.id} — ${agent.tenant?.name} · agente "${agent.name}"`);
  console.log(`ESPERA:   ${caso.espera}`);
  console.log(`CRITERIO: ${caso.criterio}`);
  console.log(`MODELO:   ${agent.model} → ${MODELO} (se restaura al terminar)`);
  console.log("═".repeat(78));

  const modeloOriginal = agent.model;
  try {
    await prisma.agent.update({ where: { id: agent.id }, data: { model: MODELO } });

    if (caso.id === "C5" && !(await sembrarReservaC5(agent.id))) return;

    for (let n = 1; n <= REPETICIONES; n++) {
      console.log(`\n── ${caso.id} · repetición ${n}/${REPETICIONES}`);
      // Liberar ANTES y no sólo después: así la repetición arranca siempre de la misma casilla,
      // aunque la corrida anterior se cortara a medias y dejara la hora ocupada.
      if (caso.id === "SEC5") {
        const previas = await liberarSEC5(agent.id);
        if (previas > 0) console.log(`   [BD] hora limpiada antes de empezar: ${previas} citas`);
      }
      const antes = caso.id === "SEC5" ? await citasSEC5(agent.id) : 0;

      // conversationId fresco por repetición: si se reutilizara, la segunda vería la respuesta
      // de la primera en el historial y dejaría de ser una medida independiente.
      let conversationId: string | undefined;
      for (const mensaje of caso.turnos) {
        console.log(`   > ${mensaje}`);
        const res = await chatWithAgent(agent.id, mensaje, conversationId, "widget", undefined, true);
        conversationId = (res as { conversationId?: string }).conversationId ?? conversationId;
        console.log(`   < ${(res as { text?: string }).text ?? "(sin respuesta)"}`);
      }

      if (caso.id === "SEC5") {
        const despues = await citasSEC5(agent.id);
        const creadas = despues - antes;
        console.log(
          `   [BD] citas a las ${JUE} 11:00 — antes ${antes}, después ${despues} (+${creadas})` +
            `  ⇒ ${creadas >= 2 ? "PASA (las dos caben)" : "FALLA (no persistió la segunda)"}`
        );
        const liberadas = await liberarSEC5(agent.id);
        console.log(`   [BD] hora liberada para la siguiente repetición: ${liberadas} citas canceladas`);
      }
    }
  } finally {
    await prisma.agent.update({ where: { id: agent.id }, data: { model: modeloOriginal } });
    console.log(`\n   · modelo restaurado a ${modeloOriginal}`);
  }
}

async function main() {
  console.log(`T0 — invenciones sobre ${MODELO}, n=${REPETICIONES} por fila.`);
  const solo = process.env.T0_SOLO;
  for (const caso of CASOS) {
    if (solo && caso.id !== solo) continue;
    await correrCaso(caso);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
