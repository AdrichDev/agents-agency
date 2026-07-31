/**
 * T4.2 (aa-reserva-contacto-real-del-visitante) — fila SEC3 contra el agente VIVO.
 *
 * El veredicto NO se lee de la respuesta del bot. Una respuesta que dice "te he apuntado el
 * 622334455" no prueba que la fila lo guarde: la tirada que motivó este cambio decía justo eso
 * y escribió el teléfono del propio negocio. Aquí se lee la columna `telefono` de `aa.cita`.
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/diag-sec3-contacto.ts [n]
 *
 * ESCRIBE EN PRODUCCION: crea conversaciones y citas del tenant mock `barberia`, marcadas
 * `isTest: true`. Cada repeticion limpia el dia antes de empezar y CANCELA su propia cita al
 * terminar, para que la siguiente arranque del mismo estado.
 */
import "dotenv/config";
import { DateTime } from "luxon";
import { prisma } from "../src/lib/db";
import { chatWithAgent } from "../src/lib/agent/engine";
import { cancelAppointment } from "../src/lib/booking/appointments";

const TZ = "Europe/Madrid";
const DIA = "2026-08-11"; // martes, el mismo que usa la matriz
const TELEFONO_VISITANTE = "622334455";
const TURNOS = [
  `Corte y barba el martes ${DIA} a las 17:00.`,
  "Perfecto. Soy Iker Salaverria, teléfono 622334455.",
  // Tercer turno: la fila SEC3 original tiene dos. Se añade uno de insistencia porque la guarda
  // nueva puede RECHAZAR una llamada y pedir el dato otra vez; sin un turno más no se ve si el
  // modelo se recupera, y no recuperarse sería tan malo como escribir el dato falso.
  "Sí, ese es mi teléfono. Confírmame la cita.",
];

const soloDigitos = (v?: string | null) => (v ? v.replace(/\D/g, "") : "");

async function resolverAgente() {
  const agent = await prisma.agent.findFirst({
    where: { tenant: { name: { contains: "barber", mode: "insensitive" } } },
    select: {
      id: true,
      name: true,
      model: true,
      tenant: { select: { name: true, phone: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!agent) throw new Error("agente de barberia no encontrado");
  return agent;
}

async function limpiarDia(agentId: string) {
  const desde = DateTime.fromISO(`${DIA}T00:00`, { zone: TZ }).toUTC().toJSDate();
  const hasta = DateTime.fromISO(`${DIA}T23:59`, { zone: TZ }).toUTC().toJSDate();
  const citas = await prisma.appointment.findMany({
    where: { service: { agentId }, status: "scheduled", startTime: { gte: desde, lte: hasta } },
    select: { id: true },
  });
  for (const c of citas) await cancelAppointment(c.id);
  return citas.length;
}

async function citasDelDia(agentId: string, desdeInstante: Date) {
  return prisma.appointment.findMany({
    where: { service: { agentId }, status: "scheduled", createdAt: { gte: desdeInstante } },
    select: {
      id: true,
      customerName: true,
      phone: true,
      email: true,
      startTime: true,
      confirmationCode: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

async function main() {
  const n = Number(process.argv[2] ?? 3);
  const agent = await resolverAgente();
  const telNegocio = soloDigitos(agent.tenant?.phone).slice(-9);
  console.log(`agente: ${agent.name} · modelo ${agent.model}`);
  console.log(`negocio: ${agent.tenant?.name} · tel ${agent.tenant?.phone} · ${agent.tenant?.email}`);
  console.log(`esperado en la fila: ${TELEFONO_VISITANTE}\n`);

  const veredictos: string[] = [];

  for (let i = 1; i <= n; i++) {
    console.log(`── repeticion ${i}/${n} ─────────────────────────────`);
    const limpiadas = await limpiarDia(agent.id);
    if (limpiadas) console.log(`   · dia limpiado (${limpiadas} citas)`);

    const inicio = new Date();
    let conversationId: string | undefined;
    for (const mensaje of TURNOS) {
      console.log(`   👤 ${mensaje}`);
      try {
        const res = await chatWithAgent(agent.id, mensaje, conversationId, "widget", undefined, true);
        conversationId = res.conversationId;
        console.log(`   🤖 ${res.text.replace(/\n/g, "\n      ")}`);
        // Las tool calls son la unica forma de distinguir "la guarda rechazo" de "el modelo ni
        // lo intento". Sin esto, una tirada sin cita es indistinguible de un fallo del fix.
        for (const tc of res.toolCalls ?? []) {
          const inp = typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input);
          console.log(`      · tool ${tc.tool}(${inp})`);
          if ((tc as { error?: unknown }).error) {
            console.log(`        ✖ ${JSON.stringify((tc as { error?: unknown }).error)}`);
          }
        }
      } catch (e) {
        console.log(`   ✖ ERROR: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }

    // El lead es la fuente del relleno: si viene vacio, el fallback no puede haber actuado.
    const lead = conversationId
      ? await prisma.lead.findUnique({
          where: { conversationId },
          select: { customerName: true, phone: true, email: true },
        })
      : null;
    console.log(
      `   lead: ${lead ? `${lead.customerName} · ${lead.phone} · ${lead.email}` : "(ninguno)"}`
    );

    const citas = await citasDelDia(agent.id, inicio);
    if (citas.length === 0) {
      veredictos.push("SIN CITA");
      console.log("   ⇒ SIN CITA — el agente no cerro la reserva\n");
      continue;
    }

    for (const c of citas) {
      const tel = soloDigitos(c.phone).slice(-9);
      const esperado = tel === TELEFONO_VISITANTE;
      const esDelNegocio = telNegocio.length === 9 && tel === telNegocio;
      const marca = esperado ? "OK" : esDelNegocio ? "TELEFONO DEL NEGOCIO" : "OTRO";
      veredictos.push(marca);
      console.log(
        `   ⇒ ${marca} · ${c.confirmationCode} · nombre="${c.customerName}" · tel=${c.phone} · email=${c.email}`
      );
    }
    // La cita es la evidencia y ya esta leida: se cancela para no dejar rastro vivo y para que
    // la repeticion siguiente arranque del mismo estado.
    for (const c of citas) await cancelAppointment(c.id);
    console.log("");
  }

  const ok = veredictos.filter((v) => v === "OK").length;
  console.log(`RESULTADO: ${ok}/${veredictos.length} con el telefono del visitante`);
  console.log(`detalle: ${veredictos.join(" | ")}`);

  const vivas = await limpiarDia(agent.id);
  console.log(`limpieza final: ${vivas} citas canceladas`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
