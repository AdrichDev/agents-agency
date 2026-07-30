/**
 * "Una pestaña = un lead" — prueba de integración de los DOS caminos de escritura reales.
 *
 * Por qué existe además de `lead-contact.test.ts` y `managed-db-adapter.test.ts`: esos dos prueban
 * cada camino POR SEPARADO, y el fallo de producción no estaba en ninguno de los dos, estaba en su
 * composición. La conversación `cms80jwt900071cgil1pnfxvz` acabó en UNA fila (el fusionado
 * funcionaba) con `phone: null` (el modelo no volvió a llamar a la herramienta). Cada mitad verde,
 * el resultado incompleto.
 *
 * Aquí se monta una tabla `Lead` en memoria con la semántica que impone el schema
 * (`conversationId String? @unique`, `upsert` que fusiona sin pisar) y se hace pasar por ella el
 * código REAL: `executeTool("guardar_lead" | "calificar_lead")` → `ManagedDbAdapter` →
 * `prisma.lead.upsert`, y `completarContactoDelLead` como respaldo del turno en que el modelo
 * calla. Lo único simulado es el LLM: se decide turno a turno si llama a la herramienta o no,
 * que es exactamente la variable que no controlamos en producción.
 *
 * El guion reproduce lo que pidió el usuario: nombre, email y teléfono cada uno en su línea y en
 * su turno, sin cerrar la pestaña (mismo `conversationId` de principio a fin).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type FilaLead = {
  id: string;
  agentId: string;
  conversationId: string | null;
  customerName: string | null;
  email: string | null;
  phone: string | null;
  consent: boolean;
  qualification: string | null;
  qualificationReason: string | null;
  createdAt: Date;
};

/**
 * Tabla en memoria. Reproduce las tres cosas del schema que deciden el resultado:
 * `conversationId` único (pero NULLABLE, y un único nullable admite infinitos nulls), `upsert`
 * que discrimina create/update por esa clave, y `update` parcial que sólo escribe lo que llega.
 */
const tabla: FilaLead[] = [];
let secuencia = 0;

function nuevaFila(data: Record<string, any>): FilaLead {
  const fila: FilaLead = {
    id: `l${++secuencia}`,
    agentId: data.agentId,
    conversationId: data.conversationId ?? null,
    customerName: data.customerName ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    consent: data.consent ?? false,
    qualification: data.qualification ?? null,
    qualificationReason: data.qualificationReason ?? null,
    createdAt: new Date("2026-07-30T10:00:00.000Z"),
  };
  tabla.push(fila);
  return fila;
}

const prismaMock = {
  lead: {
    create: vi.fn(async ({ data }: any) => nuevaFila(data)),
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return tabla.find((f) => f.id === where.id) ?? null;
      // Un `where` por conversationId con valor nulo NO puede casar con las filas sueltas.
      if (where.conversationId == null) return null;
      return tabla.find((f) => f.conversationId === where.conversationId) ?? null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const fila = tabla.find((f) => (where.id ? f.id === where.id : f.conversationId === where.conversationId));
      if (!fila) throw new Error("Lead no encontrado");
      Object.assign(fila, data);
      return fila;
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const existente = where.conversationId
        ? tabla.find((f) => f.conversationId === where.conversationId)
        : undefined;
      if (!existente) return nuevaFila(create);
      Object.assign(existente, update);
      return existente;
    }),
  },
  agentDataBackend: {
    findUnique: vi.fn(async () => ({ mode: "managed_db", capabilities: ["leads"] })),
  },
  conversation: {
    findUnique: vi.fn(async () => ({ metadata: {} })),
    update: vi.fn(async () => ({})),
  },
  agent: { findUniqueOrThrow: vi.fn(async () => ({ id: "a1" })) },
  agentSchedule: { findUnique: vi.fn(async () => null) },
  integration: { findUnique: vi.fn(async () => null) },
  service: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
};

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));
vi.mock("@/lib/agent/order-status", () => ({ fetchOrderStatus: vi.fn() }));
vi.mock("@/lib/openai", () => ({ openai: {}, getClientForAgent: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn() }));
vi.mock("@/lib/agent-backend/notify-dispatcher", () => ({ dispatchNotification: vi.fn() }));
vi.mock("@/lib/token-metering", () => ({
  deductTokens: vi.fn(),
  assertUsageAllowed: vi.fn(async () => ({ meteredTenantId: null, credentialMode: "platform" })),
}));

const { executeTool } = await import("@/lib/agent/executor");
const { completarContactoDelLead } = await import("@/lib/agent/lead-contact");

const AGENTE = "a1";
/** Una pestaña abierta = un `conversationId` estable. Cerrarla generaría otro. */
const PESTANA = "conv-pestana-1";

/**
 * Un turno del visitante. `llamaTool` es el LLM: `null` significa que no llamó a `guardar_lead`
 * en ese turno, que es el caso que rompía la captación en producción.
 */
async function turno(
  mensaje: string,
  llamaTool: Record<string, unknown> | null,
  conversationId = PESTANA
): Promise<void> {
  if (llamaTool) await executeTool(AGENTE, "guardar_lead", llamaTool, conversationId);
  // Orden real de `chatWithAgent`: el respaldo va DESPUÉS del modelo, porque el lead puede
  // haberse creado en este mismo turno.
  await completarContactoDelLead(conversationId, mensaje);
}

function filasDeLaPestana(conversationId = PESTANA): FilaLead[] {
  return tabla.filter((f) => f.conversationId === conversationId);
}

beforeEach(() => {
  tabla.length = 0;
  secuencia = 0;
  vi.clearAllMocks();
  prismaMock.agentDataBackend.findUnique.mockResolvedValue({
    mode: "managed_db",
    capabilities: ["leads"],
  });
  prismaMock.conversation.findUnique.mockResolvedValue({ metadata: {} });
});

describe("una pestaña abierta deja un solo lead", () => {
  it("nombre, email y teléfono en tres turnos distintos acaban en la misma fila", async () => {
    await turno("Hola, me interesa un CRM a medida para mi taller", null);
    await turno("Me llamo Marta Ibáñez", { nombre: "Marta Ibáñez", intencion: "CRM a medida" });
    await turno("marta.ibanez@tallerlospinos.es", {
      nombre: "Marta Ibáñez",
      email: "marta.ibanez@tallerlospinos.es",
      intencion: "CRM a medida",
    });
    await turno("600 45 12 90", {
      nombre: "Marta Ibáñez",
      telefono: "600451290",
      intencion: "CRM a medida",
    });

    const filas = filasDeLaPestana();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      customerName: "Marta Ibáñez",
      email: "marta.ibanez@tallerlospinos.es",
      phone: "600451290",
      consent: true,
    });
  });

  it("el teléfono llega aunque el modelo no vuelva a llamar a la herramienta", async () => {
    // Este es EL caso de producción (`cms80jwt900071cgil1pnfxvz`): el modelo llamó a
    // `guardar_lead` con el email y se quedó callado cuando llegó el teléfono. Antes del respaldo,
    // la fila terminaba con `phone: null` y el comercial no podía llamar a nadie.
    await turno("Soy Marta Ibáñez", { nombre: "Marta Ibáñez", intencion: "CRM a medida" });
    await turno("mi correo es marta.ibanez@tallerlospinos.es", {
      nombre: "Marta Ibáñez",
      email: "marta.ibanez@tallerlospinos.es",
      intencion: "CRM a medida",
    });
    await turno("y el teléfono 600 45 12 90", null);

    const filas = filasDeLaPestana();
    expect(filas).toHaveLength(1);
    expect(filas[0].phone).toBe("600451290");
    expect(filas[0].email).toBe("marta.ibanez@tallerlospinos.es");
  });

  it("los tres datos sueltos, sin una sola llamada del modelo tras el primer turno", async () => {
    // Peor escenario del respaldo: el modelo sólo acierta a guardar el nombre. El respaldo NO crea
    // leads, así que ese primer turno es el que abre la fila; a partir de ahí, líneas sueltas.
    await turno("Marta Ibáñez", { nombre: "Marta Ibáñez", intencion: "presupuesto web" });
    await turno("marta.ibanez@tallerlospinos.es", null);
    await turno("600-451-290", null);

    expect(filasDeLaPestana()).toHaveLength(1);
    expect(filasDeLaPestana()[0]).toMatchObject({
      customerName: "Marta Ibáñez",
      email: "marta.ibanez@tallerlospinos.es",
      phone: "600451290",
    });
  });

  it("la calificación no abre una segunda fila ni pisa el nombre real", async () => {
    // El origen de las TRES filas de la conversación de 3A: `calificar_lead` hacía su propio
    // upsert y `guardar_lead` un `create` sin `conversationId`, así que nunca se encontraban.
    await executeTool(
      AGENTE,
      "calificar_lead",
      { qualification: "warm", reason: "pide info sin fecha" },
      PESTANA
    );
    await turno("Me llamo Marta Ibáñez y mi correo es marta.ibanez@tallerlospinos.es", {
      nombre: "Marta Ibáñez",
      email: "marta.ibanez@tallerlospinos.es",
      intencion: "CRM a medida",
    });
    await executeTool(
      AGENTE,
      "calificar_lead",
      { qualification: "hot", reason: "pide presupuesto y deja teléfono" },
      PESTANA
    );

    const filas = filasDeLaPestana();
    expect(filas).toHaveLength(1);
    expect(filas[0].customerName).toBe("Marta Ibáñez"); // no "Visitante"
    expect(filas[0].qualification).toBe("hot");
  });

  it("cerrar la pestaña y volver sí abre un lead nuevo", async () => {
    // Contraprueba: el contrato es "mientras la pestaña esté abierta". Si esto fusionara, dos
    // visitantes distintos en el mismo ordenador acabarían en la misma ficha.
    await turno("Soy Marta", { nombre: "Marta", intencion: "CRM" });
    await turno("Soy Luis", { nombre: "Luis", intencion: "landing" }, "conv-pestana-2");

    expect(filasDeLaPestana("conv-pestana-1")).toHaveLength(1);
    expect(filasDeLaPestana("conv-pestana-2")).toHaveLength(1);
    expect(filasDeLaPestana("conv-pestana-2")[0].customerName).toBe("Luis");
  });

  it("un dato corregido por el visitante no lo pisa el respaldo, sí la herramienta", async () => {
    // División de responsabilidades deliberada: corregir es una DECISIÓN y la toma el modelo, que
    // ha leído "no, mejor el otro". El respaldo es ciego a la intención y sólo rellena huecos.
    await turno("Marta, marta@taller.es", {
      nombre: "Marta",
      email: "marta@taller.es",
      intencion: "CRM",
    });
    await turno("perdón, mejor escríbeme a marta.ibanez@tallerlospinos.es", null);
    expect(filasDeLaPestana()[0].email).toBe("marta@taller.es");

    await turno("mejor a marta.ibanez@tallerlospinos.es", {
      nombre: "Marta",
      email: "marta.ibanez@tallerlospinos.es",
      intencion: "CRM",
    });
    expect(filasDeLaPestana()[0].email).toBe("marta.ibanez@tallerlospinos.es");
    expect(filasDeLaPestana()).toHaveLength(1);
  });
});
