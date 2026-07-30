/**
 * Mock tenants for the multi-resource booking work
 * (`openspec/changes/aa-reservas-multirecurso-y-mocks-sectoriales`, T4.1–T4.7).
 *
 * Four fictional businesses that between them exercise every branch of the new availability
 * and cancellation code against a REAL database:
 *
 *   lafayette      Restaurant. Two separate sittings per day (lunch / dinner) plus a Sunday
 *                  brunch, 12 tables in two zones with different seat counts, arrival grid
 *                  finer than the table turn time. Knowledge from a website.
 *   barberia       Three barbers as resources; one of them does not do beard work, so
 *                  eligibility is per service, not per business. Split shift with a break.
 *   estetica       Four cabins, one of them laser-only (equipment restriction), treatments of
 *                  30–90 min with a reset buffer between clients.
 *   mendieta       Restaurant with NO website: the whole knowledge base comes from the three
 *                  markdown fixtures under `openspec/changes/.../fixtures/casa-mendieta/`.
 *
 * Design notes that matter when reading the data below:
 *
 *  - `capacityMin` is not decoration. On the big tables it is what stops a party of two from
 *    burning the eight-seater while the two-seaters sit empty; `pickBestFit` already prefers
 *    the smallest table that fits, but a floor makes the policy explicit.
 *  - `slotStepMin` and `duration` are different things. Lafayette holds a table for 105 min and
 *    still takes arrivals every 15.
 *  - `bufferMin` is the business's problem, not the guest's: it extends how long the resource
 *    stays occupied, and never appears in what the guest is offered.
 *  - `Service.schedule` overrides the agent's. A restaurant's lunch and dinner are two windows,
 *    and Sunday has brunch and lunch but no dinner — inexpressible with one schedule per agent.
 *
 * Billing safety (T4.7): every mock tenant is created with no plan, no Stripe ids and an
 * explicit `tokenBalance`, and every agent stays in `draft`, so the public widget answers 403
 * and no invoice can be produced for them. They are still usable from the internal test
 * console, which is what the casuistry matrix needs.
 *
 * Usage (`-r dotenv/config` is required: `src/lib/db.ts` throws if `DATABASE_URL` is unset, and
 * nothing else in this script loads the env file):
 *   npx tsx -r dotenv/config scripts/seed-mock-tenants.ts               # the four, no knowledge
 *   npx tsx -r dotenv/config scripts/seed-mock-tenants.ts --only=lafayette
 *   npx tsx -r dotenv/config scripts/seed-mock-tenants.ts --knowledge   # web + fixtures ($$)
 *   npx tsx -r dotenv/config scripts/seed-mock-tenants.ts --teardown    # remove them
 *
 * `--knowledge` is opt-in on purpose: it hits the network and spends embedding tokens, while
 * re-seeding the structure is free and idempotent.
 */

import { readFile } from "node:fs/promises";
import { Prisma } from "../src/lib/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { chunkText } from "../src/lib/embeddings";
import { nextClientCode, withCodeRetry } from "../src/lib/codes";
import { saveChunkWithDuplicatePolicy } from "../src/lib/knowledge-duplicates";
import { runTrackedIngest } from "../src/lib/agent/service";

// ── Shapes ──────────────────────────────────────────────────────────────────

interface ResourceDef {
  name: string;
  kind: "table" | "staff" | "room";
  capacityMin: number;
  capacityMax: number;
  zone?: string;
}

interface ServiceDef {
  name: string;
  description: string;
  duration: number;
  slotStepMin: number;
  bufferMin: number;
  maxPartySize: number;
  /** Own sitting. Absent → the agent's schedule applies. */
  schedule?: Record<string, string>;
  /** Eligible resource names. Absent → every enabled resource of the agent. */
  resources?: string[];
}

interface MockDef {
  key: string;
  tenant: {
    // Sin `codigo`: lo asigna `nextClientCode()` en el alta, como a cualquier cliente (T6.1).
    name: string;
    sector: string;
    email: string;
    phone: string;
    website?: string;
    direccion: string;
    contactPerson: string;
  };
  agent: {
    name: string;
    sector: string;
    systemPrompt: string;
    widgetAvatarEmoji: string;
  };
  schedule: Record<string, string>;
  resources: ResourceDef[];
  services: ServiceDef[];
  knowledge:
    | { kind: "web"; url: string }
    | { kind: "files"; dir: string; files: string[] };
}

// ── Lafayette ───────────────────────────────────────────────────────────────

const LAFAYETTE_TABLES: ResourceDef[] = [
  // Sala. Los dos-plazas admiten desde 1 persona; a partir de la mesa de cuatro se pone suelo
  // para no quemar una mesa grande con un grupo pequeno.
  { name: "Mesa 1", kind: "table", capacityMin: 1, capacityMax: 2, zone: "Sala" },
  { name: "Mesa 2", kind: "table", capacityMin: 1, capacityMax: 2, zone: "Sala" },
  { name: "Mesa 3", kind: "table", capacityMin: 1, capacityMax: 2, zone: "Sala" },
  { name: "Mesa 4", kind: "table", capacityMin: 2, capacityMax: 4, zone: "Sala" },
  { name: "Mesa 5", kind: "table", capacityMin: 2, capacityMax: 4, zone: "Sala" },
  { name: "Mesa 6", kind: "table", capacityMin: 2, capacityMax: 4, zone: "Sala" },
  { name: "Mesa 7", kind: "table", capacityMin: 3, capacityMax: 6, zone: "Sala" },
  { name: "Mesa 8", kind: "table", capacityMin: 3, capacityMax: 6, zone: "Sala" },
  // Terraza. Cerrada en el servicio de manana (el brunch solo usa Sala).
  { name: "Terraza 1", kind: "table", capacityMin: 1, capacityMax: 2, zone: "Terraza" },
  { name: "Terraza 2", kind: "table", capacityMin: 2, capacityMax: 4, zone: "Terraza" },
  { name: "Terraza 3", kind: "table", capacityMin: 2, capacityMax: 4, zone: "Terraza" },
  { name: "Terraza 4", kind: "table", capacityMin: 5, capacityMax: 8, zone: "Terraza" },
];

const LAFAYETTE_SALA = LAFAYETTE_TABLES.filter((t) => t.zone === "Sala").map((t) => t.name);

const LAFAYETTE: MockDef = {
  key: "lafayette",
  tenant: {
    name: "Brasserie Lafayette",
    sector: "restauracion",
    email: "reservas@brasserielafayette.es",
    phone: "+34 910 00 00 01",
    website: "https://www.brasserielafayette.es",
    direccion: "Calle de Lafayette, 12 — 28004 Madrid",
    contactPerson: "Dirección de sala",
  },
  agent: {
    name: "Lafayette",
    sector: "restauracion",
    widgetAvatarEmoji: "🍽️",
    systemPrompt: [
      "Eres el asistente de reservas de Brasserie Lafayette, una brasserie francesa en Madrid.",
      "Trato de usted, cercano y breve. Nunca inventes platos, precios ni horarios: si no lo",
      "tienes en el conocimiento del negocio, dilo y ofrece el teléfono.",
      "",
      "Servicios reservables: Comida, Cena y Brunch (solo domingos). Los turnos son distintos:",
      "comprueba siempre la disponibilidad con la herramienta antes de proponer una hora.",
      "",
      // La URL es `/carta-lafayette-2/` y NO `/carta/`: esta última responde 200 pero con
      // `content-type: image/jpeg`, así que el cliente aterrizaría en una foto sin texto ni
      // alérgenos legibles. `/carta-lafayette-2/` es la versión HTML, y es la indexada.
      "Cuando pregunten por la carta, los platos, los precios o los alérgenos, busca en el",
      "conocimiento y remite a la carta de la web:",
      "https://www.brasserielafayette.es/carta-lafayette-2/",
      "Es la única versión vigente; los precios de una conversación anterior pueden estar viejos.",
      "",
      "Grupos de más de 8 personas: no se reservan por aquí. Deriva a grupos@brasserielafayette.es",
      "o al teléfono +34 910 00 00 01, sin intentar otras horas.",
      "",
      "Alérgenos: informa de lo que diga la carta y añade siempre que, ante una alergia,",
      "avisen al llegar para que la cocina lo trate en sala. No des garantías de ausencia de",
      "trazas que la carta no dé.",
    ].join("\n"),
  },
  // Horario de apertura del local. Los turnos reales viven en cada servicio.
  schedule: {
    mon: "13:00-16:00|19:30-23:00",
    tue: "13:00-16:00|19:30-23:00",
    wed: "13:00-16:00|19:30-23:00",
    thu: "13:00-16:00|19:30-23:00",
    fri: "13:00-16:00|19:30-23:30",
    sat: "13:00-16:30|19:30-23:30",
    sun: "11:30-16:30",
  },
  resources: LAFAYETTE_TABLES,
  services: [
    {
      name: "Comida",
      description: "Servicio de comida. La mesa se reserva 1 h 45 min.",
      duration: 105,
      slotStepMin: 15,
      bufferMin: 15,
      maxPartySize: 8,
      // Ventana de LLEGADAS, no de apertura: con 105 min de mesa, la última entra a las 14:00
      // de lunes a sábado y a las 14:15 el domingo.
      //
      // Copia literal del bloque "HORARIO DE RESERVAS" de `brasserielafayette.es/contacto/`
      // ("Lunes a Sábado: de 13:30 a 15:45", "Domingo Carta: de 13:30 a 16:00"). Tiene que
      // coincidir: la web está indexada, así que un horario inventado aquí haría que el RAG y
      // `consultar_disponibilidad` se contradijeran en la misma conversación.
      schedule: {
        mon: "13:30-15:45",
        tue: "13:30-15:45",
        wed: "13:30-15:45",
        thu: "13:30-15:45",
        fri: "13:30-15:45",
        sat: "13:30-15:45",
        sun: "13:30-16:00",
      },
    },
    {
      name: "Cena",
      description: "Servicio de cena. La mesa se reserva 2 h.",
      duration: 120,
      slotStepMin: 15,
      bufferMin: 15,
      maxPartySize: 8,
      // Domingo sin cena: la clave simplemente no existe. La web solo declara cena de lunes a
      // sábado ("de 20:00 a 22:45"), y el domingo únicamente brunch y carta de mediodía.
      schedule: {
        mon: "20:00-22:45",
        tue: "20:00-22:45",
        wed: "20:00-22:45",
        thu: "20:00-22:45",
        fri: "20:00-22:45",
        sat: "20:00-22:45",
      },
    },
    {
      name: "Brunch",
      description: "Brunch de domingo en Sala. La mesa se reserva 1 h 30 min.",
      duration: 90,
      slotStepMin: 30,
      bufferMin: 15,
      maxPartySize: 6,
      schedule: { sun: "11:30-13:30" },
      // La terraza no se monta para el brunch: eligibilidad por servicio, no por negocio.
      resources: LAFAYETTE_SALA,
    },
  ],
  knowledge: { kind: "web", url: "https://www.brasserielafayette.es" },
};

// ── Barbería Núñez ──────────────────────────────────────────────────────────

const BARBERIA: MockDef = {
  key: "barberia",
  tenant: {
    name: "Barbería Núñez",
    sector: "belleza",
    email: "hola@barberianunez.example",
    phone: "+34 910 00 00 02",
    direccion: "Calle Mayor, 48 — 28013 Madrid",
    contactPerson: "Rubén Núñez",
  },
  agent: {
    name: "Barbería Núñez",
    sector: "belleza",
    widgetAvatarEmoji: "💈",
    systemPrompt: [
      "Eres el asistente de citas de Barbería Núñez. Tuteo, directo y breve.",
      "",
      "Tres barberos: Javi, Rubén y Alba. Alba no hace barba, así que los servicios con barba",
      "solo los cogen Javi y Rubén. No prometas un barbero concreto: la herramienta asigna el",
      "que esté libre. Si el cliente pide a alguien en particular, dile que lo anotas en las",
      "notas y que lo confirman al llegar.",
      "",
      "Servicios: Corte (30 min), Corte y barba (45 min), Corte, barba y color (60 min).",
      "Comprueba siempre la disponibilidad con la herramienta antes de dar una hora.",
      "Cada cita es para una persona: si vienen dos, se reservan dos citas.",
      "",
      "Horario: de lunes a viernes de 10:00 a 14:00 y de 16:00 a 20:00; sábados de 10:00 a 14:00.",
      "Domingos cerrado. No hay hueco entre las 14:00 y las 16:00, es la comida.",
      "",
      "Cancelar: pide el código y el teléfono o el correo con el que se reservó.",
    ].join("\n"),
  },
  schedule: {
    mon: "10:00-14:00|16:00-20:00",
    tue: "10:00-14:00|16:00-20:00",
    wed: "10:00-14:00|16:00-20:00",
    thu: "10:00-14:00|16:00-20:00",
    fri: "10:00-14:00|16:00-20:00",
    sat: "10:00-14:00",
  },
  resources: [
    { name: "Javi", kind: "staff", capacityMin: 1, capacityMax: 1 },
    { name: "Rubén", kind: "staff", capacityMin: 1, capacityMax: 1 },
    { name: "Alba", kind: "staff", capacityMin: 1, capacityMax: 1 },
  ],
  services: [
    {
      name: "Corte",
      description: "Corte de pelo a máquina o tijera, con lavado.",
      duration: 30,
      slotStepMin: 15,
      bufferMin: 5,
      maxPartySize: 1,
      // Sin `resources`: lo cogen los tres.
    },
    {
      name: "Corte y barba",
      description: "Corte de pelo y arreglo de barba con navaja.",
      duration: 45,
      slotStepMin: 15,
      bufferMin: 5,
      maxPartySize: 1,
      resources: ["Javi", "Rubén"],
    },
    {
      name: "Corte, barba y color",
      description: "Corte, arreglo de barba y coloración.",
      duration: 60,
      slotStepMin: 15,
      bufferMin: 10,
      maxPartySize: 1,
      resources: ["Javi", "Rubén"],
    },
  ],
  knowledge: {
    kind: "files",
    dir: "barberia-nunez",
    files: ["servicios-precios.md", "politicas.md"],
  },
};

// ── Estética Aurea ──────────────────────────────────────────────────────────

const ESTETICA: MockDef = {
  key: "estetica",
  tenant: {
    name: "Estética Aurea",
    sector: "belleza",
    email: "citas@esteticaaurea.example",
    phone: "+34 910 00 00 03",
    direccion: "Avenida de la Albufera, 5 — 28038 Madrid",
    contactPerson: "Aurora Vidal",
  },
  agent: {
    name: "Estética Aurea",
    sector: "belleza",
    widgetAvatarEmoji: "✨",
    systemPrompt: [
      "Eres el asistente de citas de Estética Aurea, centro de estética. Trato de usted,",
      "cuidado y breve.",
      "",
      "Cuatro cabinas. La Cabina Láser es la única con el equipo de depilación láser, así que",
      "ese tratamiento solo se hace ahí y tiene menos hueco que el resto: es normal que haya",
      "disponibilidad de facial y no de láser a la misma hora.",
      "",
      "Tratamientos: Manicura (30 min), Depilación láser (45 min), Limpieza facial profunda",
      "(60 min) y Ritual corporal (90 min). Entre cliente y cliente la cabina necesita un rato",
      "de reseteo, así que no ofrezcas horas seguidas: usa siempre la herramienta.",
      "",
      "Cada cita es para una persona.",
      "",
      "Primera sesión de láser: hay que hacer una valoración previa y no puede haber exposición",
      "solar reciente. Dilo al reservar.",
      "",
      "Horario: de lunes a viernes de 10:00 a 20:00 y sábados de 10:00 a 14:00.",
      "",
      "Cancelar: pide el código y el teléfono o el correo con el que se reservó.",
    ].join("\n"),
  },
  schedule: {
    mon: "10:00-20:00",
    tue: "10:00-20:00",
    wed: "10:00-20:00",
    thu: "10:00-20:00",
    fri: "10:00-20:00",
    sat: "10:00-14:00",
  },
  resources: [
    { name: "Cabina 1", kind: "room", capacityMin: 1, capacityMax: 1, zone: "Planta 0" },
    { name: "Cabina 2", kind: "room", capacityMin: 1, capacityMax: 1, zone: "Planta 0" },
    { name: "Cabina 3", kind: "room", capacityMin: 1, capacityMax: 1, zone: "Planta 1" },
    { name: "Cabina Láser", kind: "room", capacityMin: 1, capacityMax: 1, zone: "Planta 1" },
  ],
  services: [
    {
      name: "Manicura",
      description: "Manicura con esmaltado semipermanente.",
      duration: 30,
      slotStepMin: 30,
      bufferMin: 10,
      maxPartySize: 1,
      resources: ["Cabina 1", "Cabina 2"],
    },
    {
      name: "Depilación láser",
      description: "Sesión de depilación láser. Requiere valoración previa la primera vez.",
      duration: 45,
      slotStepMin: 15,
      bufferMin: 15,
      maxPartySize: 1,
      // El equipo está en una sola cabina: aquí la restricción es de aparato, no de personal.
      resources: ["Cabina Láser"],
    },
    {
      name: "Limpieza facial profunda",
      description: "Limpieza facial con extracción y mascarilla.",
      duration: 60,
      slotStepMin: 30,
      bufferMin: 15,
      maxPartySize: 1,
      resources: ["Cabina 1", "Cabina 2", "Cabina 3"],
    },
    {
      name: "Ritual corporal",
      description: "Exfoliación, envoltura y masaje de 90 min.",
      duration: 90,
      slotStepMin: 30,
      bufferMin: 20,
      maxPartySize: 1,
      resources: ["Cabina 2", "Cabina 3"],
    },
  ],
  knowledge: {
    kind: "files",
    dir: "estetica-aurea",
    files: ["tratamientos.md", "politicas.md"],
  },
};

// ── Casa Mendieta ───────────────────────────────────────────────────────────

const MENDIETA: MockDef = {
  key: "mendieta",
  tenant: {
    name: "Casa Mendieta",
    sector: "restauracion",
    email: "hola@casamendieta.example",
    phone: "+34 948 21 44 08",
    // Sin web a propósito: todo su conocimiento entra por ficheros.
    direccion: "Calle Estafeta, 33 — 31001 Pamplona",
    contactPerson: "Maite Mendieta",
  },
  agent: {
    name: "Casa Mendieta",
    sector: "restauracion",
    widgetAvatarEmoji: "🍷",
    systemPrompt: [
      "Eres el asistente de reservas de Casa Mendieta, restaurante de cocina navarra en el casco",
      "viejo de Pamplona. Trato de usted, cercano y breve.",
      "",
      "Casa Mendieta NO tiene web. Todo lo que sabes del negocio está en tu conocimiento (carta",
      "con alérgenos, preguntas frecuentes y políticas de sala): búscalo antes de responder y no",
      "remitas a ninguna página. Si algo no está, dilo y da el teléfono +34 948 21 44 08.",
      "",
      "Servicios reservables: Comida (martes a domingo) y Cena (martes a sábado). Lunes cerrado.",
      "Comprueba siempre la disponibilidad con la herramienta antes de dar una hora.",
      "",
      "Seis mesas y no se unen: los grupos de 9 o más van por grupos@casamendieta.example.",
      "",
      "Alérgenos: responde con lo que dice la carta, alérgeno por alérgeno, y añade el aviso de",
      "que la cocina manipula harina y almendra a diario, así que no se garantiza ausencia de",
      "trazas. No inventes versiones sin un alérgeno que la carta no ofrezca.",
      "",
      "Cancelar: pide el código y el teléfono o el correo con el que se reservó. Para cambiar de",
      "hora se cancela y se reserva de nuevo.",
    ].join("\n"),
  },
  // Apertura del local: tiene que ENVOLVER las ventanas de los dos turnos (comida hasta 15:45,
  // cena hasta 23:00). No recorta —`Service.schedule` manda cuando existe— pero un horario de
  // agente más estrecho que sus servicios es una trampa para quien lea esto luego.
  schedule: {
    tue: "13:30-16:00|20:30-23:15",
    wed: "13:30-16:00|20:30-23:15",
    thu: "13:30-16:00|20:30-23:15",
    fri: "13:30-16:00|20:30-23:15",
    sat: "13:30-16:00|20:30-23:15",
    sun: "13:30-16:00",
  },
  resources: [
    { name: "Mesa 1", kind: "table", capacityMin: 1, capacityMax: 2, zone: "Comedor" },
    { name: "Mesa 2", kind: "table", capacityMin: 1, capacityMax: 2, zone: "Comedor" },
    { name: "Mesa 3", kind: "table", capacityMin: 2, capacityMax: 4, zone: "Comedor" },
    { name: "Mesa 4", kind: "table", capacityMin: 2, capacityMax: 4, zone: "Comedor" },
    { name: "Mesa 5", kind: "table", capacityMin: 3, capacityMax: 6, zone: "Comedor" },
    { name: "Mesa 6", kind: "table", capacityMin: 4, capacityMax: 8, zone: "Comedor" },
  ],
  services: [
    {
      name: "Comida",
      description: "Servicio de comida. La mesa se reserva 1 h 45 min.",
      duration: 105,
      slotStepMin: 15,
      bufferMin: 15,
      maxPartySize: 8,
      schedule: {
        tue: "13:30-15:45",
        wed: "13:30-15:45",
        thu: "13:30-15:45",
        fri: "13:30-15:45",
        sat: "13:30-15:45",
        sun: "13:30-15:45",
      },
    },
    {
      name: "Cena",
      description: "Servicio de cena. La mesa se reserva 2 h.",
      duration: 120,
      slotStepMin: 15,
      bufferMin: 15,
      maxPartySize: 8,
      // Ventana de LLEGADAS: con 120 min de mesa, la última entra a las 21:00. Es el número que
      // `horarios.md` publica, y tiene que salir de aquí: si el fixture dijera una hora que el
      // generador de franjas no ofrece, el bot prometería una mesa que la herramienta no da.
      schedule: {
        tue: "20:30-23:00",
        wed: "20:30-23:00",
        thu: "20:30-23:00",
        fri: "20:30-23:00",
        sat: "20:30-23:00",
      },
    },
  ],
  knowledge: {
    kind: "files",
    dir: "casa-mendieta",
    // `horarios.md` va aparte y no dentro del FAQ a propósito: pegado a la dirección y al
    // aparcamiento, el embedding del chunk quedaba dominado por el "dónde estamos" y
    // "¿abrís los lunes?" no recuperaba ninguna hora. Un tema por fichero corto = un chunk
    // limpio por tema.
    files: ["faq.md", "horarios.md", "carta-alergenos.md", "politicas.md"],
  },
};

const MOCKS: MockDef[] = [LAFAYETTE, BARBERIA, ESTETICA, MENDIETA];

/**
 * Los ficheros de conocimiento viven con la change, no en `back/`.
 *
 * Se ancla con `import.meta.url` y NO con `__dirname`: el paquete es ESM y bajo `tsx`
 * `__dirname` no apunta a este fichero (ver el aviso en `scripts/purge-skill-catalog.ts`).
 */
const FIXTURES_ROOT = new URL(
  "../../openspec/changes/aa-reservas-multirecurso-y-mocks-sectoriales/fixtures/",
  import.meta.url
);

// ── Seed ────────────────────────────────────────────────────────────────────

async function seedOne(def: MockDef): Promise<{ agentId: string }> {
  // Tenant: sin plan y sin ids de Stripe — no hay por dónde facturarle (T4.7). `tokenBalance`
  // explícito porque el fail-closed de metering bloquea al agente cuyo cupo no resuelve.
  //
  // T6.1 — El código de cliente NO se escribe a mano. Un mock es un cliente de la plataforma
  // como cualquier otro, así que su código sale de la misma secuencia `cli-NN` que usa el alta
  // del panel (`nextClientCode`). La búsqueda va por nombre y no por código precisamente para
  // que el re-seed conserve el código ya asignado en vez de mintear uno nuevo en cada pasada;
  // los mocks sembrados antes de esto (`mock-lafayette`…) se re-numeran en la primera pasada.
  const datosCliente = {
    name: def.tenant.name,
    sector: def.tenant.sector,
    email: def.tenant.email,
    phone: def.tenant.phone,
    website: def.tenant.website ?? null,
    direccion: def.tenant.direccion,
    contactPerson: def.tenant.contactPerson,
    tokenBalance: 10_000_000,
    isActive: true,
  };

  const existente = await prisma.tenant.findFirst({
    where: { name: def.tenant.name },
    select: { id: true, codigo: true },
  });

  const tenant = existente
    ? await withCodeRetry(async () =>
        prisma.tenant.update({
          where: { id: existente.id },
          data: {
            ...datosCliente,
            ...(existente.codigo?.startsWith("cli-") ? {} : { codigo: await nextClientCode() }),
          },
        })
      )
    : await withCodeRetry(async () =>
        prisma.tenant.create({ data: { codigo: await nextClientCode(), ...datosCliente } })
      );

  // `Agent` no tiene clave natural: se busca por (tenantId, nombre) y se crea si falta. Sin
  // esto una segunda pasada dejaría agentes duplicados con la misma agenda.
  const existing = await prisma.agent.findFirst({
    where: { tenantId: tenant.id, name: def.agent.name },
    select: { id: true },
  });

  const agentData = {
    name: def.agent.name,
    sector: def.agent.sector,
    systemPrompt: def.agent.systemPrompt,
    widgetAvatarEmoji: def.agent.widgetAvatarEmoji,
    tenantId: tenant.id,
    // Draft: el widget público responde 403. La consola interna sí puede hablar con él, que es
    // lo que necesita la matriz de casuísticas.
    status: "draft",
  };

  const agent = existing
    ? await prisma.agent.update({ where: { id: existing.id }, data: agentData })
    : await prisma.agent.create({ data: agentData });

  await prisma.agentSchedule.upsert({
    where: { agentId: agent.id },
    update: { timezone: "Europe/Madrid", schedule: def.schedule },
    create: { agentId: agent.id, timezone: "Europe/Madrid", schedule: def.schedule },
  });

  await prisma.agentDataBackend.upsert({
    where: { agentId: agent.id },
    update: { mode: "managed_db", capabilities: ["reservas", "leads"] },
    create: { agentId: agent.id, mode: "managed_db", capabilities: ["reservas", "leads"] },
  });

  const resourceIdByName = new Map<string, string>();
  for (const r of def.resources) {
    const row = await prisma.resource.upsert({
      where: { agentId_name: { agentId: agent.id, name: r.name } },
      update: {
        kind: r.kind,
        capacityMin: r.capacityMin,
        capacityMax: r.capacityMax,
        zone: r.zone ?? null,
        enabled: true,
      },
      create: {
        agentId: agent.id,
        name: r.name,
        kind: r.kind,
        capacityMin: r.capacityMin,
        capacityMax: r.capacityMax,
        zone: r.zone ?? null,
      },
    });
    resourceIdByName.set(r.name, row.id);
  }

  for (const s of def.services) {
    // `schedule` es una columna Json nullable: Prisma rechaza el literal `null` ahí (no puede
    // distinguir "guarda JSON null" de "borra el valor"), de ahí `Prisma.DbNull`. Sin turno propio
    // el servicio hereda el horario del agente (ver ServiceDef.schedule).
    const row = await prisma.service.upsert({
      where: { agentId_name: { agentId: agent.id, name: s.name } },
      update: {
        description: s.description,
        duration: s.duration,
        slotStepMin: s.slotStepMin,
        bufferMin: s.bufferMin,
        maxPartySize: s.maxPartySize,
        schedule: s.schedule ?? Prisma.DbNull,
        enabled: true,
      },
      create: {
        agentId: agent.id,
        name: s.name,
        description: s.description,
        duration: s.duration,
        slotStepMin: s.slotStepMin,
        bufferMin: s.bufferMin,
        maxPartySize: s.maxPartySize,
        schedule: s.schedule ?? Prisma.DbNull,
      },
    });

    // Los vínculos se reescriben enteros: si una pasada anterior dejó un recurso vinculado que
    // ya no debería prestar el servicio, borrarlo aquí es lo único que lo corrige.
    const wanted = (s.resources ?? []).map((n) => {
      const id = resourceIdByName.get(n);
      if (!id) throw new Error(`${def.key}: el servicio "${s.name}" apunta a "${n}", que no existe`);
      return id;
    });
    await prisma.serviceResource.deleteMany({
      where: { serviceId: row.id, ...(wanted.length ? { resourceId: { notIn: wanted } } : {}) },
    });
    if (wanted.length) {
      await prisma.serviceResource.createMany({
        data: wanted.map((resourceId) => ({ serviceId: row.id, resourceId })),
        skipDuplicates: true,
      });
    }
  }

  console.log(
    `  ${def.key.padEnd(10)} tenant=${tenant.id} agent=${agent.id} ` +
      `recursos=${def.resources.length} servicios=${def.services.length}`
  );
  return { agentId: agent.id };
}

// ── Conocimiento ────────────────────────────────────────────────────────────

async function ingestKnowledge(def: MockDef, agentId: string): Promise<void> {
  // Purga previa: `duplicatePolicy: "overwrite"` NO limpia la fuente, solo deduplica contenido
  // idéntico (`knowledge-duplicates.ts`). Sin este borrado, editar un fixture deja los chunks
  // viejos vivos al lado de los nuevos y el agente contesta con el texto antiguo para siempre.
  // Es seguro porque el agente lo acaba de crear este mismo script y no tiene otro conocimiento.
  const purged = await prisma.knowledgeChunk.deleteMany({ where: { agentId } });
  if (purged.count > 0) console.log(`  ${def.key}: purgados ${purged.count} chunks previos`);

  if (def.knowledge.kind === "web") {
    const result = await runTrackedIngest(agentId, def.knowledge.url, {
      duplicatePolicy: "overwrite",
    });
    console.log(`  ${def.key}: web ${def.knowledge.url} → ${JSON.stringify(result)}`);
    return;
  }

  // Ficheros: se llama a la MISMA librería que usa `POST /knowledge/:agentId/files`
  // (`chunkText` + `saveChunkWithDuplicatePolicy`). Se evita el multipart porque exigiría un
  // servidor levantado y una sesión, y no aporta nada: lo único que se salta es la copia del
  // original al bucket, que para un mock no sirve para nada.
  for (const file of def.knowledge.files) {
    const full = new URL(`${def.knowledge.dir}/${file}`, FIXTURES_ROOT);
    const text = await readFile(full, "utf8");
    const chunks = chunkText(text);
    let saved = 0;
    let duplicates = 0;
    for (const c of chunks) {
      const r = await saveChunkWithDuplicatePolicy(agentId, file, c, "overwrite");
      if (r === "duplicate") duplicates++;
      else saved++;
    }
    console.log(`  ${def.key}: ${file} → ${saved} chunks (${duplicates} duplicados)`);
  }
}

// ── Teardown ────────────────────────────────────────────────────────────────

/**
 * Borra los agentes ANTES del tenant. `Agent.tenantId` es opcional, así que borrar el tenant
 * primero dejaría los agentes huérfanos —con `tenantId = null`— y un agente huérfano es
 * exactamente lo que el fail-closed de metering deja inservible pero visible en el panel.
 *
 * Las CITAS se borran a mano y antes que nada: `Appointment.service` es `onDelete: Restrict`
 * (a propósito, para no perder el histórico de un negocio real al retirar un servicio), así que
 * en cuanto el mock recibe una sola reserva el borrado del agente falla con
 * `cita_servicio_id_fkey`. El resto —servicios, recursos, franjas, fragmentos de conocimiento—
 * sí cae por cascada desde `Agent`.
 */
async function teardownOne(def: MockDef): Promise<void> {
  // Por nombre, no por código: el código lo asigna la secuencia `cli-NN` en el alta (T6.1) y
  // el script no puede saber cuál le tocó a este mock.
  const tenant = await prisma.tenant.findFirst({
    where: { name: def.tenant.name },
    select: { id: true, agents: { select: { id: true } } },
  });
  if (!tenant) {
    console.log(`  ${def.key}: no existe, nada que borrar`);
    return;
  }
  let citas = 0;
  for (const a of tenant.agents) {
    const borradas = await prisma.appointment.deleteMany({ where: { service: { agentId: a.id } } });
    citas += borradas.count;
    await prisma.agent.delete({ where: { id: a.id } });
  }
  await prisma.tenant.delete({ where: { id: tenant.id } });
  console.log(
    `  ${def.key}: borrado (tenant + ${tenant.agents.length} agentes + ${citas} citas)`
  );
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;
  const withKnowledge = args.includes("--knowledge");
  const teardown = args.includes("--teardown");

  const targets = only ? MOCKS.filter((m) => m.key === only) : MOCKS;
  if (targets.length === 0) {
    throw new Error(`--only="${only}" no coincide con ninguno de: ${MOCKS.map((m) => m.key).join(", ")}`);
  }

  if (teardown) {
    console.log("Teardown de tenants mock:");
    for (const def of targets) await teardownOne(def);
    return;
  }

  console.log("Seed de tenants mock (idempotente):");
  const seeded: Array<{ def: MockDef; agentId: string }> = [];
  for (const def of targets) {
    const { agentId } = await seedOne(def);
    seeded.push({ def, agentId });
  }

  if (!withKnowledge) {
    console.log("\nConocimiento NO ingestado (pasa --knowledge: gasta red y tokens de embedding).");
    return;
  }

  console.log("\nIngesta de conocimiento:");
  for (const { def, agentId } of seeded) {
    try {
      await ingestKnowledge(def, agentId);
    } catch (err) {
      // Un fallo de red o de fixture no debe tirar el seed entero: la estructura ya está.
      console.error(`  ${def.key}: ingesta FALLIDA — ${err instanceof Error ? err.message : err}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
