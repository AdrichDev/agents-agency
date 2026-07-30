/**
 * Matriz de casuisticas contra los agentes mock VIVOS
 * (aa-reservas-multirecurso-y-mocks-sectoriales, T5.4 — `design.md` §G).
 *
 * No es un test unitario: cada fila es una conversacion real contra el proveedor, con las
 * herramientas de reserva pegadas a la base de datos de produccion. Lo que se comprueba es
 * justo lo que ningun mock puede comprobar: que el modelo LLAME a la herramienta correcta,
 * que no invente lo que el conocimiento no dice, y que la respuesta case con el inventario.
 *
 * Uso:
 *   npx tsx -r dotenv/config scripts/run-casuistry-matrix.ts            # las cuatro
 *   npx tsx -r dotenv/config scripts/run-casuistry-matrix.ts lafayette  # solo una
 *
 * ESCRITURAS EN PRODUCCION: crea conversaciones, citas y filas de `uso_tokens` de los cuatro
 * tenants mock. Todas van marcadas `isTest: true`. Las citas que crea el guion para montar
 * escenarios ("casa llena") se borran al final; las que crea el BOT se conservan, porque son
 * la evidencia de la fila.
 *
 * Fechas: se fijan explicitamente en los mensajes (no "el sabado") para que la evidencia no
 * dependa de como resuelva el modelo un dia relativo, y para poder montar el mismo instante
 * en la base de datos.
 */
import "dotenv/config";
import { DateTime } from "luxon";
import { prisma } from "../src/lib/db";
import { chatWithAgent } from "../src/lib/agent/engine";
import { createAppointment } from "../src/lib/booking/appointments";

const TZ = "Europe/Madrid";

/** Agosto de 2026: 1 sabado, 2 domingo, 3 lunes, 4 martes, 5 miercoles, 6 jueves, 7 viernes. */
const SAB = "2026-08-08";
const DOM = "2026-08-09";
const LUN = "2026-08-10";
const MAR = "2026-08-11";
const JUE = "2026-08-13";

type Fila = {
  id: string;
  /** Que se comprueba. Se imprime junto al transcript para poder juzgar la fila. */
  espera: string;
  turnos: string[];
  /** Escenario que hay que montar en la BD antes de hablar. */
  preparar?: keyof typeof PREPARACIONES;
  /** La fila usa un codigo de reserva capturado antes. */
  usaCodigo?: "propio" | "ajeno" | "cancelado";
};

type Bloque = { tenant: string; filas: Fila[] };

// ── Montaje de escenarios ───────────────────────────────────────────────────

/**
 * "Casa llena": ocupa TODAS las mesas de un servicio a una hora concreta. Sin esto no se
 * puede provocar la fila del hueco agotado, y con un solo hueco libre tampoco se distingue
 * "no hay mesa" de "no encontro la herramienta".
 */
async function llenarServicio(agentId: string, servicio: string, cuando: DateTime) {
  const svc = await prisma.service.findFirstOrThrow({
    where: { agentId, name: servicio },
    select: { id: true, duration: true },
  });
  const recursos = await prisma.resource.findMany({
    where: { agentId, enabled: true },
    select: { id: true, capacityMin: true },
  });
  const start = cuando.toUTC().toJSDate();
  const end = cuando.plus({ minutes: svc.duration }).toUTC().toJSDate();
  const creadas: Array<{ citaId: string; franjaId: string }> = [];
  for (const r of recursos) {
    try {
      const res = await createAppointment({
        serviceId: svc.id,
        slotStart: start,
        slotEnd: end,
        // `partySize` respeta el minimo de la mesa: con 1 comensal las mesas grandes se
        // descartan por `capacityMin` y el "casa llena" quedaria falso.
        partySize: Math.max(1, r.capacityMin),
        email: "montaje-matriz@example.com",
        customerName: "Montaje matriz T5.4",
        notes: "MONTAJE T5.4 — borrar",
      });
      creadas.push({ citaId: res.appointmentId, franjaId: res.slotId });
    } catch {
      // Una mesa que ya no cabe no rompe el montaje: lo que importa es que no quede hueco.
    }
  }
  return creadas;
}

const PREPARACIONES = {
  lafayetteCenaLlena: async (agentId: string) =>
    llenarServicio(agentId, "Cena", DateTime.fromISO(`${SAB}T20:30`, { zone: TZ })),
} as const;

// ── Filas ───────────────────────────────────────────────────────────────────

const MATRIZ: Bloque[] = [
  {
    tenant: "lafayette",
    filas: [
      {
        // 20:30 y no 21:30: la ventana "20:00-22:45" del servicio son LLEGADAS y la mesa de
        // cena dura 2 h, asi que la ultima entrada es a las 20:45. Pedir 21:30 no probaba la
        // disponibilidad, probaba el borde.
        id: "B1 disponibilidad por fecha y numero de comensales",
        espera: "Ofrece hora concreta del turno de cena y pide los datos para cerrar la mesa.",
        turnos: [`Hola, ¿tenéis mesa para 4 el sábado ${SAB} a las 20:30?`],
      },
      {
        id: "B2 grupo por encima de maxPartySize (8)",
        espera: "NO reserva. Deriva a grupos/eventos o a contacto directo.",
        turnos: [`Somos 14 para una comida de empresa el jueves ${JUE}. ¿Podéis?`],
      },
      {
        id: "B3 llegada fuera del turno (16:30)",
        espera: "Explica que a esa hora no hay servicio y da la ventana de cena (20:00-22:45).",
        turnos: [`¿Tenéis mesa para 2 el jueves ${JUE} a las 16:30?`],
      },
      {
        id: "B4 cena de domingo",
        espera: "Domingo no hay cena. Puede ofrecer el mediodia o el brunch, pero no cena.",
        turnos: [`Queremos cenar el domingo ${DOM}, para 2.`],
      },
      {
        id: "B5 casa llena a una hora concreta",
        espera: "Dice que a las 20:30 no queda mesa y propone OTRA hora del mismo turno.",
        preparar: "lafayetteCenaLlena",
        turnos: [`Mesa para 2 el sábado ${SAB} a las 20:30, por favor.`],
      },
      {
        id: "B6 fecha en el pasado",
        espera: "No reserva en el pasado. Lo dice y pide una fecha futura.",
        turnos: ["Quiero reservar para el 3 de enero de 2026 a las 21:00, somos 2."],
      },
      {
        id: "B8 terraza pedida explicitamente",
        espera: "Reconoce que hay terraza. No inventa que la terraza se puede elegir si no puede.",
        turnos: [`¿Puedo reservar en la terraza el sábado ${SAB} para 2 a las 20:30?`],
      },
      {
        // Fila añadida al ejecutar la matriz, no prevista en design.md §G. La web indexada
        // publica "HORARIO DE RESERVAS — Cena: de 20:00 a 22:45", pero el servicio trata esa
        // ventana como LLEGADAS y resta la duración de la mesa: última entrada 20:45. El
        // agente tiene entonces dos fuentes que se contradicen en la MISMA conversación.
        id: "H5 la web dice reservas hasta 22:45 y la herramienta corta a las 20:45",
        espera: "CONTRADICCION conocida: RAG dice hasta 22:45, la herramienta no ofrece 22:00.",
        turnos: [`¿Tenéis mesa para cenar a las 22:00 el sábado ${SAB}?`],
      },
      {
        id: "M5 pedir la carta",
        espera: "Da la URL de la carta de brasserielafayette.es. No transcribe una carta inventada.",
        turnos: ["¿Me pasas la carta?"],
      },
      {
        id: "H3 brunch frente a carta el domingo",
        espera: "Distingue brunch (11:30-13:30) de la carta de mediodia (13:30-16:00).",
        turnos: ["El domingo, ¿hay brunch o carta?"],
      },
      {
        id: "H4 hora de cierre de cocina (NO publicada)",
        espera: "NO se inventa una hora de cierre de cocina. Da lo que si sabe o remite al local.",
        turnos: ["¿A qué hora cierra la cocina?"],
      },
    ],
  },
  {
    tenant: "mendieta",
    filas: [
      {
        id: "M1 precio de un plato concreto",
        espera: "11,00 € las croquetas de jamón (6 unidades).",
        turnos: ["¿Cuánto cuestan las croquetas de jamón?"],
      },
      {
        id: "M2 alergenos de un plato concreto",
        espera: "Merluza a la koskera: pescado, moluscos y sulfitos. Los tres.",
        turnos: ["¿Qué alérgenos tiene la merluza a la koskera?"],
      },
      {
        id: "M3 opciones sin gluten",
        espera: "Honesto: las croquetas NO tienen version sin gluten. Ofrece platos sin gluten.",
        turnos: ["Mi hija es celíaca. ¿Qué puede comer?"],
      },
      {
        id: "M4 peticion vegetariana sin nada etiquetado como tal",
        espera: "No inventa un menu vegetariano. Cita los platos que quedan veganos a peticion.",
        turnos: ["Soy vegetariano, ¿qué me recomiendas?"],
      },
      {
        id: "H1/H2 lunes cerrado",
        espera: "Los lunes cierra. Sin rodeos.",
        turnos: [`¿Abrís el lunes ${LUN}?`],
      },
      {
        id: "H4 ultima hora de cena",
        espera: "Ultima mesa de cena a las 21:00 (ventana de llegadas 20:30-21:00).",
        turnos: ["¿Hasta qué hora se puede entrar a cenar el sábado?"],
      },
      {
        id: "B7 grupo que solo cabe en la mesa de ocho",
        espera: "Reserva para 8. La mesa asignada tiene que ser la de 4-8 (Mesa 6).",
        turnos: [
          `Somos 8 y queremos cenar el martes ${MAR} a las 21:00.`,
          "Sí, adelante. Nombre Julia Arriaga, teléfono +34 611 22 33 44.",
        ],
      },
      {
        id: "C5 listar mis reservas por telefono",
        espera: "Encuentra la reserva de Julia con el telefono dictado en OTRO formato.",
        turnos: ["Quería ver mis reservas. Mi teléfono es 611223344."],
      },
      {
        id: "C2 codigo valido con contacto que NO coincide",
        espera: "NO cancela. Mismo mensaje que un codigo inexistente, sin confirmar que existe.",
        usaCodigo: "propio",
        turnos: ["Quiero cancelar la reserva {CODIGO}. Mi correo es intruso@example.com."],
      },
      {
        id: "C3 codigo inexistente",
        espera: "No encuentra nada. No inventa una reserva.",
        turnos: ["Cancela mi reserva, el código es CAS-ZZZZ. Mi teléfono es 611223344."],
      },
      {
        id: "C4 codigo de un agente de OTRO tenant",
        espera: "No lo encuentra: el aislamiento por agente corta aunque el codigo exista.",
        usaCodigo: "ajeno",
        turnos: ["Quiero cancelar la reserva {CODIGO}, mi teléfono es 611223344."],
      },
      {
        id: "C1 cancelacion con codigo y contacto correctos",
        espera: "Cancela y lo confirma con la hora de la reserva.",
        usaCodigo: "propio",
        turnos: ["Necesito cancelar la reserva {CODIGO}. Mi teléfono es +34 611 22 33 44."],
      },
      {
        id: "C6 cancelar una reserva YA cancelada",
        espera: "Dice que ya estaba cancelada. No falla con un error opaco.",
        usaCodigo: "cancelado",
        turnos: ["Cancela la reserva {CODIGO}, teléfono 611223344."],
      },
      {
        id: "C7 la hora liberada se vuelve a ofrecer",
        espera: "Las 21:00 del martes vuelven a estar libres para 8 tras la cancelacion.",
        turnos: [`¿Tenéis mesa para 8 el martes ${MAR} a las 21:00?`],
      },
    ],
  },
  {
    tenant: "barberia",
    filas: [
      {
        id: "SEC1 cita con un profesional concreto",
        espera: "Ofrece hueco de corte. Los barberos son el inventario: uno por cita.",
        turnos: [`Quiero cortarme el pelo el jueves ${JUE} por la tarde.`],
      },
      {
        id: "SEC2 precio de un servicio (web indexada)",
        espera: "Precio del corte y barba tomado de la web, no inventado.",
        turnos: ["¿Cuánto cuesta el corte y barba?"],
      },
      {
        id: "SEC3 reserva completa con codigo",
        espera: "Cierra la cita y DICTA el codigo de confirmacion.",
        turnos: [
          `Corte y barba el martes ${MAR} a las 17:00.`,
          "Perfecto. Soy Iker Salaverria, teléfono 622334455.",
        ],
      },
    ],
  },
  {
    tenant: "estetica",
    filas: [
      {
        id: "SEC4 servicio atado a una cabina concreta",
        espera: "La depilacion laser solo sale en la Cabina Láser.",
        turnos: [`Quiero depilación láser el jueves ${JUE} a las 17:00.`],
      },
      {
        id: "SEC5 dos personas a la misma hora",
        espera: "Dos citas a la misma hora caben: son cabinas distintas.",
        turnos: [`Somos dos amigas y queremos manicura las dos el jueves ${JUE} a las 11:00.`],
      },
      {
        id: "SEC6 duracion de un tratamiento",
        espera: "Duracion de la limpieza facial profunda, coherente con el servicio configurado.",
        turnos: ["¿Cuánto dura la limpieza facial profunda?"],
      },
    ],
  },
];

// ── Ejecucion ───────────────────────────────────────────────────────────────

async function resolverAgente(tenantSlugOrName: string) {
  const agent = await prisma.agent.findFirst({
    where: { tenant: { name: { contains: tenantSlugOrName, mode: "insensitive" } } },
    select: { id: true, name: true, model: true, status: true, tenant: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return agent;
}

/** Codigos capturados durante la corrida, para las filas de cancelacion. */
const codigos: { propio?: string; ajeno?: string; cancelado?: string } = {};

async function ultimoCodigo(agentId: string): Promise<string | undefined> {
  const cita = await prisma.appointment.findFirst({
    where: { service: { agentId }, confirmationCode: { not: null }, status: "scheduled" },
    orderBy: { createdAt: "desc" },
    select: { confirmationCode: true },
  });
  return cita?.confirmationCode ?? undefined;
}

async function correrBloque(bloque: Bloque, soloTenant?: string) {
  if (soloTenant && bloque.tenant !== soloTenant) return;

  const agent = await resolverAgente(
    bloque.tenant === "lafayette"
      ? "Lafayette"
      : bloque.tenant === "mendieta"
        ? "Mendieta"
        : bloque.tenant === "barberia"
          ? "Núñez"
          : "Aurea"
  );
  if (!agent) {
    console.log(`\n✖ ${bloque.tenant}: agente no encontrado. Siembra los mocks primero.`);
    return;
  }

  console.log(`\n${"═".repeat(78)}`);
  console.log(`TENANT ${agent.tenant?.name} — agente "${agent.name}" (${agent.model}, ${agent.status})`);
  console.log("═".repeat(78));

  const montajes: Array<{ citaId: string; franjaId: string }> = [];

  for (const fila of bloque.filas) {
    if (fila.preparar) {
      const ids = await PREPARACIONES[fila.preparar](agent.id);
      montajes.push(...ids);
      console.log(`\n  · montaje "${fila.preparar}": ${ids.length} mesas ocupadas`);
    }

    console.log(`\n── ${fila.id}`);
    console.log(`   ESPERA: ${fila.espera}`);

    let conversationId: string | undefined;
    for (const plantilla of fila.turnos) {
      let mensaje = plantilla;
      if (fila.usaCodigo) {
        const codigo = codigos[fila.usaCodigo];
        if (!codigo) {
          console.log(`   ⚠ sin codigo "${fila.usaCodigo}" capturado; fila omitida`);
          mensaje = "";
          break;
        }
        mensaje = mensaje.replace("{CODIGO}", codigo);
      }
      if (!mensaje) break;

      console.log(`   👤 ${mensaje}`);
      try {
        const res = await chatWithAgent(agent.id, mensaje, conversationId, "widget", undefined, true);
        conversationId = res.conversationId;
        console.log(`   🤖 ${res.text.replace(/\n/g, "\n      ")}`);
      } catch (e) {
        console.log(`   ✖ ERROR: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }

    // Captura de codigos para las filas de cancelacion.
    if (bloque.tenant === "mendieta" && fila.id.startsWith("B7")) {
      codigos.propio = await ultimoCodigo(agent.id);
      console.log(`   ⇒ codigo propio capturado: ${codigos.propio ?? "(ninguno)"}`);
    }
    if (fila.id.startsWith("C1") && codigos.propio) {
      codigos.cancelado = codigos.propio;
    }
  }

  if (montajes.length) {
    // El montaje es andamio, no evidencia: se retira. Las citas del BOT se quedan.
    // Las citas van primero (`Appointment.service` es Restrict) y las franjas despues: si se
    // dejaran, el instante seguiria ocupado y la siguiente corrida daria "casa llena" sin
    // haberla montado.
    await prisma.appointment.deleteMany({ where: { id: { in: montajes.map((m) => m.citaId) } } });
    await prisma.timeSlot.deleteMany({ where: { id: { in: montajes.map((m) => m.franjaId) } } });
    console.log(`\n  · montaje retirado (${montajes.length} citas + franjas)`);
  }
}

/**
 * Codigo VIVO de un agente de otro tenant, para la fila C4.
 *
 * Tiene que existir de verdad y sobrevivir a la corrida: si se tomara del montaje de "casa
 * llena" —que se retira al terminar— la fila probaria que no se encuentra un codigo borrado,
 * que es exactamente lo mismo que prueba C3. El aislamiento por agente solo queda demostrado
 * con un codigo que SI existe en la plataforma y aun asi no se puede usar aqui.
 */
async function acunarCodigoAjeno(): Promise<string | undefined> {
  const agent = await resolverAgente("Lafayette");
  if (!agent) return undefined;
  const svc = await prisma.service.findFirstOrThrow({
    where: { agentId: agent.id, name: "Cena" },
    select: { id: true, duration: true },
  });
  const inicio = DateTime.fromISO(`${SAB}T20:00`, { zone: TZ });
  const res = await createAppointment({
    serviceId: svc.id,
    slotStart: inicio.toUTC().toJSDate(),
    slotEnd: inicio.plus({ minutes: svc.duration }).toUTC().toJSDate(),
    partySize: 2,
    email: "codigo-ajeno@example.com",
    phone: "+34 699 00 11 22",
    customerName: "Fixture C4 (codigo de otro tenant)",
    notes: "Fixture T5.4 — codigo vivo para la fila C4. NO borrar mientras la fila valga.",
  });
  return res.confirmationCode;
}

async function main() {
  const solo = process.argv[2];
  if (!solo || solo === "mendieta") {
    codigos.ajeno = await acunarCodigoAjeno();
    console.log(`\n· codigo vivo de Lafayette para C4: ${codigos.ajeno ?? "(no se pudo acunar)"}`);
  }
  for (const bloque of MATRIZ) await correrBloque(bloque, solo);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
